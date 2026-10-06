"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Icon } from "./ui";

type Item={item_index:number;label:string;done:boolean};
type TaskLite={id:string;title:string;status:string;deadline:string;assignee_id:string};
type Dependency={task_id:string;depends_on_task_id:string};

export default function TaskChecklist({taskId,description,editable,onChange}:{taskId:string;description:string;editable:boolean;onChange:()=>void}) {
 const labels=description.split("\n").map(l=>l.trim()).filter(l=>/^[•*–-]\s+/.test(l)).map(l=>l.replace(/^[•*–-]\s+/,""));
 const [items,setItems]=useState<Item[]>([]);const [available,setAvailable]=useState(false);const [saving,setSaving]=useState(false);const [notice,setNotice]=useState("");
 const [dependencies,setDependencies]=useState<Dependency[]>([]);const [taskOptions,setTaskOptions]=useState<TaskLite[]>([]);const [canManageDeps,setCanManageDeps]=useState(false);const [dependencyId,setDependencyId]=useState("");const [dependencyNotice,setDependencyNotice]=useState("");const [dependencySaving,setDependencySaving]=useState(false);

 useEffect(()=>{
  let active=true;setAvailable(false);setItems([]);setNotice("");
  if(!/^[•*–-]\s+/m.test(description))return;
  void supabase.from("task_checklist_items").select("item_index,label,done").eq("task_id",taskId).then(({data,error})=>{
    if(!active)return;
    if(error){if(!["42P01","PGRST205"].includes(error.code))setNotice("Не удалось загрузить отметки. Обновите карточку.");return;}
    setItems(data||[]);setAvailable(true);
  });return()=>{active=false;};
 },[taskId,description]);

 useEffect(()=>{
  let active=true;setDependencies([]);setTaskOptions([]);setCanManageDeps(false);setDependencyNotice("");setDependencyId("");
  void (async()=>{
   const [depsResult,tasksResult,currentResult]=await Promise.all([
    supabase.from("task_dependencies").select("task_id,depends_on_task_id").eq("task_id",taskId),
    supabase.from("tasks").select("id,title,status,deadline,assignee_id").neq("id",taskId).order("deadline").limit(500),
    supabase.from("tasks").select("assignee_id").eq("id",taskId).single(),
   ]);
   if(!active)return;
   if(depsResult.error){setDependencyNotice("Не удалось загрузить зависимости.");return;}
   setDependencies((depsResult.data||[]) as Dependency[]);
   if(!tasksResult.error)setTaskOptions((tasksResult.data||[]) as TaskLite[]);
   if(!currentResult.error&&currentResult.data?.assignee_id){
    const permission=await supabase.rpc("nu_can_assign",{uid:currentResult.data.assignee_id});
    if(active&&!permission.error)setCanManageDeps(Boolean(permission.data));
   }
  })();
  return()=>{active=false;};
 },[taskId]);

 const checked=(index:number)=>items.find(i=>i.item_index===index&&i.label===labels[index])?.done||false;
 const count=labels.filter((_,i)=>checked(i)).length;
 const linkedIds=useMemo(()=>new Set(dependencies.map(d=>d.depends_on_task_id)),[dependencies]);
 const blockers=dependencies.map(d=>taskOptions.find(t=>t.id===d.depends_on_task_id)).filter((t):t is TaskLite=>Boolean(t));
 const selectable=taskOptions.filter(t=>t.status!=="completed"&&!linkedIds.has(t.id));

 async function toggle(index:number,done:boolean) {
  setSaving(true);setNotice("");
  try{
   const {error}=await supabase.rpc("nu_set_checklist_item",{p_task_id:taskId,p_index:index,p_label:labels[index],p_done:done});
   if(error)throw new Error(error.message);
   setItems(previous=>[...previous.filter(i=>i.item_index!==index),{item_index:index,label:labels[index],done}]);onChange();
  }catch(e){setNotice(e instanceof Error?e.message:"Не удалось сохранить отметку");}finally{setSaving(false);}
 }

 async function addDependency() {
  if(!dependencyId)return;
  setDependencySaving(true);setDependencyNotice("");
  try{
   const {data:{user}}=await supabase.auth.getUser();
   if(!user)throw new Error("Требуется вход");
   const {error}=await supabase.from("task_dependencies").insert({task_id:taskId,depends_on_task_id:dependencyId,created_by:user.id});
   if(error)throw new Error(error.message.includes("cycle")?"Нельзя создать круговую зависимость.":error.message);
   setDependencies(previous=>[...previous,{task_id:taskId,depends_on_task_id:dependencyId}]);setDependencyId("");onChange();
  }catch(e){setDependencyNotice(e instanceof Error?e.message:"Не удалось добавить зависимость");}finally{setDependencySaving(false);}
 }

 async function removeDependency(dependsOnTaskId:string) {
  setDependencySaving(true);setDependencyNotice("");
  try{
   const {error}=await supabase.from("task_dependencies").delete().eq("task_id",taskId).eq("depends_on_task_id",dependsOnTaskId);
   if(error)throw new Error(error.message);
   setDependencies(previous=>previous.filter(d=>d.depends_on_task_id!==dependsOnTaskId));onChange();
  }catch(e){setDependencyNotice(e instanceof Error?e.message:"Не удалось удалить зависимость");}finally{setDependencySaving(false);}
 }

 return <>
  {labels.length>0&&<section className="nu-checklist"><div className="nu-section-heading"><h3>Чек-лист</h3>{available&&<span className="nu-muted text-sm">{count} из {labels.length}</span>}</div>{available&&<div className="nu-progress"><span style={{width:`${count/labels.length*100}%`}}/></div>}
   {labels.map((label,i)=><label key={`${taskId}:${i}:${label}`} className={`nu-checklist-item ${checked(i)?"checked":""}`}><input type="checkbox" checked={checked(i)} disabled={!available||!editable||saving} onChange={e=>void toggle(i,e.target.checked)}/><span>{label}</span>{checked(i)&&<Icon name="check" size={16}/>}</label>)}
   {!available&&!notice&&<p className="nu-muted text-xs mt-3">Список проверок. Сохранение отметок станет доступно после обновления базы.</p>}{notice&&<p role="status" className="nu-danger text-sm mt-3">{notice}</p>}
  </section>}

  <section className="nu-checklist"><div className="nu-section-heading"><div><h3>Зависимости</h3><p className="nu-muted text-xs mt-1">Задача не должна считаться свободной, пока не завершены её блокеры.</p></div>{blockers.some(t=>t.status!=="completed")&&<span className="nu-badge nu-badge-orange">Заблокирована</span>}</div>
   <div className="space-y-2">{blockers.map(blocker=><div key={blocker.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3"><button type="button" className="min-w-0 flex-1 text-left" onClick={()=>window.history.pushState(null,"",`${window.location.pathname}?task=${blocker.id}`)}><strong className="block truncate text-sm">{blocker.title}</strong><small className="text-stone-500">{blocker.status==="completed"?"✅ Завершена":`Блокирует · ${new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",day:"numeric",month:"short"}).format(new Date(blocker.deadline))}`}</small></button>{canManageDeps&&editable&&<button type="button" disabled={dependencySaving} className="rounded-lg border border-stone-200 px-2 py-1 text-xs hover:bg-white" onClick={()=>void removeDependency(blocker.id)}>Убрать</button>}</div>)}{!blockers.length&&<p className="nu-muted text-sm">Блокирующих задач нет.</p>}</div>
   {canManageDeps&&editable&&<div className="mt-3 flex flex-col gap-2 sm:flex-row"><select aria-label="Добавить зависимость" className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm" value={dependencyId} onChange={e=>setDependencyId(e.target.value)}><option value="">Выберите задачу-блокер…</option>{selectable.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select><button type="button" className="rounded-xl border border-stone-200 px-3 py-2 text-sm hover:bg-stone-100 disabled:opacity-40" disabled={!dependencyId||dependencySaving} onClick={()=>void addDependency()}>Добавить</button></div>}
   {dependencyNotice&&<p role="status" className="nu-danger text-sm mt-3">{dependencyNotice}</p>}
  </section>
 </>;
}
