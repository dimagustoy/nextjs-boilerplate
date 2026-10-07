begin;

create or replace function public.nu_telegram_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_actor uuid; v_key text; v_batch text; r record;
begin
  v_batch := nullif(current_setting('nu.jarvis_batch', true), '');
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
  if v_batch is not null then v_key := 'jarvis:' || v_batch || ':' || new.task_id::text; end if;
  for r in select l.user_id from public.telegram_links l
    where public.nu_telegram_visible(l.user_id,new.task_id) and l.user_id is distinct from v_actor
  loop
    insert into public.telegram_outbox(user_id,task_id,kind,dedupe_key)
    values(r.user_id,new.task_id,v_kind,v_key || ':' || r.user_id::text) on conflict(dedupe_key) do nothing;
  end loop;
  return new;
end $$;

create or replace function public.nu_jarvis_apply_action_bundle_v2(p_actor uuid,p_chat bigint,p_actions jsonb) returns jsonb
language plpgsql security definer set search_path=public
as $$declare
  a jsonb; v_core jsonb; v_core_result jsonb; v_results jsonb:='[]'::jsonb; v_count integer:=0;
  v_id uuid; v_task uuid; v_when timestamptz;
begin
  perform public.nu_jarvis_assert_service();
  if p_actions is null or jsonb_typeof(p_actions)<>'array' or jsonb_array_length(p_actions)<1 or jsonb_array_length(p_actions)>20 then raise exception 'Actions must be an array'; end if;
  perform set_config('nu.jarvis_batch',gen_random_uuid()::text,true);
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

commit;
