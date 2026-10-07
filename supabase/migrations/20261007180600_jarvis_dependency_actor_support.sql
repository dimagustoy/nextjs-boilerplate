begin;
create or replace function public.nu_dependency_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_assignee uuid; v_actor uuid;
begin
  v_actor := public.nu_effective_actor();
  if tg_op = 'INSERT' then
    if v_actor is null or new.created_by is distinct from v_actor then
      raise exception 'Dependency creation denied';
    end if;
    select assignee_id into v_assignee from public.tasks where id = new.task_id;
    if v_assignee is null or not public.nu_actor_can_assign(v_actor, v_assignee) then
      raise exception 'Dependency management denied';
    end if;
    if exists (
      with recursive chain(id) as (
        select d.depends_on_task_id from public.task_dependencies d where d.task_id = new.depends_on_task_id
        union
        select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
      )
      select 1 from chain where id = new.task_id
    ) then
      raise exception 'Dependency cycle denied';
    end if;
  end if;
  return new;
end $$;
commit;
