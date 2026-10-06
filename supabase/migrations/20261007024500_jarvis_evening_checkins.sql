begin;

create table if not exists public.telegram_checkin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null,
  state text not null default 'queued' check (state in ('queued','sending','awaiting','done','skipped','failed')),
  task_ids uuid[] not null default '{}',
  message_id bigint,
  raw_reply text,
  attempts integer not null default 0,
  lease_id uuid,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  answered_at timestamptz,
  unique(user_id, checkin_date)
);
create index if not exists telegram_checkin_sessions_state_idx on public.telegram_checkin_sessions(state,available_at);
alter table public.telegram_checkin_sessions enable row level security;
revoke all on public.telegram_checkin_sessions from anon, authenticated;
grant all on public.telegram_checkin_sessions to service_role;

alter table public.telegram_pending_actions drop constraint if exists telegram_pending_actions_action_type_check;
alter table public.telegram_pending_actions add constraint telegram_pending_actions_action_type_check
  check (action_type in ('create_task','update_status','change_deadline','add_comment','checkin_batch'));

create or replace function public.nu_jarvis_checkin_claim(p_limit integer default 10)
returns table(id uuid, lease_id uuid, user_id uuid, chat_id bigint, task_ids uuid[], tasks jsonb)
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Yekaterinburg')::date;
  v_time time := (now() at time zone 'Asia/Yekaterinburg')::time;
begin
  perform public.nu_jarvis_assert_service();
  if v_time < '18:00'::time then return; end if;
  perform pg_advisory_xact_lock(83003002);

  insert into public.telegram_checkin_sessions(user_id,checkin_date,task_ids)
  select l.user_id, v_today,
    array(
      select t.id
      from public.tasks t
      where t.assignee_id=l.user_id and t.status <> 'completed'
        and (t.deadline <= now()+interval '2 days' or t.status in ('waiting','at_risk','review'))
      order by case when t.deadline < now() then 0 else 1 end, t.deadline
      limit 8
    )
  from public.telegram_links l
  join public.profiles p on p.id=l.user_id and p.is_active
  where p.role::text <> 'owner'
    and exists(
      select 1 from public.tasks t
      where t.assignee_id=l.user_id and t.status <> 'completed'
        and (t.deadline <= now()+interval '2 days' or t.status in ('waiting','at_risk','review'))
    )
  on conflict(user_id,checkin_date) do nothing;

  update public.telegram_checkin_sessions s
  set state='failed', lease_id=null
  where s.state='sending' and s.available_at<=now() and s.attempts>=5;

  return query
  with candidates as (
    select s.id
    from public.telegram_checkin_sessions s
    where s.checkin_date=v_today and s.state in ('queued','sending') and s.available_at<=now() and s.attempts<5
    order by s.created_at
    for update skip locked
    limit least(greatest(p_limit,1),20)
  ), claimed as (
    update public.telegram_checkin_sessions s
    set state='sending',attempts=s.attempts+1,lease_id=gen_random_uuid(),available_at=now()+interval '5 minutes'
    from candidates c where s.id=c.id
    returning s.*
  )
  select c.id,c.lease_id,c.user_id,l.chat_id,c.task_ids,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,'title',t.title,'status',t.status::text,'deadline',t.deadline,'priority',t.priority::text
      ) order by array_position(c.task_ids,t.id))
      from public.tasks t where t.id=any(c.task_ids)
    ),'[]'::jsonb)
  from claimed c join public.telegram_links l on l.user_id=c.user_id;
end $$;

create or replace function public.nu_jarvis_checkin_finish(
  p_id uuid, p_lease uuid, p_code integer, p_message_id bigint default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.nu_jarvis_assert_service();
  update public.telegram_checkin_sessions s set
    state=case when p_code=200 then 'awaiting' when s.attempts>=5 or p_code in (400,403) then 'failed' else 'queued' end,
    message_id=case when p_code=200 then p_message_id else s.message_id end,
    sent_at=case when p_code=200 then now() else s.sent_at end,
    available_at=case when p_code=200 then s.available_at else now()+interval '5 minutes' end,
    lease_id=null
  where s.id=p_id and s.lease_id=p_lease and s.state='sending';
end $$;

revoke all on function public.nu_jarvis_checkin_claim(integer) from public,anon,authenticated;
revoke all on function public.nu_jarvis_checkin_finish(uuid,uuid,integer,bigint) from public,anon,authenticated;
grant execute on function public.nu_jarvis_checkin_claim(integer) to service_role;
grant execute on function public.nu_jarvis_checkin_finish(uuid,uuid,integer,bigint) to service_role;

commit;