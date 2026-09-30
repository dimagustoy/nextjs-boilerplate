-- Telegram transport. Existing task permissions and Auth remain unchanged.
begin;
create table public.telegram_links (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  chat_id bigint not null unique check (chat_id > 0),
  username text,
  connected_at timestamptz not null default now()
);
create table public.telegram_link_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_chat bigint
);
create table public.telegram_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  kind text not null,
  dedupe_key text not null unique,
  expected_deadline timestamptz,
  state text not null default 'pending' check (state in ('pending','sending','sent','cancelled','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text
);
create index nu_telegram_pending on public.telegram_outbox(available_at) where state in ('pending','sending');
alter table public.telegram_links enable row level security;
alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_outbox enable row level security;
revoke all on public.telegram_links, public.telegram_link_tokens, public.telegram_outbox from anon, authenticated;
create policy nu_telegram_own_read on public.telegram_links for select to authenticated
using (user_id = auth.uid() and public.nu_active_role() is not null);
grant select(user_id,username,connected_at) on public.telegram_links to authenticated;
grant all on public.telegram_links, public.telegram_link_tokens, public.telegram_outbox to service_role;

create function public.nu_telegram_visible(p_user uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p cross join public.tasks t
    where p.id = p_user and p.is_active and t.id = p_task
    and (p.role::text = 'owner' or t.assignee_id = p.id or t.created_by = p.id
      or p.role::text = 'manager' and exists (select 1 from public.profiles a where a.id = t.assignee_id and a.role::text in ('smm','senior_master'))));
$$;
create function public.nu_telegram_bind(p_hash text, p_chat bigint, p_username text) returns boolean
language plpgsql security definer set search_path = public as $$
declare token public.telegram_link_tokens;
begin
  if p_chat is null or p_chat <= 0 then return false; end if;
  perform pg_advisory_xact_lock(p_chat);
  select * into token from public.telegram_link_tokens where token_hash = p_hash and expires_at > now() for update;
  if not found or not exists (select 1 from public.profiles where id = token.user_id and is_active) then return false; end if;
  if token.consumed_chat is not null then
    return token.consumed_chat = p_chat and exists (select 1 from public.telegram_links where user_id = token.user_id and chat_id = p_chat);
  end if;
  if exists (select 1 from public.telegram_links where chat_id = p_chat and user_id <> token.user_id) then return false; end if;
  insert into public.telegram_links(user_id,chat_id,username) values(token.user_id,p_chat,left(p_username,100))
  on conflict(user_id) do update set chat_id=excluded.chat_id,username=excluded.username,connected_at=now();
  update public.telegram_link_tokens set consumed_chat=p_chat where user_id=token.user_id;
  return true;
end $$;
create function public.nu_telegram_disconnect(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.telegram_link_tokens where user_id=p_user;
  delete from public.telegram_links where user_id=p_user;
  update public.telegram_outbox set state='cancelled',lease_id=null where user_id=p_user and state in ('pending','sending');
end $$;

-- Audit already records all task/deadline changes. Queue only for linked people
-- who can view the task; do not notify the actor about their own action.
create function public.nu_telegram_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_actor uuid; v_key text; r record;
begin
  if tg_table_name = 'task_comments' then
    v_kind := 'comment'; v_actor := new.author_id; v_key := 'comment:' || new.id::text;
  else
    v_actor := new.user_id; v_key := 'history:' || new.id::text;
    v_kind := new.action;
    if new.action = 'updated' then
      if new.old_value->>'status' is distinct from new.new_value->>'status' then v_kind := 'status';
      elsif new.old_value->>'deadline' is distinct from new.new_value->>'deadline' then v_kind := 'deadline';
      else v_kind := 'changed'; end if;
    end if;
  end if;
  for r in select l.user_id from public.telegram_links l
    where public.nu_telegram_visible(l.user_id,new.task_id) and l.user_id is distinct from v_actor
  loop
    insert into public.telegram_outbox(user_id,task_id,kind,dedupe_key)
    values(r.user_id,new.task_id,v_kind,v_key || ':' || r.user_id::text) on conflict(dedupe_key) do nothing;
  end loop;
  return new;
end $$;
create trigger nu_telegram_history after insert on public.task_history for each row execute function public.nu_telegram_event();
create trigger nu_telegram_comment after insert on public.task_comments for each row execute function public.nu_telegram_event();

create function public.nu_telegram_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Yekaterinburg')::date; v_count integer;
begin
  -- Every-minute dispatcher calls this too. Morning reminders start at 08:00.
  if (now() at time zone 'Asia/Yekaterinburg')::time < '08:00'::time then return 0; end if;
  perform pg_advisory_xact_lock(83003001);
  insert into public.telegram_outbox(user_id,task_id,kind,dedupe_key,expected_deadline)
  select l.user_id,t.id,case when t.deadline < now() then 'overdue' else 'reminder' end,
    'reminder:' || t.id::text || ':' || l.user_id::text || ':' || v_today::text || ':' || t.deadline::text,t.deadline
  from public.tasks t
  join public.telegram_links l on true
  join public.profiles p on p.id=l.user_id and p.is_active
  left join public.recurring_task_instances i on i.task_id=t.id
  left join public.recurring_task_templates rt on rt.id=i.template_id
  where t.status <> 'completed' and public.nu_telegram_visible(l.user_id,t.id)
    and ((l.user_id=t.assignee_id and t.status <> 'review'
      and ((t.deadline at time zone 'Asia/Yekaterinburg')::date-v_today = any(coalesce(rt.reminder_days,array[2,0])) or t.deadline < now()))
      or p.role::text='owner' and t.deadline < now())
  on conflict(dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function public.nu_telegram_claim(p_limit integer default 20)
returns table(id uuid,lease_id uuid,user_id uuid,chat_id bigint,task_id uuid,kind text,title text,status text,deadline timestamptz,expected_result text)
language plpgsql security definer set search_path = public as $$
begin
  update public.telegram_outbox o set state='cancelled',lease_id=null
  where o.state in ('pending','sending') and (
    not public.nu_telegram_visible(o.user_id,o.task_id)
    or not exists(select 1 from public.telegram_links l where l.user_id=o.user_id)
    or o.expected_deadline is not null and exists(select 1 from public.tasks t where t.id=o.task_id and (t.status='completed' or t.deadline is distinct from o.expected_deadline)));
  update public.telegram_outbox o set state='failed',lease_id=null,last_error='Delivery retries exhausted'
  where o.state='sending' and o.available_at <= now() and o.attempts >= 6;
  return query
    with candidates as (
      select o.id from public.telegram_outbox o where o.state in ('pending','sending') and o.available_at <= now() and o.attempts < 6
      order by o.available_at,o.created_at for update skip locked limit least(greatest(p_limit,1),20)
    ), claimed as (
      update public.telegram_outbox o set state='sending',attempts=o.attempts+1,lease_id=gen_random_uuid(),available_at=now()+interval '5 minutes'
      from candidates c where o.id=c.id returning o.*
    )
    select c.id,c.lease_id,c.user_id,l.chat_id,c.task_id,c.kind,t.title,t.status::text,t.deadline,t.expected_result
    from claimed c join public.telegram_links l on l.user_id=c.user_id join public.tasks t on t.id=c.task_id;
end $$;
create function public.nu_telegram_finish(p_id uuid,p_lease uuid,p_code integer,p_retry integer default 60) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.telegram_outbox o set
    state=case when p_code=200 then 'sent' when p_code in (400,403) or o.attempts>=6 then 'failed' else 'pending' end,
    sent_at=case when p_code=200 then now() else null end,
    available_at=now()+make_interval(secs=>least(greatest(p_retry,60),3600)),lease_id=null,
    last_error=case when p_code=200 then null else 'Telegram/transport ' || p_code::text end
  where o.id=p_id and o.lease_id=p_lease and o.state='sending';
end $$;

revoke all on function public.nu_telegram_visible(uuid,uuid), public.nu_telegram_bind(text,bigint,text),
  public.nu_telegram_disconnect(uuid), public.nu_telegram_event(), public.nu_telegram_reminders(),
  public.nu_telegram_claim(integer), public.nu_telegram_finish(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.nu_telegram_visible(uuid,uuid), public.nu_telegram_bind(text,bigint,text),
  public.nu_telegram_disconnect(uuid), public.nu_telegram_reminders(), public.nu_telegram_claim(integer),
  public.nu_telegram_finish(uuid,uuid,integer,integer) to service_role;
commit;
