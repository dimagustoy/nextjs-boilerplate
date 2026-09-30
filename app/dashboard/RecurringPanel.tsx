"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import LegacyRecurringPanel from "./LegacyRecurringPanel";
import { managerPresets, monthAt, occurrences, scheduleDefaults, scheduleLabel, todayLocal, weekdays, type Schedule } from "../lib/recurring";

type Role = "owner" | "manager" | "smm" | "senior_master";
type Priority = "low" | "normal" | "high" | "critical";
type Person = { id: string; full_name: string; role: Role; is_active: boolean };
type Project = { id: string; name: string; is_active: boolean };
type Task = { id: string; title: string; status: string; deadline: string };
type Template = Schedule & { id: string; title: string; description: string | null; expected_result: string; assignee_id: string; created_by: string; project_id: string | null; priority: Priority; is_active: boolean; preset_key: string | null };
type Instance = { template_id: string; period: string; task_id: string | null };
const empty = { ...scheduleDefaults, title: "", description: "", expected_result: "", assignee_id: "", project_id: "", priority: "normal" as Priority, reminder_text: "2" };
const field = "mt-1 w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2.5 text-white outline-none focus:border-white/40";
const button = "rounded-xl border border-white/15 px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-40";
const primary = "rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black disabled:opacity-40";
const statusLabels: Record<string,string> = {new:"Новая",accepted:"Принята",in_progress:"В работе",waiting:"Ожидание",at_risk:"Под риском",review:"На проверке",completed:"Завершена"};
const dateLabel = (value: string) => value.slice(0,10).split("-").reverse().join(".");
const errorText = (e: unknown) => e instanceof Error ? e.message : "Не удалось выполнить действие. Попробуйте ещё раз.";

export default function RecurringPanel({ me, staff, projects, tasks, openTask, refreshTasks }: { me: Person; staff: Person[]; projects: Project[]; tasks: Task[]; openTask: (id: string) => void; refreshTasks: () => Promise<void> }) {
  const [templates,setTemplates] = useState<Template[]>([]);
  const [instances,setInstances] = useState<Instance[]>([]);
  const [form,setForm] = useState(empty);
  const [editing,setEditing] = useState<string|null>(null);
  const [showForm,setShowForm] = useState(false);
  const [showImport,setShowImport] = useState(false);
  const [assignee,setAssignee] = useState("");
  const [notice,setNotice] = useState("");
  const [saving,setSaving] = useState(false);
  const [ready,setReady] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const [monthOffset,setMonthOffset] = useState(0);
  const [employeeFilter,setEmployeeFilter] = useState("");
  const [view,setView] = useState<"rules"|"calendar">("rules");
  const month = monthAt(monthOffset);
  const reload = useCallback(async () => {
    const [a,b,version] = await Promise.all([
      supabase.from("recurring_task_templates").select("*").order("title"),
      supabase.from("recurring_task_instances").select("template_id,period,task_id").gte("period",monthAt(monthOffset)).lt("period",monthAt(monthOffset+1)),
      supabase.from("recurring_task_templates").select("frequency").limit(1),
    ]);
    if (a.error || b.error) throw new Error(a.error?.message || b.error?.message);
    setReady(!version.error); setLoaded(true);
    setTemplates((a.data || []) as Template[]); setInstances((b.data || []) as Instance[]);
  },[monthOffset]);
  useEffect(() => { void reload().catch(e=>setNotice(errorText(e))); },[reload]);

  function edit(t: Template) {
    setEditing(t.id); setForm({...empty,...t,description:t.description||"",project_id:t.project_id||"",due_time:t.due_time.slice(0,5),reminder_text:t.reminder_days.join(", ")}); setShowForm(true); setShowImport(false);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const reminders=form.reminder_text.split(",").map(v=>Number(v.trim()));
    if (!form.reminder_text.trim() || reminders.some(v=>!Number.isInteger(v)||v<0||v>31)) {setNotice("Укажите дни напоминаний от 0 до 31 через запятую.");return;}
    setSaving(true); setNotice("");
    try {
      const values={title:form.title.trim(),description:form.description.trim(),expected_result:form.expected_result.trim(),assignee_id:form.assignee_id,project_id:form.project_id||null,priority:form.priority,due_day:form.due_day,due_time:form.due_time,reminder_days:[...new Set(reminders)],frequency:form.frequency,month_pattern:form.month_pattern,due_kind:form.due_kind,due_weekday:form.due_weekday,reminder_mode:form.reminder_mode,reminder_day:form.reminder_day,starts_on:form.starts_on};
      const result=editing ? await supabase.from("recurring_task_templates").update(values).eq("id",editing) : await supabase.from("recurring_task_templates").insert({...values,created_by:me.id});
      if(result.error) throw new Error(result.error.message);
      setShowForm(false);setEditing(null);setForm(empty);await reload();
      setNotice("Правило сохранено. Создание задач — в 08:00 по Екатеринбургу в день первого напоминания. Уже созданные задачи сохраняют свои условия.");
    } catch(e) {setNotice(errorText(e));} finally {setSaving(false);}
  }
  async function toggle(t: Template) {
    setSaving(true);
    try {const {error}=await supabase.from("recurring_task_templates").update({is_active:!t.is_active}).eq("id",t.id);if(error)throw new Error(error.message);await reload();setNotice(t.is_active?"Правило приостановлено. Уже созданные задачи остаются в списке.":"Правило возобновлено.");}
    catch(e){setNotice(errorText(e));}finally{setSaving(false);}
  }
  const missingPresets=managerPresets.filter(p=>!templates.some(t=>t.assignee_id===assignee&&t.preset_key===p.preset_key));
  async function importPresets(e:FormEvent) {
    e.preventDefault(); if(!assignee||!missingPresets.length)return; setSaving(true);setNotice("");
    try {
      // One atomic insert. Unique preset keys also protect concurrent imports.
      const values=missingPresets.map(p=>({...p,starts_on:todayLocal(),assignee_id:assignee,created_by:me.id,project_id:null,priority:"normal"}));
      const {error}=await supabase.from("recurring_task_templates").upsert(values,{onConflict:"assignee_id,preset_key",ignoreDuplicates:true});
      if(error)throw new Error(error.message);
      await reload();setShowImport(false);setNotice(`Набор сохранён (${values.length} правил). Все дедлайны — 23:59, создание и уведомления — с 08:00 по Екатеринбургу. Расписание доступно во вкладке «Календарь».`);
    }catch(e){setNotice(errorText(e));}finally{setSaving(false);}
  }
  const filtered=templates.filter(t=>!employeeFilter||t.assignee_id===employeeFilter);
  const rows=ready ? filtered.flatMap(t=>{
    const generated=instances.filter(i=>i.template_id===t.id);
    const planned=t.is_active&&!(t.frequency==="monthly"&&generated.length)?occurrences(t,month):[];
    return [...new Set([...planned.map(d=>d.due),...generated.map(i=>i.period)])].map(due=>{
      const instance=generated.find(i=>i.period===due); const task=tasks.find(x=>x.id===instance?.task_id);
      return {template:t,due,notify:planned.find(d=>d.due===due)?.notify,instance,task};
    });
  }).sort((a,b)=>a.due.localeCompare(b.due)||a.template.title.localeCompare(b.template.title)) : [];
  const previewDays=form.reminder_text.split(",").map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=31);
  const preview=previewDays.length?occurrences({...form,reminder_days:previewDays},month).slice(0,3):[];
  if (loaded&&!ready) return <section className="space-y-4"><p className="rounded-xl border border-amber-300/30 p-4 text-sm text-amber-100">Новый календарь появится после обновления базы данных: 20261001010000_recurring_calendar.sql. Пока доступны прежние ежемесячные правила.</p><LegacyRecurringPanel me={me} staff={staff} projects={projects} tasks={tasks} openTask={openTask} refreshTasks={refreshTasks}/></section>;
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-2xl font-semibold">Регулярные задачи</h2><p className="mt-1 text-sm text-white/50">{templates.filter(t=>t.is_active).length} активных правил · время Екатеринбурга</p></div>
      {me.role==="owner"&&ready&&<div className="flex flex-wrap gap-2"><button className={button} onClick={()=>{setAssignee(staff.find(p=>p.role==="manager"&&p.is_active)?.id||"");setShowImport(true);setShowForm(false);}}>Набор задач управляющего</button><button className={primary} onClick={()=>{setEditing(null);setForm({...empty,starts_on:todayLocal(),assignee_id:staff.find(p=>p.role==="manager"&&p.is_active)?.id||""});setShowForm(true);setShowImport(false);}}>+ Добавить правило</button></div>}
    </div>
    {notice&&<div role="status" className="rounded-xl border border-white/15 bg-white/5 p-3 text-sm">{notice}</div>}
    {loaded&&!ready&&<p className="rounded-xl border border-amber-300/30 p-4 text-sm text-amber-100">Для нового календаря нужно применить обновление базы данных 20261001010000_recurring_calendar.sql. Существующие задачи продолжают работать.</p>}
    {showImport&&me.role==="owner"&&<form onSubmit={importPresets} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <h3 className="text-lg font-semibold">30 правил для управляющего</h3><p className="text-sm text-white/60">Ежедневные проверки, закупки, собрания, уборки, инвентаризация, KPI, график смен, платежи, показания и отчёты. Где день уведомления не задан — за 2 дня. Все дедлайны — 23:59, уведомления — с 08:00.</p>
      <label className="block">Управляющий<select required className={field} value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Выберите сотрудника</option>{staff.filter(p=>p.is_active&&p.role==="manager").map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
      <details className="text-sm"><summary className="cursor-pointer">Проверить состав и сроки</summary><ul className="mt-3 space-y-2">{managerPresets.map(p=><li key={p.preset_key}><strong>{p.title}</strong> · {scheduleLabel(p)} · {p.reminder_mode==="month_day"?`уведомление ${p.reminder_day} числа`:`напоминание за ${p.reminder_days.join(", ")} дн.`}</li>)}</ul></details>
      <p className="text-sm text-white/50">Будет добавлено: {missingPresets.length}. Уже добавленные правила этого набора повторно не создаются. Ранее созданные вручную похожие правила проверьте и при необходимости приостановите.</p>
      <div className="flex flex-wrap gap-2"><button className={primary} disabled={saving||!assignee||!missingPresets.length}>{saving?"Сохраняем…":"Добавить набор"}</button><button type="button" className={button} disabled={saving} onClick={()=>setShowImport(false)}>Отмена</button></div>
    </form>}
    {showForm&&me.role==="owner"&&<form onSubmit={save} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <h3 className="text-lg font-semibold">{editing?"Изменить правило":"Новое правило"}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">Название<input required minLength={3} maxLength={200} className={field} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
        <label className="sm:col-span-2">Описание / список проверок<textarea rows={4} className={field} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
        <label className="sm:col-span-2">Ожидаемый результат *<textarea required className={field} value={form.expected_result} onChange={e=>setForm({...form,expected_result:e.target.value})}/></label>
        <label>Исполнитель<select required className={field} value={form.assignee_id} onChange={e=>setForm({...form,assignee_id:e.target.value})}><option value="">Выберите</option>{staff.filter(p=>p.is_active).map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        <label>Проект<select className={field} value={form.project_id} onChange={e=>setForm({...form,project_id:e.target.value})}><option value="">Без проекта</option>{projects.filter(p=>p.is_active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Повтор<select className={field} value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value as Schedule["frequency"]})}><option value="daily">Ежедневно</option><option value="weekly">Еженедельно</option><option value="monthly">Ежемесячно</option></select></label>
        <label>Начать с<input required type="date" className={field} value={form.starts_on} onChange={e=>setForm({...form,starts_on:e.target.value})}/></label>
        {form.frequency==="monthly"&&<><label>Месяцы<select className={field} value={form.month_pattern} onChange={e=>setForm({...form,month_pattern:e.target.value as Schedule["month_pattern"]})}><option value="all">Все</option><option value="odd">Нечётные (январь, март…)</option><option value="even">Чётные (февраль, апрель…)</option></select></label><label>Дедлайн<select className={field} value={form.due_kind} onChange={e=>setForm({...form,due_kind:e.target.value as Schedule["due_kind"]})}><option value="day">Число месяца</option><option value="last_day">Последний день месяца</option><option value="last_weekday">Последний выбранный день недели</option></select></label>{form.due_kind==="day"&&<label>Число (в коротком месяце — последний день)<input required type="number" min={1} max={31} className={field} value={form.due_day} onChange={e=>setForm({...form,due_day:Number(e.target.value)})}/></label>}</>}
        {(form.frequency==="weekly"||form.frequency==="monthly"&&form.due_kind==="last_weekday")&&<label>День недели<select className={field} value={form.due_weekday} onChange={e=>setForm({...form,due_weekday:Number(e.target.value)})}>{weekdays.map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select></label>}
        <label>Время дедлайна, Екатеринбург<input required type="time" className={field} value={form.due_time} onChange={e=>setForm({...form,due_time:e.target.value})}/></label>
        <label>Приоритет<select className={field} value={form.priority} onChange={e=>setForm({...form,priority:e.target.value as Priority})}><option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="critical">Критичный</option></select></label>
        {form.frequency==="monthly"&&<label>Напоминания<select className={field} value={form.reminder_mode} onChange={e=>setForm({...form,reminder_mode:e.target.value as Schedule["reminder_mode"]})}><option value="offsets">За несколько дней до дедлайна</option><option value="month_day">В указанное число месяца</option></select></label>}
        {form.frequency==="monthly"&&form.reminder_mode==="month_day"?<label>Число уведомления<input required type="number" min={1} max={31} className={field} value={form.reminder_day} onChange={e=>setForm({...form,reminder_day:Number(e.target.value)})}/></label>:<label>За сколько дней напомнить (0 = в день дедлайна)<input required className={field} value={form.reminder_text} onChange={e=>setForm({...form,reminder_text:e.target.value})}/></label>}
      </div>
      <p className="text-sm text-white/50">Ближайшие даты выбранного месяца: {preview.length?preview.map(d=>`${dateLabel(d.due)} (уведомление ${dateLabel(d.notify)})`).join("; "):"нет"}. Уведомления — с 08:00.</p>
      <div className="flex gap-2"><button className={primary} disabled={saving}>{saving?"Сохраняем…":"Сохранить"}</button><button type="button" className={button} disabled={saving} onClick={()=>setShowForm(false)}>Отмена</button></div>
    </form>}
    <div className="flex flex-wrap items-center gap-2"><button className={view==="rules"?primary:button} onClick={()=>setView("rules")}>Правила</button><button className={view==="calendar"?primary:button} disabled={!ready} onClick={()=>setView("calendar")}>Календарь</button><select aria-label="Фильтр по сотруднику" className={`${field} sm:ml-auto sm:w-auto`} value={employeeFilter} onChange={e=>setEmployeeFilter(e.target.value)}><option value="">Все сотрудники</option>{staff.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select><button className={button} onClick={()=>{void Promise.all([reload(),refreshTasks()]).catch(e=>setNotice(errorText(e)));}}>Обновить</button></div>
    {view==="calendar"&&ready?<>
      <div className="flex flex-wrap items-center gap-3"><button aria-label="Предыдущий месяц" className={button} onClick={()=>setMonthOffset(v=>v-1)}>←</button><h3 className="font-semibold">{new Intl.DateTimeFormat("ru-RU",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(month))}</h3><button aria-label="Следующий месяц" className={button} onClick={()=>setMonthOffset(v=>v+1)}>→</button><button className={button} onClick={()=>setMonthOffset(0)}>Текущий месяц</button></div>
      <p className="text-sm text-white/50">План: {rows.length} · Создано: {rows.filter(r=>r.instance?.task_id).length} · Завершено: {rows.filter(r=>r.task?.status==="completed").length}. Изменения правил влияют только на ещё не созданные задачи.</p>
      <div className="space-y-2">{rows.map(r=><div key={`${r.template.id}:${r.due}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4"><div><p className="font-medium">{r.template.title}</p><p className="mt-1 text-sm text-white/60">{staff.find(p=>p.id===r.template.assignee_id)?.full_name} · Дедлайн: {r.task?new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",dateStyle:"short",timeStyle:"short"}).format(new Date(r.task.deadline)):`${dateLabel(r.due)} ${r.template.due_time.slice(0,5)}`}</p><p className="mt-1 text-xs text-white/40">{r.instance ? r.instance.task_id ? r.task ? statusLabels[r.task.status]+(r.task.status!=="completed"&&new Date(r.task.deadline).getTime()<Date.now()?" · Просрочена":"") : "Создана" : "Удалена владельцем" : `Запланирована · создание ${dateLabel(r.notify!)} в 08:00`}</p></div>{r.instance?.task_id&&<button className={button} onClick={()=>openTask(r.instance!.task_id!)}>Открыть задачу</button>}</div>)}{!rows.length&&<p className="p-6 text-center text-white/50">В этом месяце задач нет</p>}</div>
    </>:<div className="space-y-3">{filtered.map(t=><div key={t.id} className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><h3 className="font-semibold">{t.title}</h3><p className="mt-1 text-sm text-white/50">{staff.find(p=>p.id===t.assignee_id)?.full_name||"Сотрудник"} · {ready?scheduleLabel(t):`Ежемесячно, ${t.due_day} число`} · {t.due_time.slice(0,5)} · {t.is_active?"Активно":"Приостановлено"}</p><p className="mt-2 text-sm text-white/60">Результат: {t.expected_result}</p>{t.description&&<details className="mt-2 text-sm text-white/50"><summary className="cursor-pointer">Описание и проверки</summary><p className="mt-2 whitespace-pre-wrap">{t.description}</p></details>}<p className="mt-2 text-xs text-white/40">Напоминания: {t.reminder_mode==="month_day"?`${t.reminder_day} числа`:`за ${t.reminder_days.join(", ")} дн.`} · 08:00</p></div>{me.role==="owner"&&ready&&<div className="flex flex-wrap gap-2"><button className={button} disabled={saving} onClick={()=>edit(t)}>Изменить</button><button className={button} disabled={saving} onClick={()=>void toggle(t)}>{t.is_active?"Приостановить":"Возобновить"}</button></div>}</div></div>)}{loaded&&!filtered.length&&<p className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-white/50">Правил пока нет</p>}</div>}
  </section>;
}
