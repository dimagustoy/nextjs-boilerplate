begin;

create or replace function public.nu_telegram_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_actor uuid; v_key text; r record;
begin
  if current_setting('nu.jarvis_bundle', true) = '1' then return new; end if;
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
    values(r.user_id,new.task_id,v_kind,v_key || ':' || r.user_id::text)
    on conflict(dedupe_key) do nothing;
  end loop;
  return new;
end $$;

create or replace function public.nu_jarvis_apply_action_bundle_v2(p_actor uuid, p_actions jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a jsonb; kind text; v_task uuid; t public.tasks; v_expected timestamptz;
  v_seen uuid[] := '{}'::uuid[]; v_core jsonb := '[]'::jsonb; v_core_result jsonb := '{}'::jsonb;
  v_affected uuid[] := '{}'::uuid[]; v_deleted integer := 0; v_members integer := 0; v_role text;
begin
  perform public.nu_jarvis_assert_service();
  v_role := public.nu_actor_role(p_actor);
  if v_role is null then raise exception 'Actor unavailable'; end if;
  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then raise exception 'Actions must be an array'; end if;
  if jsonb_array_length(p_actions) < 1 or jsonb_array_length(p_actions) > 20 then raise exception 'Action bundle size denied'; end if;
  perform set_config('nu.jarvis_actor', p_actor::text, true);
  perform set_config('nu.jarvis_bundle', '1', true);

  for a in select value from jsonb_array_elements(p_actions) loop
    kind := a->>'type';
    if kind in ('update_task','delete_task','add_dependency','remove_dependency','set_checklist_item') then
      v_task := nullif(a->>'task_id','')::uuid;
      if v_task is not null and not (v_task = any(v_seen)) then
        select * into t from public.tasks where id=v_task for update;
        if not found then raise exception 'Task not found'; end if;
        v_expected := nullif(a->>'expected_updated_at','')::timestamptz;
        if v_expected is not null and t.updated_at is distinct from v_expected then raise exception 'Task changed since proposal'; end if;
        v_seen := array_append(v_seen,v_task);
      end if;
    end if;
  end loop;

  for a in select value from jsonb_array_elements(p_actions) loop
    kind := a->>'type';
    if kind = 'delete_task' then
      if v_role <> 'owner' then raise exception 'Only owner can delete tasks'; end if;
      v_task := nullif(a->>'task_id','')::uuid;
      if v_task is null or not exists(select 1 from public.tasks where id=v_task) then raise exception 'Task not found'; end if;
      delete from public.tasks where id=v_task;
      v_deleted := v_deleted + 1;
    elsif kind = 'update_member' then
      if v_role <> 'owner' then raise exception 'Team management denied'; end if;
      if nullif(a->>'member_id','')::uuid = p_actor then raise exception 'Owner cannot modify self through Jarvis'; end if;
      if a->>'member_role' is not null and a->>'member_role' not in ('manager','smm','senior_master') then raise exception 'Invalid member role'; end if;
      update public.profiles set
        full_name = case when nullif(trim(coalesce(a->>'full_name','')),'') is not null then left(trim(a->>'full_name'),100) else full_name end,
        role = case when a->>'member_role' is not null then (a->>'member_role')::public.user_role else role end,
        is_active = case when a->>'member_is_active' is not null then (a->>'member_is_active')::boolean else is_active end,
        updated_at = now()
      where id=nullif(a->>'member_id','')::uuid;
      if not found then raise exception 'Team member not found'; end if;
      v_members := v_members + 1;
    elsif kind = 'invite_member' then
      raise exception 'Invite member is handled by the application layer';
    else
      v_core := v_core || jsonb_build_array(a);
      if nullif(a->>'task_id','') is not null then v_affected := array_append(v_affected,(a->>'task_id')::uuid); end if;
    end if;
  end loop;

  if jsonb_array_length(v_core) > 0 then
    v_core_result := public.nu_jarvis_apply_action_bundle(p_actor,v_core);
    select coalesce(array_agg(distinct (x->>'task_id')::uuid) filter (where x ? 'task_id'),'{}'::uuid[])
      into v_seen from jsonb_array_elements(coalesce(v_core_result->'results','[]'::jsonb)) x;
    v_affected := v_affected || v_seen;
  end if;

  insert into public.telegram_outbox(user_id,task_id,kind,dedupe_key)
  select distinct l.user_id,t.id,'jarvis_bundle','jarvis_bundle:'||txid_current()::text||':'||t.id::text||':'||l.user_id::text
  from unnest(v_affected) q(task_id)
  join public.tasks t on t.id=q.task_id
  join public.telegram_links l on public.nu_telegram_visible(l.user_id,t.id)
  where l.user_id is distinct from p_actor
  on conflict(dedupe_key) do nothing;

  return jsonb_build_object('count',coalesce((v_core_result->>'count')::integer,0)+v_deleted+v_members,'core',v_core_result,'deleted',v_deleted,'members_updated',v_members);
end $$;

revoke all on function public.nu_jarvis_apply_action_bundle_v2(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.nu_jarvis_apply_action_bundle_v2(uuid,jsonb) to service_role;

commit;
