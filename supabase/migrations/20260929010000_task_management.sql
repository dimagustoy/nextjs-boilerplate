-- Extends the existing public task tables. Run once in Supabase SQL Editor.
-- Existing Auth setup, profiles, projects, tasks and their data are preserved.
begin;

create or replace function public.nu_active_role(uid uuid default auth.uid()) returns text
language sql stable security definer set search_path = public
as $$ select role::text from public.profiles where id = uid and is_active = true $$;

create or replace function public.nu_can_assign(uid uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.nu_active_role() = 'owner' and exists
    (select 1 from public.profiles where id = uid and is_active = true)
    or public.nu_active_role() = 'manager' and exists
    (select 1 from public.profiles where id = uid and is_active = true and role::text in ('smm','senior_master'));
$$;

create or replace function public.nu_can_view_task(t public.tasks) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.nu_active_role() = 'owner'
    or public.nu_active_role() is not null and (
      t.assignee_id = auth.uid()
      or t.created_by = auth.uid()
      or public.nu_active_role() = 'manager' and exists
        (select 1 from public.profiles p where p.id = t.assignee_id and p.role::text in ('smm','senior_master'))
    );
$$;

create or replace function public.nu_task_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare manager boolean;
begin
  if tg_op = 'INSERT' then
    if new.created_by is distinct from auth.uid() or not public.nu_can_assign(new.assignee_id)
      or new.status <> 'new' or new.completed_at is not null or length(trim(new.expected_result)) = 0
    then raise exception 'Task creation denied'; end if;
  else
    manager := public.nu_can_assign(old.assignee_id);
    if new.created_by is distinct from old.created_by then raise exception 'Creator cannot change'; end if;
    if manager then
      if not public.nu_can_assign(new.assignee_id) then raise exception 'Assignment denied'; end if;
      if new.status = 'completed' and old.status <> 'review' then raise exception 'Review required'; end if;
    else
      if old.assignee_id is distinct from auth.uid() or old.status = 'completed'
        or (to_jsonb(new) - 'status' - 'updated_at') <> (to_jsonb(old) - 'status' - 'updated_at')
        or new.status not in ('accepted','in_progress','waiting','at_risk','review')
      then raise exception 'Task update denied'; end if;
    end if;
  end if;
  new.updated_at := now();
  if new.status = 'completed' and tg_op = 'UPDATE' then
    new.completed_at := coalesce(old.completed_at, now());
  elsif new.status <> 'completed' then new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists nu_task_guard_trigger on public.tasks;
create trigger nu_task_guard_trigger before insert or update on public.tasks
for each row execute function public.nu_task_guard();

create or replace function public.nu_task_audit() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  insert into public.task_history(task_id,user_id,action,old_value,new_value)
  values(new.id, auth.uid(), case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
drop trigger if exists nu_task_audit_trigger on public.tasks;
create trigger nu_task_audit_trigger after insert or update on public.tasks
for each row execute function public.nu_task_audit();

create or replace function public.nu_deadline_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found then raise exception 'Task not found'; end if;
  if tg_op = 'INSERT' then
    if new.requested_by is distinct from auth.uid() or t.assignee_id is distinct from auth.uid()
      or new.old_deadline is distinct from t.deadline or new.status <> 'pending'
      or new.decided_by is not null or new.decided_at is not null
      or new.requested_deadline <= now() or length(trim(new.reason)) = 0
    then raise exception 'Deadline request denied'; end if;
  else
    if old.status <> 'pending' or new.status not in ('approved','rejected')
      or (to_jsonb(new) - 'status' - 'decided_by' - 'decided_at') <>
         (to_jsonb(old) - 'status' - 'decided_by' - 'decided_at')
      or not public.nu_can_assign(t.assignee_id)
    then raise exception 'Deadline resolution denied'; end if;
    new.decided_by := auth.uid(); new.decided_at := now();
    if new.status = 'approved' then
      update public.tasks set deadline = new.requested_deadline where id = new.task_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists nu_deadline_guard_trigger on public.deadline_requests;
create trigger nu_deadline_guard_trigger before insert or update on public.deadline_requests
for each row execute function public.nu_deadline_guard();

create or replace function public.nu_deadline_audit() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  insert into public.task_history(task_id,user_id,action,old_value,new_value)
  values(new.task_id,auth.uid(),case when tg_op = 'INSERT' then 'deadline_requested' else 'deadline_' || new.status end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,to_jsonb(new));
  return new;
end $$;
drop trigger if exists nu_deadline_audit_trigger on public.deadline_requests;
create trigger nu_deadline_audit_trigger after insert or update on public.deadline_requests
for each row execute function public.nu_deadline_audit();

-- Remove the older broad policies on these task tables before adding scoped rules.
drop policy if exists manager_insert_tasks on public.tasks;
drop policy if exists manager_select_tasks on public.tasks;
drop policy if exists manager_update_tasks on public.tasks;
drop policy if exists owner_all_tasks on public.tasks;
drop policy if exists manager_select_projects on public.projects;
drop policy if exists owner_all_projects on public.projects;
drop policy if exists manager_insert_comments on public.task_comments;
drop policy if exists manager_select_comments on public.task_comments;
drop policy if exists owner_all_task_comments on public.task_comments;
drop policy if exists manager_select_history on public.task_history;
drop policy if exists owner_select_task_history on public.task_history;
drop policy if exists manager_create_deadline_request on public.deadline_requests;
drop policy if exists manager_select_deadline_requests on public.deadline_requests;
drop policy if exists owner_all_deadline_requests on public.deadline_requests;
drop policy if exists manager_select_profiles on public.profiles;

alter table public.tasks enable row level security;
alter table public.projects enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_history enable row level security;
alter table public.deadline_requests enable row level security;

create policy nu_tasks_read on public.tasks for select to authenticated using (public.nu_can_view_task(tasks));
create policy nu_tasks_insert on public.tasks for insert to authenticated
with check (created_by = auth.uid() and public.nu_can_assign(assignee_id));
create policy nu_tasks_update on public.tasks for update to authenticated
using (public.nu_can_view_task(tasks)) with check (public.nu_can_view_task(tasks));
create policy nu_projects_read on public.projects for select to authenticated using (public.nu_active_role() is not null);
create policy nu_projects_write on public.projects for all to authenticated
using (public.nu_active_role() = 'owner') with check (public.nu_active_role() = 'owner');
create policy nu_comments_read on public.task_comments for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_view_task(t)));
create policy nu_comments_insert on public.task_comments for insert to authenticated
with check (author_id = auth.uid() and exists
  (select 1 from public.tasks t where t.id = task_id and public.nu_can_view_task(t)));
create policy nu_history_read on public.task_history for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_view_task(t)));
create policy nu_deadlines_read on public.deadline_requests for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_view_task(t)));
create policy nu_deadlines_insert on public.deadline_requests for insert to authenticated
with check (requested_by = auth.uid() and exists
  (select 1 from public.tasks t where t.id = task_id and t.assignee_id = auth.uid()));
create policy nu_deadlines_update on public.deadline_requests for update to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_assign(t.assignee_id)))
with check (exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_assign(t.assignee_id)));
create policy nu_profiles_team_read on public.profiles for select to authenticated
using (public.nu_active_role() is not null);

grant select, insert, update on public.tasks, public.deadline_requests to authenticated;
grant select, insert on public.task_comments to authenticated;
grant select on public.task_history to authenticated;
grant select, insert, update on public.projects to authenticated;
commit;
