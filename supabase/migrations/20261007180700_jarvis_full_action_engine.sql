begin;
create or replace function public.nu_jarvis_apply_action_bundle(p_actor uuid, p_actions jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  a jsonb;
  kind text;
  t public.tasks;
  v_task uuid;
  v_other uuid;
  v_id uuid;
  v_role text;
  v_deadline timestamptz;
  v_reason text;
  v_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_label text;
  v_expected text;
  v_old_done boolean;
  v_reminders integer[];
  v_rec public.recurring_task_templates;
  v_req public.deadline_requests;
begin
  perform public.nu_jarvis_assert_service();
  v_role := public.nu_actor_role(p_actor);
  if v_role is null then raise exception 'Actor unavailable'; end if;
  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then raise exception 'Actions must be an array'; end if;
  if jsonb_array_length(p_actions) < 1 or jsonb_array_length(p_actions) > 20 then raise exception 'Action bundle size denied'; end if;
  perform set_config('nu.jarvis_actor', p_actor::text, true);

  for a in select value from jsonb_array_elements(p_actions)
  loop
    kind := a->>'type';

    if kind = 'create_task' then
      if not public.nu_actor_can_assign(p_actor, nullif(a->>'assignee_id','')::uuid) then raise exception 'Assignment denied'; end if;
      v_deadline := nullif(a->>'deadline','')::timestamptz;
      if v_deadline is null or v_deadline <= now() then raise exception 'Deadline must be in the future'; end if;
      if coalesce(a->>'priority','normal') not in ('low','normal','high','critical') then raise exception 'Invalid priority'; end if;
      insert into public.tasks(title,description,expected_result,assignee_id,project_id,priority,deadline,created_by)
      values(trim(a->>'title'),nullif(trim(coalesce(a->>'description','')),''),trim(a->>'expected_result'),(a->>'assignee_id')::uuid,nullif(a->>'project_id','')::uuid,coalesce(a->>'priority','normal')::public.task_priority,v_deadline,p_actor)
      returning id into v_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'task_id',v_id));

    elsif kind = 'update_task' then
      v_task := nullif(a->>'task_id','')::uuid;
      select * into t from public.tasks where id=v_task for update;
      if not found or not public.nu_actor_can_view_task(p_actor,t) then raise exception 'Task update denied'; end if;
      if a->>'priority' is not null and a->>'priority' not in ('low','normal','high','critical') then raise exception 'Invalid priority'; end if;
      if a->>'status' is not null and a->>'status' not in ('new','accepted','in_progress','waiting','at_risk','review','completed') then raise exception 'Invalid status'; end if;
      if a->>'assignee_id' is not null and not public.nu_actor_can_assign(p_actor,(a->>'assignee_id')::uuid) then raise exception 'Assignment denied'; end if;
      if a->>'project_id' is not null and not exists(select 1 from public.projects where id=(a->>'project_id')::uuid) then raise exception 'Project not found'; end if;
      update public.tasks set
        title = case when nullif(trim(coalesce(a->>'title','')),'') is not null then trim(a->>'title') else title end,
        description = case when coalesce((a->>'clear_description')::boolean,false) then null when a->>'description' is not null then nullif(trim(a->>'description'),'') else description end,
        expected_result = case when nullif(trim(coalesce(a->>'expected_result','')),'') is not null then trim(a->>'expected_result') else expected_result end,
        priority = case when a->>'priority' is not null then (a->>'priority')::public.task_priority else priority end,
        status = case when a->>'status' is not null then (a->>'status')::public.task_status else status end,
        assignee_id = case when a->>'assignee_id' is not null then (a->>'assignee_id')::uuid else assignee_id end,
        project_id = case when coalesce((a->>'clear_project')::boolean,false) then null when a->>'project_id' is not null then (a->>'project_id')::uuid else project_id end,
        waiting_for = case when coalesce((a->>'clear_waiting_for')::boolean,false) then null when a->>'waiting_for' is not null then nullif(trim(a->>'waiting_for'),'') else waiting_for end,
        risk_reason = case when coalesce((a->>'clear_risk_reason')::boolean,false) then null when a->>'risk_reason' is not null then nullif(trim(a->>'risk_reason'),'') else risk_reason end
      where id=v_task;
      if a->>'deadline' is not null then
        v_deadline := (a->>'deadline')::timestamptz;
        v_reason := nullif(trim(coalesce(a->>'reason','')),'');
        if v_deadline <= now() or v_reason is null then raise exception 'Invalid deadline change'; end if;
        select * into t from public.tasks where id=v_task for update;
        if public.nu_actor_can_assign(p_actor,t.assignee_id) then
          update public.tasks set deadline=v_deadline, deadline_change_reason=v_reason, deadline_changes=deadline_changes+1 where id=v_task;
        elsif t.assignee_id=p_actor then
          insert into public.deadline_requests(task_id,requested_by,old_deadline,requested_deadline,reason)
          values(v_task,p_actor,t.deadline,v_deadline,v_reason);
        else raise exception 'Deadline change denied'; end if;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'task_id',v_task));

    elsif kind = 'add_comment' then
      v_task := nullif(a->>'task_id','')::uuid;
      select * into t from public.tasks where id=v_task;
      if not found or not public.nu_actor_can_view_task(p_actor,t) or nullif(trim(coalesce(a->>'body','')),'') is null then raise exception 'Comment denied'; end if;
      insert into public.task_comments(task_id,author_id,body) values(v_task,p_actor,trim(a->>'body')) returning id into v_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'task_id',v_task));

    elsif kind = 'add_dependency' then
      v_task := nullif(a->>'task_id','')::uuid;
      v_other := nullif(a->>'depends_on_task_id','')::uuid;
      select * into t from public.tasks where id=v_task;
      if not found or not public.nu_actor_can_assign(p_actor,t.assignee_id) then raise exception 'Dependency management denied'; end if;
      if not exists(select 1 from public.tasks x where x.id=v_other and public.nu_actor_can_view_task(p_actor,x)) then raise exception 'Dependency target denied'; end if;
      insert into public.task_dependencies(task_id,depends_on_task_id,created_by) values(v_task,v_other,p_actor) on conflict do nothing;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'task_id',v_task));

    elsif kind = 'remove_dependency' then
      v_task := nullif(a->>'task_id','')::uuid;
      v_other := nullif(a->>'depends_on_task_id','')::uuid;
      select * into t from public.tasks where id=v_task;
      if not found or not public.nu_actor_can_assign(p_actor,t.assignee_id) then raise exception 'Dependency management denied'; end if;
      delete from public.task_dependencies where task_id=v_task and depends_on_task_id=v_other;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'task_id',v_task));

    elsif kind = 'set_checklist_item' then
      v_task := nullif(a->>'task_id','')::uuid;
      select * into t from public.tasks where id=v_task for update;
      if not found or not public.nu_actor_can_view_task(p_actor,t) or t.status='completed' or not(t.assignee_id=p_actor or public.nu_actor_can_assign(p_actor,t.assignee_id)) then raise exception 'Checklist update denied'; end if;
      if a->>'item_index' is null or (a->>'item_index')::integer < 0 or a->>'done' is null then raise exception 'Invalid checklist item'; end if;
      select item into v_expected from (
        select regexp_replace(trim(line), '^[•*–-][[:space:]]+', '') as item,row_number() over(order by ord)-1 as item_number
        from unnest(string_to_array(coalesce(t.description,''),E'\n')) with ordinality lines(line,ord)
        where trim(line) ~ '^[•*–-][[:space:]]+'
      ) items where item_number=(a->>'item_index')::integer;
      v_label := a->>'label';
      if v_expected is null or v_expected is distinct from v_label then raise exception 'Checklist changed'; end if;
      select done into v_old_done from public.task_checklist_items where task_id=v_task and item_index=(a->>'item_index')::integer and label=v_label;
      insert into public.task_checklist_items(task_id,item_index,label,done,updated_by)
      values(v_task,(a->>'item_index')::integer,v_label,(a->>'done')::boolean,p_actor)
      on conflict(task_id,item_index,label) do update set done=excluded.done,updated_by=excluded.updated_by,updated_at=now();
      insert into public.task_history(task_id,user_id,action,old_value,new_value)
      values(v_task,p_actor,'updated',jsonb_build_object('checklist',jsonb_build_object('item',v_label,'done',coalesce(v_old_done,false))),jsonb_build_object('checklist',jsonb_build_object('item',v_label,'done',(a->>'done')::boolean)));
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'task_id',v_task));

    elsif kind = 'resolve_deadline_request' then
      select * into v_req from public.deadline_requests where id=nullif(a->>'request_id','')::uuid for update;
      if not found or v_req.status<>'pending' then raise exception 'Deadline request unavailable'; end if;
      select * into t from public.tasks where id=v_req.task_id;
      if not found or not public.nu_actor_can_assign(p_actor,t.assignee_id) then raise exception 'Deadline decision denied'; end if;
      if a->>'decision' not in ('approved','rejected') then raise exception 'Invalid deadline decision'; end if;
      update public.deadline_requests set status=a->>'decision' where id=v_req.id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'task_id',v_req.task_id));

    elsif kind = 'create_project' then
      if v_role <> 'owner' then raise exception 'Project management denied'; end if;
      insert into public.projects(name,description,owner_id,is_active)
      values(trim(a->>'project_name'),nullif(trim(coalesce(a->>'project_description','')),''),p_actor,coalesce((a->>'project_is_active')::boolean,true)) returning id into v_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'project_id',v_id));

    elsif kind = 'update_project' then
      if v_role <> 'owner' then raise exception 'Project management denied'; end if;
      v_id := nullif(a->>'project_id','')::uuid;
      update public.projects set
        name=case when nullif(trim(coalesce(a->>'project_name','')),'') is not null then trim(a->>'project_name') else name end,
        description=case when coalesce((a->>'clear_description')::boolean,false) then null when a->>'project_description' is not null then nullif(trim(a->>'project_description'),'') else description end,
        is_active=case when a->>'project_is_active' is not null then (a->>'project_is_active')::boolean else is_active end,
        updated_at=now()
      where id=v_id;
      if not found then raise exception 'Project not found'; end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'project_id',v_id));

    elsif kind = 'create_recurring_rule' then
      if v_role <> 'owner' then raise exception 'Recurring rule management denied'; end if;
      if not public.nu_actor_can_assign(p_actor,nullif(a->>'assignee_id','')::uuid) then raise exception 'Assignment denied'; end if;
      if a->'reminder_days' is not null and jsonb_typeof(a->'reminder_days')='array' then select array_agg(value::integer) into v_reminders from jsonb_array_elements_text(a->'reminder_days'); else v_reminders:=array[5,2,0]; end if;
      insert into public.recurring_task_templates(title,description,expected_result,assignee_id,created_by,project_id,priority,due_day,due_time,reminder_days,is_active,frequency,month_pattern,due_kind,due_weekday,reminder_mode,reminder_day,starts_on)
      values(trim(a->>'title'),nullif(trim(coalesce(a->>'description','')),''),trim(a->>'expected_result'),(a->>'assignee_id')::uuid,p_actor,nullif(a->>'project_id','')::uuid,coalesce(a->>'priority','normal'),coalesce((a->>'due_day')::integer,1),coalesce(nullif(a->>'due_time','')::time,'18:00'::time),v_reminders,coalesce((a->>'is_active')::boolean,true),coalesce(a->>'frequency','monthly'),coalesce(a->>'month_pattern','all'),coalesce(a->>'due_kind','day'),coalesce((a->>'due_weekday')::integer,1),coalesce(a->>'reminder_mode','offsets'),coalesce((a->>'reminder_day')::integer,1),coalesce(nullif(a->>'starts_on','')::date,(now() at time zone 'Asia/Yekaterinburg')::date)
      ) returning id into v_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'recurring_id',v_id));

    elsif kind = 'update_recurring_rule' then
      if v_role <> 'owner' then raise exception 'Recurring rule management denied'; end if;
      v_id := nullif(a->>'recurring_id','')::uuid;
      select * into v_rec from public.recurring_task_templates where id=v_id for update;
      if not found then raise exception 'Recurring rule not found'; end if;
      if a->'reminder_days' is not null and jsonb_typeof(a->'reminder_days')='array' then select array_agg(value::integer) into v_reminders from jsonb_array_elements_text(a->'reminder_days'); else v_reminders:=v_rec.reminder_days; end if;
      update public.recurring_task_templates set
        title=case when nullif(trim(coalesce(a->>'title','')),'') is not null then trim(a->>'title') else title end,
        description=case when coalesce((a->>'clear_description')::boolean,false) then null when a->>'description' is not null then nullif(trim(a->>'description'),'') else description end,
        expected_result=case when nullif(trim(coalesce(a->>'expected_result','')),'') is not null then trim(a->>'expected_result') else expected_result end,
        assignee_id=case when a->>'assignee_id' is not null then (a->>'assignee_id')::uuid else assignee_id end,
        project_id=case when coalesce((a->>'clear_project')::boolean,false) then null when a->>'project_id' is not null then (a->>'project_id')::uuid else project_id end,
        priority=coalesce(a->>'priority',priority),frequency=coalesce(a->>'frequency',frequency),month_pattern=coalesce(a->>'month_pattern',month_pattern),due_kind=coalesce(a->>'due_kind',due_kind),due_day=coalesce((a->>'due_day')::integer,due_day),due_weekday=coalesce((a->>'due_weekday')::integer,due_weekday),due_time=coalesce(nullif(a->>'due_time','')::time,due_time),reminder_mode=coalesce(a->>'reminder_mode',reminder_mode),reminder_day=coalesce((a->>'reminder_day')::integer,reminder_day),reminder_days=v_reminders,starts_on=coalesce(nullif(a->>'starts_on','')::date,starts_on),is_active=coalesce((a->>'is_active')::boolean,is_active)
      where id=v_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('type',kind,'recurring_id',v_id));

    else raise exception 'Unsupported Jarvis action: %',kind;
    end if;
    v_count := v_count+1;
  end loop;
  return jsonb_build_object('count',v_count,'results',v_results);
end $$;
revoke all on function public.nu_jarvis_apply_action_bundle(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.nu_jarvis_apply_action_bundle(uuid,jsonb) to service_role;
commit;
