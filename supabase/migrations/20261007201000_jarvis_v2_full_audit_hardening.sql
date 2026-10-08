begin;

create or replace function public.nu_dependency_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_assignee uuid; v_actor uuid;
begin
  v_actor := public.nu_effective_actor();
  if tg_op = 'INSERT' then
    if v_actor is null or new.created_by is distinct from v_actor then raise exception 'Dependency creation denied'; end if;
    select assignee_id into v_assignee from public.tasks where id = new.task_id;
    if v_assignee is null or not public.nu_actor_can_assign(v_actor, v_assignee) then raise exception 'Dependency management denied'; end if;
    if exists (
      with recursive chain(id) as (
        select d.depends_on_task_id from public.task_dependencies d where d.task_id = new.depends_on_task_id
        union
        select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
      ) select 1 from chain where id = new.task_id
    ) then raise exception 'Dependency cycle denied'; end if;
  end if;
  return new;
end $$;
revoke all on function public.nu_dependency_guard() from public, anon, authenticated;

alter table public.jarvis_action_bundles
  add column if not exists state text not null default 'pending',
  add column if not exists claimed_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists result jsonb,
  add column if not exists last_error text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='jarvis_action_bundles_state_check') then
    alter table public.jarvis_action_bundles add constraint jarvis_action_bundles_state_check
      check (state in ('pending','executing','applied','cancelled','expired','failed'));
  end if;
end $$;
create index if not exists jarvis_action_bundles_state_idx on public.jarvis_action_bundles(user_id,chat_id,state,created_at desc);

create table if not exists public.telegram_processed_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);
alter table public.telegram_processed_updates enable row level security;
revoke all on public.telegram_processed_updates from public, anon, authenticated;
grant select,insert,delete on public.telegram_processed_updates to service_role;

create or replace function public.nu_telegram_accept_update(p_update bigint) returns boolean
language plpgsql security definer set search_path=public
as $$declare v_count integer;
begin
  perform public.nu_jarvis_assert_service();
  if p_update is null or p_update < 0 then return true; end if;
  insert into public.telegram_processed_updates(update_id) values(p_update) on conflict do nothing;
  get diagnostics v_count=row_count;
  if mod(abs(p_update),100)=0 then delete from public.telegram_processed_updates where created_at < now()-interval '30 days'; end if;
  return v_count=1;
end $$;

create or replace function public.nu_jarvis_save_action_bundle(p_actor uuid,p_chat bigint,p_actions jsonb) returns uuid
language plpgsql security definer set search_path=public
as $$declare v_id uuid;
begin
  perform public.nu_jarvis_assert_service();
  if p_actor is null or p_chat is null or p_chat=0 or p_actions is null or jsonb_typeof(p_actions)<>'array'
    or jsonb_array_length(p_actions)<1 or jsonb_array_length(p_actions)>20 then raise exception 'Invalid action bundle'; end if;
  if public.nu_actor_role(p_actor) is null then raise exception 'Actor unavailable'; end if;
  update public.jarvis_action_bundles set state='cancelled',finished_at=now(),last_error='superseded'
    where user_id=p_actor and chat_id=p_chat and state='pending';
  insert into public.jarvis_action_bundles(user_id,chat_id,actions,state)
    values(p_actor,p_chat,p_actions,'pending') returning id into v_id;
  return v_id;
end $$;

create or replace function public.nu_jarvis_claim_action_bundle(p_id uuid,p_actor uuid,p_chat bigint) returns jsonb
language plpgsql security definer set search_path=public
as $$declare v_actions jsonb;
begin
  perform public.nu_jarvis_assert_service();
  update public.jarvis_action_bundles set state='expired',finished_at=now(),last_error='expired'
    where id=p_id and user_id=p_actor and chat_id=p_chat and state='pending' and expires_at<=now();
  update public.jarvis_action_bundles set state='executing',claimed_at=now(),last_error=null
    where id=p_id and user_id=p_actor and chat_id=p_chat and state='pending' and expires_at>now()
    returning actions into v_actions;
  return v_actions;
end $$;

create or replace function public.nu_jarvis_cancel_action_bundle(p_id uuid,p_actor uuid,p_chat bigint) returns boolean
language plpgsql security definer set search_path=public
as $$declare v_count integer;
begin
  perform public.nu_jarvis_assert_service();
  update public.jarvis_action_bundles set state='cancelled',finished_at=now(),last_error=null
    where id=p_id and user_id=p_actor and chat_id=p_chat and state='pending';
  get diagnostics v_count=row_count; return v_count=1;
end $$;

create or replace function public.nu_jarvis_finish_action_bundle(p_id uuid,p_actor uuid,p_chat bigint,p_success boolean,p_result jsonb default null,p_error text default null) returns void
language plpgsql security definer set search_path=public
as $$begin
  perform public.nu_jarvis_assert_service();
  if p_success then
    update public.jarvis_action_bundles set state='applied',finished_at=now(),result=p_result,last_error=null
      where id=p_id and user_id=p_actor and chat_id=p_chat and state='executing';
  else
    update public.jarvis_action_bundles set
      state=case when expires_at>now() then 'pending' else 'failed' end,
      claimed_at=null,finished_at=case when expires_at<=now() then now() else null end,last_error=left(coalesce(p_error,'failed'),1000)
      where id=p_id and user_id=p_actor and chat_id=p_chat and state='executing';
  end if;
end $$;

create table if not exists public.jarvis_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id bigint not null check(chat_id<>0),
  task_id uuid references public.tasks(id) on delete set null,
  body text not null check(length(trim(body)) between 1 and 1200),
  remind_at timestamptz not null,
  state text not null default 'pending' check(state in ('pending','sending','sent','cancelled','failed')),
  attempts integer not null default 0,
  lease_id uuid,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text
);
create index if not exists jarvis_reminders_due_idx on public.jarvis_reminders(remind_at,available_at) where state in ('pending','sending');
alter table public.jarvis_reminders enable row level security;
revoke all on public.jarvis_reminders from public,anon,authenticated;
grant select,insert,update,delete on public.jarvis_reminders to service_role;

create or replace function public.nu_jarvis_apply_action_bundle_v2(p_actor uuid,p_chat bigint,p_actions jsonb) returns jsonb
language plpgsql security definer set search_path=public
as $$declare
  a jsonb; v_core jsonb; v_core_result jsonb; v_results jsonb:='[]'::jsonb; v_count integer:=0;
  v_id uuid; v_task uuid; v_when timestamptz;
begin
  perform public.nu_jarvis_assert_service();
  if p_actions is null or jsonb_typeof(p_actions)<>'array' or jsonb_array_length(p_actions)<1 or jsonb_array_length(p_actions)>20 then raise exception 'Actions must be an array'; end if;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_core
    from jsonb_array_elements(p_actions) where value->>'type' not in ('create_reminder','cancel_reminder');
  if jsonb_array_length(v_core)>0 then
    v_core_result:=public.nu_jarvis_apply_action_bundle(p_actor,v_core);
    v_count:=v_count+coalesce((v_core_result->>'count')::integer,0);
    v_results:=v_results||coalesce(v_core_result->'results','[]'::jsonb);
  end if;
  for a in select value from jsonb_array_elements(p_actions) where value->>'type' in ('create_reminder','cancel_reminder') loop
    if a->>'type'='create_reminder' then
      v_when:=nullif(a->>'remind_at','')::timestamptz;
      v_task:=nullif(a->>'task_id','')::uuid;
      if v_when is null or v_when<=now() or nullif(trim(coalesce(a->>'body','')),'') is null then raise exception 'Invalid reminder'; end if;
      if v_task is not null and not exists(select 1 from public.tasks t where t.id=v_task and public.nu_actor_can_view_task(p_actor,t)) then raise exception 'Reminder task denied'; end if;
      insert into public.jarvis_reminders(user_id,chat_id,task_id,body,remind_at)
        values(p_actor,p_chat,v_task,trim(a->>'body'),v_when) returning id into v_id;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('type','create_reminder','reminder_id',v_id,'task_id',v_task));
    else
      v_id:=nullif(a->>'reminder_id','')::uuid;
      update public.jarvis_reminders set state='cancelled',lease_id=null,last_error=null
        where id=v_id and user_id=p_actor and state in ('pending','sending');
      if not found then raise exception 'Reminder unavailable'; end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('type','cancel_reminder','reminder_id',v_id));
    end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('count',v_count,'results',v_results);
end $$;

create or replace function public.nu_jarvis_reminder_claim(p_limit integer default 10)
returns table(id uuid,lease_id uuid,user_id uuid,chat_id bigint,task_id uuid,body text,remind_at timestamptz)
language plpgsql security definer set search_path=public
as $$begin
  update public.jarvis_reminders r set state='failed',lease_id=null,last_error='Delivery retries exhausted'
    where r.state='sending' and r.available_at<=now() and r.attempts>=6;
  return query with candidates as (
    select r.id from public.jarvis_reminders r join public.profiles p on p.id=r.user_id and p.is_active
    where r.state in ('pending','sending') and r.remind_at<=now() and r.available_at<=now() and r.attempts<6
      and exists(select 1 from public.telegram_links l where l.user_id=r.user_id)
    order by r.remind_at,r.created_at for update skip locked limit least(greatest(p_limit,1),20)
  ), claimed as (
    update public.jarvis_reminders r set state='sending',attempts=r.attempts+1,lease_id=gen_random_uuid(),available_at=now()+interval '5 minutes'
    from candidates c where r.id=c.id returning r.*
  ) select c.id,c.lease_id,c.user_id,c.chat_id,c.task_id,c.body,c.remind_at from claimed c;
end $$;

create or replace function public.nu_jarvis_reminder_finish(p_id uuid,p_lease uuid,p_code integer,p_retry integer default 60) returns void
language plpgsql security definer set search_path=public
as $$begin
  update public.jarvis_reminders r set
    state=case when p_code=200 then 'sent' when p_code in (400,403) or r.attempts>=6 then 'failed' else 'pending' end,
    sent_at=case when p_code=200 then now() else null end,
    available_at=now()+make_interval(secs=>least(greatest(p_retry,60),3600)),lease_id=null,
    last_error=case when p_code=200 then null else 'Telegram/transport '||p_code::text end
  where r.id=p_id and r.lease_id=p_lease and r.state='sending';
end $$;

revoke all on function public.nu_telegram_accept_update(bigint) from public,anon,authenticated;
revoke all on function public.nu_jarvis_save_action_bundle(uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.nu_jarvis_claim_action_bundle(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.nu_jarvis_cancel_action_bundle(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.nu_jarvis_finish_action_bundle(uuid,uuid,bigint,boolean,jsonb,text) from public,anon,authenticated;
revoke all on function public.nu_jarvis_apply_action_bundle_v2(uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.nu_jarvis_reminder_claim(integer) from public,anon,authenticated;
revoke all on function public.nu_jarvis_reminder_finish(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.nu_telegram_accept_update(bigint),public.nu_jarvis_save_action_bundle(uuid,bigint,jsonb),public.nu_jarvis_claim_action_bundle(uuid,uuid,bigint),public.nu_jarvis_cancel_action_bundle(uuid,uuid,bigint),public.nu_jarvis_finish_action_bundle(uuid,uuid,bigint,boolean,jsonb,text),public.nu_jarvis_apply_action_bundle_v2(uuid,bigint,jsonb),public.nu_jarvis_reminder_claim(integer),public.nu_jarvis_reminder_finish(uuid,uuid,integer,integer) to service_role;

commit;
