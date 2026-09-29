-- Owner can correct any task status and permanently delete a task.
-- This migration is additive and can be applied after 20260929010000_task_management.sql.
begin;

create or replace function public.nu_task_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is distinct from auth.uid() or not public.nu_can_assign(new.assignee_id)
      or new.status <> 'new' or new.completed_at is not null or length(trim(new.expected_result)) = 0
    then raise exception 'Task creation denied'; end if;
  else
    if new.created_by is distinct from old.created_by then raise exception 'Creator cannot change'; end if;
    if public.nu_active_role() = 'owner' then
      if not public.nu_can_assign(new.assignee_id) then raise exception 'Assignment denied'; end if;
    elsif public.nu_can_assign(old.assignee_id) then
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

create or replace function public.nu_delete_task(p_task_id uuid) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.nu_active_role() <> 'owner' then
    raise exception 'Only owner can delete tasks';
  end if;
  if not exists (select 1 from public.tasks where id = p_task_id) then return false; end if;
  delete from public.task_comments where task_id = p_task_id;
  delete from public.task_history where task_id = p_task_id;
  delete from public.deadline_requests where task_id = p_task_id;
  delete from public.tasks where id = p_task_id;
  return true;
end $$;

revoke all on function public.nu_delete_task(uuid) from public;
grant execute on function public.nu_delete_task(uuid) to authenticated;
commit;
