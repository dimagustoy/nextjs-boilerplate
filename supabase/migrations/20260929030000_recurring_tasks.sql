-- Apply after the task management and owner-control migrations.
begin;

create table public.recurring_task_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 3 and 200),
  description text,
  expected_result text not null check (length(trim(expected_result)) > 0),
  assignee_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  project_id uuid references public.projects(id),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  due_day integer not null check (due_day between 1 and 31),
  due_time time without time zone not null default '18:00',
  reminder_days integer[] not null default '{5,2,0}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.recurring_task_instances (
  template_id uuid not null references public.recurring_task_templates(id) on delete cascade,
  period date not null,
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  primary key (template_id, period)
);

alter table public.recurring_task_templates enable row level security;
alter table public.recurring_task_instances enable row level security;
create policy nu_recurring_read on public.recurring_task_templates for select to authenticated
using (public.nu_active_role() = 'owner' or public.nu_active_role() is not null and assignee_id = auth.uid());
create policy nu_recurring_insert on public.recurring_task_templates for insert to authenticated
with check (public.nu_active_role() = 'owner' and created_by = auth.uid() and public.nu_can_assign(assignee_id));
create policy nu_recurring_update on public.recurring_task_templates for update to authenticated
using (public.nu_active_role() = 'owner') with check (public.nu_active_role() = 'owner' and created_by = auth.uid() and public.nu_can_assign(assignee_id));
create policy nu_recurring_delete on public.recurring_task_templates for delete to authenticated
using (public.nu_active_role() = 'owner');
create policy nu_recurring_instances_read on public.recurring_task_instances for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.nu_can_view_task(t)));

-- Cron calls this function without a user JWT. For each template we temporarily
-- provide its owner identity so the existing task guard and audit stay intact.
create or replace function public.nu_generate_recurring(p_month date) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  r public.recurring_task_templates;
  v_task_id uuid;
  v_priority public.tasks.priority%type;
  v_day integer;
  v_deadline timestamptz;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_count integer := 0;
begin
  if auth.uid() is not null and public.nu_active_role() <> 'owner' then
    raise exception 'Only owner can generate recurring tasks';
  end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'Month must start on day one';
  end if;
  if p_month < date_trunc('month', now() at time zone 'Asia/Yekaterinburg')::date
    or p_month > (date_trunc('month', now() at time zone 'Asia/Yekaterinburg') + interval '2 months')::date
  then raise exception 'Only upcoming months can be generated'; end if;
  for r in select rt.* from public.recurring_task_templates rt
    join public.profiles creator on creator.id = rt.created_by and creator.is_active and creator.role::text = 'owner'
    join public.profiles assignee on assignee.id = rt.assignee_id and assignee.is_active
    where rt.is_active
  loop
    perform pg_advisory_xact_lock(hashtextextended(r.id::text || p_month::text, 0));
    if exists (select 1 from public.recurring_task_instances where template_id = r.id and period = p_month) then continue; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub',r.created_by,'role','authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r.created_by::text, true);
    v_day := least(r.due_day, extract(day from (p_month + interval '1 month - 1 day'))::integer);
    v_deadline := (make_date(extract(year from p_month)::integer,extract(month from p_month)::integer,v_day) + r.due_time) at time zone 'Asia/Yekaterinburg';
    if v_deadline < now() then continue; end if;
    v_priority := (jsonb_populate_record(null::public.tasks, jsonb_build_object('priority',r.priority))).priority;
    insert into public.tasks(title,description,expected_result,assignee_id,created_by,project_id,priority,status,deadline)
    values (r.title,r.description,r.expected_result,r.assignee_id,r.created_by,r.project_id,v_priority,'new',
      v_deadline)
    returning id into v_task_id;
    insert into public.recurring_task_instances(template_id,period,task_id) values (r.id,p_month,v_task_id);
    v_count := v_count + 1;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims,''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub,''), true);
  return v_count;
end $$;

revoke all on function public.nu_generate_recurring(date) from public;
grant execute on function public.nu_generate_recurring(date) to authenticated;
grant select,insert,update,delete on public.recurring_task_templates to authenticated;
grant select on public.recurring_task_instances to authenticated;
commit;
