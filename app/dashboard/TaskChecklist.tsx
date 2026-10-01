"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Icon } from "./ui";
type Item={item_index:number;label:string;done:boolean};
export default function TaskChecklist({taskId,description,editable,onChange}:{taskId:string;description:string;editable:boolean;onChange:()=>void}) {
 const labels=description.split("\n").map(l=>l.trim()).filter(l=>/^[•*–-]\s+/.test(l)).map(l=>l.replace(/^[•*–-]\s+/,""));
 const [items,setItems]=useState<Item[]>([]);const [available,setAvailable]=useState(false);const [saving,setSaving]=useState(false);const [notice,setNotice]=useState("");
 useEffect(()=>{
  let active=true;setAvailable(false);setItems([]);setNotice("");
  if(!/^[•*–-]\s+/m.test(description))return;
  void supabase.from("task_checklist_items").select("item_index,label,done").eq("task_id",taskId).then(({data,error})=>{
    if(!active)return;
    if(error){if(!["42P01","PGRST205"].includes(error.code))setNotice("Не удалось загрузить отметки. Обновите карточку.");return;}
    setItems(data||[]);setAvailable(true);
  });return()=>{active=false;};
 },[taskId,description]);
 if(!labels.length)return null;
 const checked=(index:number)=>items.find(i=>i.item_index===index&&i.label===labels[index])?.done||false;
 const count=labels.filter((_,i)=>checked(i)).length;
 async function toggle(index:number,done:boolean) {
  setSaving(true);setNotice("");
  try{
   const {error}=await supabase.rpc("nu_set_checklist_item",{p_task_id:taskId,p_index:index,p_label:labels[index],p_done:done});
   if(error)throw new Error(error.message);
   setItems(previous=>[...previous.filter(i=>i.item_index!==index),{item_index:index,label:labels[index],done}]);onChange();
  }catch(e){setNotice(e instanceof Error?e.message:"Не удалось сохранить отметку");}finally{setSaving(false);}
 }
 return <section className="nu-checklist"><div className="nu-section-heading"><h3>Чек-лист</h3>{available&&<span className="nu-muted text-sm">{count} из {labels.length}</span>}</div>{available&&<div className="nu-progress"><span style={{width:`${count/labels.length*100}%`}}/></div>}
 {labels.map((label,i)=><label key={`${taskId}:${i}:${label}`} className={`nu-checklist-item ${checked(i)?"checked":""}`}><input type="checkbox" checked={checked(i)} disabled={!available||!editable||saving} onChange={e=>void toggle(i,e.target.checked)}/><span>{label}</span>{checked(i)&&<Icon name="check" size={16}/>}</label>)}
 {!available&&!notice&&<p className="nu-muted text-xs mt-3">Список проверок. Сохранение отметок станет доступно после обновления базы.</p>}{notice&&<p role="status" className="nu-danger text-sm mt-3">{notice}</p>}
 </section>;
}
