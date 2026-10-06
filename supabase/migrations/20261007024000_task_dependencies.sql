begin;

create table if not exists public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create index if not exists task_dependencies_depends_idx on public.task_dependencies(depends_on_task_id);
alter table public.task_dependencies enable row level security;

create or replace function public.nu_dependency_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_assignee uuid;
begin
  if tg_op = 'INSERT' then
    if new.created_by is distinct from auth.uid() then
      raise exception 'Dependency creation denied';
    end if;
    select assignee_id into v_assignee from public.tasks where id = new.task_id;
    if v_assignee is null or not public.nu_can_assign(v_assignee) then
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

drop trigger if exists nu_dependency_guard_trigger on public.task_dependencies;
create trigger nu_dependency_guard_trigger before insert on public.task_dependencies
for each row execute function public.nu_dependency_guard();

create policy nu_dependencies_read on public.task_dependencies for select to authenticated
using (
  exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_view_task(t))
  and exists (select 1 from public.tasks t where t.id = depends_on_task_id and public.nu_can_view_task(t))
);

create policy nu_dependencies_insert on public.task_dependencies for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_assign(t.assignee_id))
  and exists (select 1 from public.tasks t where t.id = depends_on_task_id and public.nu_can_view_task(t))
);

create policy nu_dependencies_delete on public.task_dependencies for delete to authenticated
using (
  exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_assign(t.assignee_id))
);

grant select, insert, delete on public.task_dependencies to authenticated;
revoke all on function public.nu_dependency_guard() from public, anon, authenticated;

commit;
