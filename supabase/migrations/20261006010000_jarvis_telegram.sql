-- Jarvis Telegram v1: server-side task actions + confirmation queue.
-- Existing browser behavior is preserved; service_role may act only through
-- the dedicated RPCs below, with the Telegram-linked user passed as actor.
begin;

create or replace function public.nu_actor_role(p_actor uuid) returns text
language sql stable security definer set search_path = public
as $$
  select role::text from public.profiles where id = p_actor and is_active = true
$$;

create or replace function public.nu_actor_can_assign(p_actor uuid, p_assignee uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select case public.nu_actor_role(p_actor)
    when 'owner' then exists(select 1 from public.profiles p where p.id = p_assignee and p.is_active = true)
    when 'manager' then exists(select 1 from public.profiles p where p.id = p_assignee and p.is_active = true and p.role::text in ('smm','senior_master'))
    else false
  end
$$;

create or replace function public.nu_actor_can_view_task(p_actor uuid, p_task public.tasks) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.nu_actor_role(p_actor) = 'owner'
    or public.nu_actor_role(p_actor) is not null and (
      p_task.assignee_id = p_actor
      or p_task.created_by = p_actor
      or public.nu_actor_role(p_actor) = 'manager' and exists(
        select 1 from public.profiles p where p.id = p_task.assignee_id and p.role::text in ('smm','senior_master')
      )
    )
$$;

-- For normal browser requests this is auth.uid(). Dedicated Jarvis RPCs set
-- nu.jarvis_actor only while running under service_role.
create or replace function public.nu_effective_actor() returns uuid
language plpgsql stable security invoker set search_path = public
as $$
declare v text;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    v := nullif(current_setting('nu.jarvis_actor', true), '');
    if v is not null then return v::uuid; end if;
  end if;
  return auth.uid();
end $$;

create or replace function public.nu_can_assign(uid uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select public.nu_actor_can_assign(public.nu_effective_actor(), uid) $$;

create or replace function public.nu_task_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare actor uuid; manager boolean;
begin
  actor := public.nu_effective_actor();
  if tg_op = 'INSERT' then
    if actor is null or new.created_by is distinct from actor or not public.nu_actor_can_assign(actor, new.assignee_id)
      or new.status <> 'new' or new.completed_at is not null or length(trim(new.expected_result)) = 0
    then raise exception 'Task creation denied'; end if;
  else
    manager := public.nu_actor_can_assign(actor, old.assignee_id);
    if actor is null or new.created_by is distinct from old.created_by then raise exception 'Task update denied'; end if;
    if manager then
      if not public.nu_actor_can_assign(actor, new.assignee_id) then raise exception 'Assignment denied'; end if;
      if new.status = 'completed' and old.status <> 'review' then raise exception 'Review required'; end if;
    else
      if old.assignee_id is distinct from actor or old.status = 'completed'
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

create or replace function public.nu_task_audit() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  insert into public.task_history(task_id,user_id,action,old_value,new_value)
  values(new.id, public.nu_effective_actor(), case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;

create or replace function public.nu_deadline_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare t public.tasks; actor uuid;
begin
  actor := public.nu_effective_actor();
  select * into t from public.tasks where id = new.task_id;
  if not found then raise exception 'Task not found'; end if;
  if tg_op = 'INSERT' then
    if actor is null or new.requested_by is distinct from actor or t.assignee_id is distinct from actor
      or new.old_deadline is distinct from t.deadline or new.status <> 'pending'
      or new.decided_by is not null or new.decided_at is not null
      or new.requested_deadline <= now() or length(trim(new.reason)) = 0
    then raise exception 'Deadline request denied'; end if;
  else
    if actor is null or old.status <> 'pending' or new.status not in ('approved','rejected')
      or (to_jsonb(new) - 'status' - 'decided_by' - 'decided_at') <>
         (to_jsonb(old) - 'status' - 'decided_by' - 'decided_at')
      or not public.nu_actor_can_assign(actor, t.assignee_id)
    then raise exception 'Deadline resolution denied'; end if;
    new.decided_by := actor; new.decided_at := now();
    if new.status = 'approved' then
      update public.tasks set deadline = new.requested_deadline where id = new.task_id;
    end if;
  end if;
  return new;
end $$;

create or replace function public.nu_deadline_audit() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  insert into public.task_history(task_id,user_id,action,old_value,new_value)
  values(new.task_id,public.nu_effective_actor(),case when tg_op = 'INSERT' then 'deadline_requested' else 'deadline_' || new.status end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,to_jsonb(new));
  return new;
end $$;

create table if not exists public.telegram_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id bigint not null,
  action_type text not null check (action_type in ('create_task','update_status','change_deadline','add_comment')),
  payload jsonb not null,
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  created_at timestamptz not null default now()
);
alter table public.telegram_pending_actions enable row level security;
revoke all on public.telegram_pending_actions from anon, authenticated;
grant select, insert, update, delete on public.telegram_pending_actions to service_role;
create index if not exists telegram_pending_actions_user_created_idx
  on public.telegram_pending_actions(user_id, created_at desc);

create or replace function public.nu_jarvis_assert_service() returns void
language plpgsql security invoker set search_path = public
as $$ begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Jarvis service access required';
  end if;
end $$;

create or replace function public.nu_jarvis_create_task(
  p_actor uuid, p_assignee uuid, p_title text, p_description text,
  p_expected_result text, p_project uuid, p_priority text, p_deadline timestamptz
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.nu_jarvis_assert_service();
  if not public.nu_actor_can_assign(p_actor, p_assignee) then raise exception 'Assignment denied'; end if;
  if p_deadline <= now() then raise exception 'Deadline must be in the future'; end if;
  if p_priority not in ('low','normal','high','critical') then raise exception 'Invalid priority'; end if;
  perform set_config('nu.jarvis_actor', p_actor::text, true);
  insert into public.tasks(title,description,expected_result,assignee_id,project_id,priority,deadline,created_by)
  values(trim(p_title),nullif(trim(p_description),''),trim(p_expected_result),p_assignee,p_project,p_priority::public.task_priority,p_deadline,p_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.nu_jarvis_update_status(p_actor uuid, p_task uuid, p_status text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.nu_jarvis_assert_service();
  if p_status not in ('accepted','in_progress','waiting','at_risk','review','completed') then raise exception 'Invalid status'; end if;
  perform set_config('nu.jarvis_actor', p_actor::text, true);
  update public.tasks set status = p_status::public.task_status where id = p_task;
  if not found then raise exception 'Task not found'; end if;
end $$;

create or replace function public.nu_jarvis_change_deadline(
  p_actor uuid, p_task uuid, p_deadline timestamptz, p_reason text
) returns text
language plpgsql security definer set search_path = public
as $$
declare t public.tasks;
begin
  perform public.nu_jarvis_assert_service();
  if p_deadline <= now() or length(trim(p_reason)) = 0 then raise exception 'Invalid deadline request'; end if;
  select * into t from public.tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  perform set_config('nu.jarvis_actor', p_actor::text, true);
  if public.nu_actor_can_assign(p_actor, t.assignee_id) then
    update public.tasks set deadline = p_deadline, deadline_change_reason = trim(p_reason), deadline_changes = deadline_changes + 1 where id = p_task;
    return 'updated';
  elsif t.assignee_id = p_actor then
    insert into public.deadline_requests(task_id,requested_by,old_deadline,requested_deadline,reason)
    values(p_task,p_actor,t.deadline,p_deadline,trim(p_reason));
    return 'requested';
  end if;
  raise exception 'Deadline change denied';
end $$;

create or replace function public.nu_jarvis_add_comment(p_actor uuid, p_task uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public
as $$
declare t public.tasks; v_id uuid;
begin
  perform public.nu_jarvis_assert_service();
  select * into t from public.tasks where id = p_task;
  if not found or not public.nu_actor_can_view_task(p_actor, t) then raise exception 'Comment denied'; end if;
  if length(trim(p_body)) = 0 then raise exception 'Empty comment'; end if;
  insert into public.task_comments(task_id,author_id,body) values(p_task,p_actor,trim(p_body)) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.nu_jarvis_create_task(uuid,uuid,text,text,text,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.nu_jarvis_update_status(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.nu_jarvis_change_deadline(uuid,uuid,timestamptz,text) from public, anon, authenticated;
revoke all on function public.nu_jarvis_add_comment(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.nu_jarvis_create_task(uuid,uuid,text,text,text,uuid,text,timestamptz) to service_role;
grant execute on function public.nu_jarvis_update_status(uuid,uuid,text) to service_role;
grant execute on function public.nu_jarvis_change_deadline(uuid,uuid,timestamptz,text) to service_role;
grant execute on function public.nu_jarvis_add_comment(uuid,uuid,text) to service_role;

commit;
