-- Optional additive migration for interactive checklists. Existing tasks/Auth are unchanged.
begin;
create table public.task_checklist_items (
 task_id uuid not null references public.tasks(id) on delete cascade,
 item_index integer not null check(item_index>=0),
 label text not null check(length(label) between 1 and 500),
 done boolean not null default false,
 updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now(),
 primary key(task_id,item_index,label)
);
alter table public.task_checklist_items enable row level security;
create policy nu_checklist_read on public.task_checklist_items for select to authenticated
using(exists(select 1 from public.tasks t where t.id=task_id and public.nu_can_view_task(t)));
grant select on public.task_checklist_items to authenticated;
revoke insert,update,delete on public.task_checklist_items from authenticated,anon;
create function public.nu_set_checklist_item(p_task_id uuid,p_index integer,p_label text,p_done boolean) returns void
language plpgsql security definer set search_path=public as $$
declare t public.tasks; expected text; old_done boolean;
begin
 if auth.uid() is null or public.nu_active_role() is null then raise exception 'Access denied'; end if;
 select * into t from public.tasks where id=p_task_id for update;
 if not found or not public.nu_can_view_task(t) or t.status='completed'
 or not(t.assignee_id=auth.uid() or public.nu_can_assign(t.assignee_id)) then raise exception 'Checklist update denied'; end if;
 if p_index is null or p_index<0 or p_done is null then raise exception 'Invalid checklist item'; end if;
 select item into expected from (
   select regexp_replace(trim(line), '^[•*–-][[:space:]]+', '') as item,
     row_number() over(order by ord)-1 as item_number
   from unnest(string_to_array(coalesce(t.description,''),E'\n')) with ordinality lines(line,ord)
   where trim(line) ~ '^[•*–-][[:space:]]+'
 ) items where item_number=p_index;
 if expected is null or expected is distinct from p_label then raise exception 'Checklist changed; refresh the task'; end if;
 select done into old_done from public.task_checklist_items where task_id=p_task_id and item_index=p_index and label=p_label;
 if coalesce(old_done,false)=p_done then return; end if;
 insert into public.task_checklist_items(task_id,item_index,label,done,updated_by)
 values(p_task_id,p_index,p_label,p_done,auth.uid())
 on conflict(task_id,item_index,label) do update set done=excluded.done,updated_by=excluded.updated_by,updated_at=now();
 insert into public.task_history(task_id,user_id,action,old_value,new_value)
 values(p_task_id,auth.uid(),'updated',jsonb_build_object('checklist',jsonb_build_object('item',p_label,'done',coalesce(old_done,false))),
 jsonb_build_object('checklist',jsonb_build_object('item',p_label,'done',p_done)));
end $$;
revoke all on function public.nu_set_checklist_item(uuid,integer,text,boolean) from public,anon;
grant execute on function public.nu_set_checklist_item(uuid,integer,text,boolean) to authenticated;
commit;
