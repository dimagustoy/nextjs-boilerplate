-- Apply after Telegram migrations. Existing tasks and monthly rules are preserved.
begin;
alter table public.recurring_task_templates
  add column frequency text not null default 'monthly' check (frequency in ('daily','weekly','monthly')),
  add column month_pattern text not null default 'all' check (month_pattern in ('all','odd','even')),
  add column due_kind text not null default 'day' check (due_kind in ('day','last_day','last_weekday')),
  add column due_weekday integer not null default 6 check (due_weekday between 1 and 7),
  add column reminder_mode text not null default 'offsets' check (reminder_mode in ('offsets','month_day')),
  add column reminder_day integer not null default 1 check (reminder_day between 1 and 31),
  add column starts_on date not null default ((now() at time zone 'Asia/Yekaterinburg')::date),
  add column preset_key text;
create unique index nu_recurring_preset_unique on public.recurring_task_templates(assignee_id,preset_key);
alter table public.recurring_task_templates add constraint nu_recurring_reminders_valid
  check (cardinality(reminder_days) between 1 and 32 and array_position(reminder_days,null) is null and 0 <= all(reminder_days) and 31 >= all(reminder_days));

-- Store actual due dates as occurrence keys, including legacy monthly instances.
update public.recurring_task_instances i set period=coalesce(
  ((select (h.new_value->>'deadline')::timestamptz from public.task_history h where h.task_id=i.task_id and h.action='created' limit 1) at time zone 'Asia/Yekaterinburg')::date,
  i.period+least(r.due_day,extract(day from i.period+interval '1 month - 1 day')::integer)-1)
from public.recurring_task_templates r where r.id=i.template_id;
alter table public.recurring_task_instances add column reminder_days integer[];
update public.recurring_task_instances i set reminder_days=r.reminder_days from public.recurring_task_templates r where r.id=i.template_id;
-- Keep a tombstone when an owner deletes a generated task: the next Cron must not recreate it.
alter table public.recurring_task_instances drop constraint recurring_task_instances_task_id_fkey;
alter table public.recurring_task_instances alter column task_id drop not null;
alter table public.recurring_task_instances add constraint recurring_task_instances_task_id_fkey foreign key(task_id) references public.tasks(id) on delete set null;
drop policy nu_recurring_instances_read on public.recurring_task_instances;
create policy nu_recurring_instances_read on public.recurring_task_instances for select to authenticated
using (exists(select 1 from public.recurring_task_templates r where r.id=template_id));

-- Pure calendar calculation, used by both generation and calendar verification.
create function public.nu_recurring_dates(p_rule public.recurring_task_templates,p_month date)
returns table(due_date date,notify_date date,offsets integer[]) language plpgsql stable set search_path=public as $$
declare d date; last_day date := (p_month+interval '1 month - 1 day')::date; days integer[]; n date;
begin
  for d in select s::date from generate_series(p_month::timestamp,last_day::timestamp,interval '1 day') s loop
    if d < p_rule.starts_on then continue; end if;
    if p_rule.frequency='weekly' and extract(isodow from d)::integer<>p_rule.due_weekday then continue; end if;
    if p_rule.frequency='monthly' then
      if p_rule.month_pattern='odd' and mod(extract(month from d)::integer,2)=0 then continue; end if;
      if p_rule.month_pattern='even' and mod(extract(month from d)::integer,2)=1 then continue; end if;
      if p_rule.due_kind='day' and extract(day from d)::integer<>least(p_rule.due_day,extract(day from last_day)::integer) then continue; end if;
      if p_rule.due_kind='last_day' and d<>last_day then continue; end if;
      if p_rule.due_kind='last_weekday' and (extract(isodow from d)::integer<>p_rule.due_weekday or d+7<=last_day) then continue; end if;
    end if;
    if p_rule.reminder_mode='month_day' and p_rule.frequency='monthly' then
      n:=p_month+least(p_rule.reminder_day,extract(day from last_day)::integer)-1;
      -- A day after the deadline means the preceding month's notification.
      if n>d then
        n:=(p_month-interval '1 month')::date+least(p_rule.reminder_day,extract(day from p_month-1)::integer)-1;
      end if;
      days:=array[d-n];
    else
      days:=p_rule.reminder_days;
      select d-max(x) into n from unnest(days) x;
    end if;
    due_date:=d; notify_date:=n; offsets:=days; return next;
  end loop;
end $$;
revoke all on function public.nu_recurring_dates(public.recurring_task_templates,date) from public;
grant execute on function public.nu_recurring_dates(public.recurring_task_templates,date) to authenticated;

create or replace function public.nu_generate_recurring(p_month date) returns integer
language plpgsql security definer set search_path=public as $$
declare r public.recurring_task_templates; occurrence record; v_task_id uuid; v_priority public.tasks.priority%type;
 v_deadline timestamptz; v_claims text:=current_setting('request.jwt.claims',true); v_sub text:=current_setting('request.jwt.claim.sub',true);
 v_today date:=(now() at time zone 'Asia/Yekaterinburg')::date; v_count integer:=0;
begin
 if auth.uid() is not null and public.nu_active_role() is distinct from 'owner' then raise exception 'Only owner can generate recurring tasks'; end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Month must start on day one'; end if;
 if p_month<date_trunc('month',v_today)::date or p_month>(date_trunc('month',v_today)+interval '2 months')::date then raise exception 'Only upcoming months can be generated'; end if;
 if (now() at time zone 'Asia/Yekaterinburg')::time<'08:00' then return 0; end if;
 for r in select rt.* from public.recurring_task_templates rt
 join public.profiles creator on creator.id=rt.created_by and creator.is_active and creator.role::text='owner'
 join public.profiles assignee on assignee.id=rt.assignee_id and assignee.is_active where rt.is_active
 loop
   for occurrence in select * from public.nu_recurring_dates(r,p_month) loop
     if occurrence.notify_date>v_today then continue; end if;
     v_deadline:=(occurrence.due_date+r.due_time) at time zone 'Asia/Yekaterinburg';
     if v_deadline<now() then continue; end if;
     perform pg_advisory_xact_lock(hashtextextended(r.id::text||occurrence.due_date::text,0));
     if exists(select 1 from public.recurring_task_instances where template_id=r.id and
       (period=occurrence.due_date or r.frequency='monthly' and date_trunc('month',period)::date=p_month)) then continue; end if;
     perform set_config('request.jwt.claims',jsonb_build_object('sub',r.created_by,'role','authenticated')::text,true);
     perform set_config('request.jwt.claim.sub',r.created_by::text,true);
     v_priority:=(jsonb_populate_record(null::public.tasks,jsonb_build_object('priority',r.priority))).priority;
     insert into public.tasks(title,description,expected_result,assignee_id,created_by,project_id,priority,status,deadline)
     values(r.title,r.description,r.expected_result,r.assignee_id,r.created_by,r.project_id,v_priority,'new',v_deadline) returning id into v_task_id;
     insert into public.recurring_task_instances(template_id,period,task_id,reminder_days) values(r.id,occurrence.due_date,v_task_id,occurrence.offsets);
     v_count:=v_count+1;
   end loop;
 end loop;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
 return v_count;
end $$;

-- Snapshot reminder offsets per occurrence; later template edits do not change existing tasks.
create or replace function public.nu_telegram_reminders() returns integer
language plpgsql security definer set search_path=public as $$
declare v_today date:=(now() at time zone 'Asia/Yekaterinburg')::date; v_count integer;
begin
 if (now() at time zone 'Asia/Yekaterinburg')::time<'08:00' then return 0; end if;
 perform pg_advisory_xact_lock(83003001);
 insert into public.telegram_outbox(user_id,task_id,kind,dedupe_key,expected_deadline)
 select l.user_id,t.id,case when t.deadline<now() then 'overdue' else 'reminder' end,
 'reminder:'||t.id::text||':'||l.user_id::text||':'||v_today::text||':'||t.deadline::text,t.deadline
 from public.tasks t join public.telegram_links l on true join public.profiles p on p.id=l.user_id and p.is_active
 left join public.recurring_task_instances i on i.task_id=t.id
 left join public.recurring_task_templates rt on rt.id=i.template_id
 where t.status<>'completed' and public.nu_telegram_visible(l.user_id,t.id)
 and ((l.user_id=t.assignee_id and t.status<>'review' and
 ((t.deadline at time zone 'Asia/Yekaterinburg')::date-v_today=any(coalesce(i.reminder_days,rt.reminder_days,array[2,0])) or t.deadline<now()))
 or p.role::text='owner' and t.deadline<now())
 -- The newly created task notification already serves as today's reminder.
 and not (i.task_id is not null and t.deadline>=now() and exists(
 select 1 from public.telegram_outbox o where o.task_id=t.id and o.user_id=l.user_id and o.kind='created'
 and (o.created_at at time zone 'Asia/Yekaterinburg')::date=v_today and o.state in ('pending','sending','sent')))
 on conflict(dedupe_key) do nothing;
 get diagnostics v_count=row_count; return v_count;
end $$;
commit;
