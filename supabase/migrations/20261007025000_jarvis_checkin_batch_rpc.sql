begin;
create or replace function public.nu_jarvis_apply_checkin(p_actor uuid, p_updates jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  v_task uuid;
  v_status text;
  v_comment text;
  v_count integer := 0;
  t public.tasks;
begin
  perform public.nu_jarvis_assert_service();
  if jsonb_typeof(p_updates) <> 'array' then raise exception 'Invalid check-in payload'; end if;
  perform set_config('nu.jarvis_actor', p_actor::text, true);
  for item in select value from jsonb_array_elements(p_updates)
  loop
    v_task := nullif(item->>'task_id','')::uuid;
    v_status := nullif(item->>'status','');
    v_comment := nullif(trim(coalesce(item->>'comment','')),'');
    select * into t from public.tasks where id=v_task;
    if not found or t.assignee_id is distinct from p_actor or t.status='completed' then
      raise exception 'Check-in task denied';
    end if;
    if v_status is not null then
      if v_status not in ('in_progress','waiting','at_risk','review') then raise exception 'Invalid check-in status'; end if;
      if t.status::text is distinct from v_status then
        update public.tasks set status=v_status::public.task_status where id=v_task;
      end if;
    end if;
    if v_comment is not null then
      insert into public.task_comments(task_id,author_id,body) values(v_task,p_actor,left(v_comment,2000));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.nu_jarvis_apply_checkin(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.nu_jarvis_apply_checkin(uuid,jsonb) to service_role;
commit;