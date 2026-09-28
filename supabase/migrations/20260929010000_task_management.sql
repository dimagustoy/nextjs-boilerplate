-- Apply after the existing profiles table and Auth setup. No existing Auth objects are replaced.
create extension if not exists pgcrypto;

create or replace function public.nu_role(uid uuid default auth.uid()) returns text
language sql stable security definer set search_path = public
as $$ select role::text from public.profiles where id = uid and is_active = true $$;

create or replace function public.nu_can_manage(target uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.nu_role() = 'owner' or
    (public.nu_role() = 'manager' and exists
      (select 1 from public.profiles where id = target and role::text in ('smm','senior_master') and is_active = true));
$$;

create table if not exists public.nu_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.nu_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 3 and 200),
  description text not null default '',
  expected_result text not null check (length(trim(expected_result)) > 0),
  project_id uuid references public.nu_projects(id),
  assignee_id uuid not null references public.profiles(id),
  creator_id uuid not null default auth.uid() references public.profiles(id),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'new' check (status in ('new','accepted','in_progress','waiting','at_risk','review','completed')),
  due_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nu_tasks_assignee_due on public.nu_tasks(assignee_id, due_at);
create index if not exists nu_tasks_status_due on public.nu_tasks(status, due_at);
create table if not exists public.nu_comments (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.nu_tasks(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(trim(body)) between 1 and 5000), created_at timestamptz not null default now()
);
create table if not exists public.nu_task_events (
  id bigint generated always as identity primary key, task_id uuid not null references public.nu_tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id), event_type text not null,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.nu_deadline_requests (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.nu_tasks(id) on delete cascade,
  requester_id uuid not null default auth.uid() references public.profiles(id),
  proposed_due_at timestamptz not null, reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  resolved_by uuid references public.profiles(id), created_at timestamptz not null default now(), resolved_at timestamptz
);

create or replace function public.nu_task_visible(t public.nu_tasks) returns boolean
language sql stable security definer set search_path = public
as $$ select public.nu_role() = 'owner' or t.assignee_id = auth.uid() or t.creator_id = auth.uid() or
  (public.nu_role() = 'manager' and exists
    (select 1 from public.profiles p where p.id = t.assignee_id and p.role::text in ('smm','senior_master'))) $$;

create or replace function public.nu_task_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare manager boolean;
begin
  if tg_op = 'INSERT' then
    if new.creator_id <> auth.uid() or new.status <> 'new' or new.completed_at is not null
       or not public.nu_can_manage(new.assignee_id) then raise exception 'Task creation denied'; end if;
  else
    manager := public.nu_can_manage(old.assignee_id);
    if not manager then
      if old.assignee_id <> auth.uid() or
         (to_jsonb(new) - 'status' - 'updated_at') <> (to_jsonb(old) - 'status' - 'updated_at') or
         new.status not in ('accepted','in_progress','waiting','at_risk','review') or old.status = 'completed'
      then raise exception 'Task update denied'; end if;
    else
      if (new.assignee_id <> old.assignee_id and not public.nu_can_manage(new.assignee_id))
         or new.creator_id <> old.creator_id then raise exception 'Task assignment denied'; end if;
      if new.status = 'completed' and old.status <> 'review' then raise exception 'Task must be reviewed first'; end if;
    end if;
    if new.due_at <> old.due_at and not manager then raise exception 'Deadline change denied'; end if;
  end if;
  new.updated_at := now();
  new.completed_at := case when new.status = 'completed' then coalesce(old.completed_at, now()) else null end;
  return new;
end $$;
drop trigger if exists nu_task_guard_trigger on public.nu_tasks;
create trigger nu_task_guard_trigger before insert or update on public.nu_tasks
for each row execute function public.nu_task_guard();

create or replace function public.nu_task_audit() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  insert into public.nu_task_events(task_id,actor_id,event_type,details)
  values (new.id, auth.uid(), case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then jsonb_build_object('title',new.title,'status',new.status)
    else jsonb_build_object('before',to_jsonb(old) - 'updated_at','after',to_jsonb(new) - 'updated_at') end);
  return new;
end $$;
drop trigger if exists nu_task_audit_trigger on public.nu_tasks;
create trigger nu_task_audit_trigger after insert or update on public.nu_tasks
for each row execute function public.nu_task_audit();

create or replace function public.nu_deadline_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare t public.nu_tasks;
begin
  select * into t from public.nu_tasks where id = new.task_id;
  if tg_op = 'INSERT' then
    if new.requester_id <> auth.uid() or t.assignee_id <> auth.uid() or new.status <> 'pending'
       or new.resolved_at is not null or new.resolved_by is not null or new.proposed_due_at <= now()
    then raise exception 'Deadline request denied'; end if;
  else
    if old.status <> 'pending' or new.status not in ('approved','rejected') or
       (to_jsonb(new) - 'status' - 'resolved_by' - 'resolved_at') <>
       (to_jsonb(old) - 'status' - 'resolved_by' - 'resolved_at') or
       not public.nu_can_manage(t.assignee_id) then raise exception 'Deadline resolution denied'; end if;
    new.resolved_by := auth.uid(); new.resolved_at := now();
    if new.status = 'approved' then
      update public.nu_tasks set due_at = new.proposed_due_at where id = new.task_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists nu_deadline_guard_trigger on public.nu_deadline_requests;
create trigger nu_deadline_guard_trigger before insert or update on public.nu_deadline_requests
for each row execute function public.nu_deadline_guard();

create or replace function public.nu_deadline_audit() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  insert into public.nu_task_events(task_id,actor_id,event_type,details)
  values(new.task_id,auth.uid(),case when tg_op = 'INSERT' then 'deadline_requested' else 'deadline_' || new.status end,
    jsonb_build_object('proposed_due_at',new.proposed_due_at,'reason',new.reason));
  return new;
end $$;
drop trigger if exists nu_deadline_audit_trigger on public.nu_deadline_requests;
create trigger nu_deadline_audit_trigger after insert or update on public.nu_deadline_requests
for each row execute function public.nu_deadline_audit();

create or replace function public.nu_profile_guard() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  if auth.uid() is not null and public.nu_role() is distinct from 'owner' and
     (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
  then raise exception 'Only owner can change access'; end if;
  return new;
end $$;
drop trigger if exists nu_profile_guard_trigger on public.profiles;
create trigger nu_profile_guard_trigger before update on public.profiles
for each row execute function public.nu_profile_guard();

alter table public.nu_projects enable row level security;
alter table public.nu_tasks enable row level security;
alter table public.nu_comments enable row level security;
alter table public.nu_task_events enable row level security;
alter table public.nu_deadline_requests enable row level security;
create policy projects_read on public.nu_projects for select to authenticated using (public.nu_role() is not null);
create policy projects_write on public.nu_projects for all to authenticated using (public.nu_role() = 'owner') with check (public.nu_role() = 'owner');
create policy tasks_read on public.nu_tasks for select to authenticated using (public.nu_task_visible(nu_tasks));
create policy tasks_insert on public.nu_tasks for insert to authenticated with check (creator_id = auth.uid() and public.nu_can_manage(assignee_id));
create policy tasks_update on public.nu_tasks for update to authenticated using (public.nu_task_visible(nu_tasks)) with check (public.nu_task_visible(nu_tasks));
create policy comments_read on public.nu_comments for select to authenticated using (exists (select 1 from public.nu_tasks t where t.id = task_id and public.nu_task_visible(t)));
create policy comments_insert on public.nu_comments for insert to authenticated with check (author_id = auth.uid() and exists (select 1 from public.nu_tasks t where t.id = task_id and public.nu_task_visible(t)));
create policy events_read on public.nu_task_events for select to authenticated using (exists (select 1 from public.nu_tasks t where t.id = task_id and public.nu_task_visible(t)));
create policy deadlines_read on public.nu_deadline_requests for select to authenticated using (exists (select 1 from public.nu_tasks t where t.id = task_id and public.nu_task_visible(t)));
create policy deadlines_insert on public.nu_deadline_requests for insert to authenticated with check (requester_id = auth.uid() and exists (select 1 from public.nu_tasks t where t.id = task_id and t.assignee_id = auth.uid()));
create policy deadlines_update on public.nu_deadline_requests for update to authenticated using (exists (select 1 from public.nu_tasks t where t.id = task_id and public.nu_can_manage(t.assignee_id))) with check (exists (select 1 from public.nu_tasks t where t.id = task_id and public.nu_can_manage(t.assignee_id)));
-- Existing profile SELECT policies remain intact; this allows the owner to administer existing staff.
create policy nu_profiles_owner_update on public.profiles for update to authenticated using (public.nu_role() = 'owner') with check (public.nu_role() = 'owner');
create policy nu_profiles_team_read on public.profiles for select to authenticated using (public.nu_role() in ('owner','manager','smm','senior_master'));

grant usage on schema public to authenticated;
grant select, insert, update on public.nu_tasks, public.nu_deadline_requests to authenticated;
grant select, insert on public.nu_comments to authenticated;
grant select on public.nu_task_events to authenticated;
grant select, insert, update on public.nu_projects to authenticated;
grant usage, select on sequence public.nu_task_events_id_seq to authenticated;
