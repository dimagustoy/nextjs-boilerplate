"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Role = "owner" | "manager" | "smm" | "senior_master";
type Priority = "low" | "normal" | "high" | "critical";
type Person = { id: string; full_name: string; role: Role; is_active: boolean };
type Project = { id: string; name: string; is_active: boolean };
type Task = { id: string; title: string; status: string; deadline: string };
type Template = { id: string; title: string; description: string | null; expected_result: string; assignee_id: string; created_by: string; project_id: string | null; priority: Priority; due_day: number; due_time: string; reminder_days: number[]; is_active: boolean };
type Instance = { template_id: string; period: string; task_id: string };
const empty = { title: "", description: "", expected_result: "", assignee_id: "", project_id: "", priority: "normal" as Priority, due_day: 25, due_time: "18:00", reminder_days: "5, 2, 0" };
const field = "w-full rounded-xl border border-white/10 bg-neutral-900 px-4 py-3 text-white outline-none focus:border-white/40";
const button = "rounded-xl border border-white/15 px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-40";
const periodAt = (offset: number) => {
  const d = new Date();
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg", year: "numeric", month: "2-digit" }).format(d);
  const [year, month] = p.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
};

export default function LegacyRecurringPanel({ me, staff, projects, tasks, openTask, refreshTasks }: { me: Person; staff: Person[]; projects: Project[]; tasks: Task[]; openTask: (id: string) => void; refreshTasks: () => Promise<void> }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const month = periodAt(0);
  const nextMonth = periodAt(1);

  const reload = useCallback(async () => {
    const [a,b] = await Promise.all([
      supabase.from("recurring_task_templates").select("*").order("due_day"),
      supabase.from("recurring_task_instances").select("template_id,period,task_id").gte("period",periodAt(0)).lte("period",periodAt(1)),
    ]);
    if (a.error || b.error) { setNotice(a.error?.message || b.error?.message || "Ошибка загрузки"); return; }
    setTemplates((a.data || []) as Template[]);
    setInstances((b.data || []) as Instance[]);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  function edit(t: Template) {
    setEditing(t.id);
    setForm({ title: t.title, description: t.description || "", expected_result: t.expected_result, assignee_id: t.assignee_id, project_id: t.project_id || "", priority: t.priority, due_day: t.due_day, due_time: t.due_time.slice(0,5), reminder_days: t.reminder_days.join(", ") });
    setShowForm(true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const reminders = form.reminder_days.split(",").map(v => Number(v.trim()));
    if (!form.title.trim() || !form.expected_result.trim() || !form.assignee_id || reminders.some(v => !Number.isInteger(v) || v < 0 || v > 31)) {
      setNotice("Проверьте обязательные поля и дни напоминаний (числа от 0 до 31)."); return;
    }
    setSaving(true); setNotice("");
    const values = { title: form.title.trim(), description: form.description.trim(), expected_result: form.expected_result.trim(), assignee_id: form.assignee_id, project_id: form.project_id || null, priority: form.priority, due_day: Number(form.due_day), due_time: form.due_time, reminder_days: [...new Set(reminders)] };
    const result = editing ? await supabase.from("recurring_task_templates").update(values).eq("id", editing) : await supabase.from("recurring_task_templates").insert({ ...values, created_by: me.id });
    if (result.error) { setNotice(result.error.message); setSaving(false); return; }
    if (!editing) {
      for (const period of [month,nextMonth]) {
        const generated = await supabase.rpc("nu_generate_recurring", { p_month: period });
        if (generated.error) { setNotice(`Правило сохранено, но задачи не созданы: ${generated.error.message}`); break; }
      }
    }
    setSaving(false); setShowForm(false); setEditing(null); setForm(empty); await Promise.all([reload(),refreshTasks()]);
    if (!editing) setNotice("Правило создано. Задачи на ближайшие месяцы добавлены в общий список.");
    else setNotice("Правило изменено. Уже созданные задачи сохраняют прежние условия; изменения применятся к следующим месяцам.");
  }
  async function toggle(t: Template) {
    const { error } = await supabase.from("recurring_task_templates").update({ is_active: !t.is_active }).eq("id", t.id);
    if (error) setNotice(error.message); else await reload();
  }
  const active = templates.filter(t => t.is_active);
  const current = instances.filter(i => i.period === month);
  const completed = current.filter(i => tasks.find(t => t.id === i.task_id)?.status === "completed").length;
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-2xl font-semibold">Регулярные задачи</h2><p className="mt-1 text-sm text-white/50">Ежемесячные правила · {active.length} активных · {completed} из {current.length} завершено в этом месяце</p></div>{me.role === "owner" && <button className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black" onClick={() => { setEditing(null); setForm({ ...empty, assignee_id: staff.find(p => p.role === "manager" && p.is_active)?.id || "" }); setShowForm(true); }}>+ Добавить правило</button>}</div>
    {notice && <div role="status" className="rounded-xl border border-white/15 bg-white/5 p-3 text-sm">{notice}</div>}
    {showForm && me.role === "owner" && <form onSubmit={save} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.03] p-5"><h3 className="text-lg font-semibold">{editing ? "Изменить правило" : "Новое правило"}</h3><div className="grid gap-4 sm:grid-cols-2"><label className="block sm:col-span-2">Название<input className={field} required minLength={3} value={form.title} onChange={e => setForm({ ...form,title:e.target.value })} /></label><label className="block sm:col-span-2">Описание<textarea className={field} value={form.description} onChange={e => setForm({ ...form,description:e.target.value })} /></label><label className="block sm:col-span-2">Ожидаемый результат *<textarea className={field} required value={form.expected_result} onChange={e => setForm({ ...form,expected_result:e.target.value })} /></label><label>Исполнитель<select className={field} required value={form.assignee_id} onChange={e => setForm({ ...form,assignee_id:e.target.value })}><option value="">Выберите</option>{staff.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label><label>Проект<select className={field} value={form.project_id} onChange={e => setForm({ ...form,project_id:e.target.value })}><option value="">Без проекта</option>{projects.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>День месяца (31 = последний в коротком месяце)<input className={field} type="number" min="1" max="31" required value={form.due_day} onChange={e => setForm({ ...form,due_day:Number(e.target.value) })} /></label><label>Время, Екатеринбург<input className={field} type="time" required value={form.due_time} onChange={e => setForm({ ...form,due_time:e.target.value })} /></label><label>Приоритет<select className={field} value={form.priority} onChange={e => setForm({ ...form,priority:e.target.value as Priority })}><option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="critical">Критичный</option></select></label><label>Напоминания за сколько дней (через запятую)<input className={field} value={form.reminder_days} onChange={e => setForm({ ...form,reminder_days:e.target.value })} /></label></div><div className="flex gap-2"><button disabled={saving} className="rounded-xl bg-white px-5 py-2.5 text-black disabled:opacity-40">{saving ? "Сохраняем…" : "Сохранить"}</button><button type="button" className={button} onClick={() => setShowForm(false)}>Отмена</button></div></form>}
    <div className="space-y-3">{templates.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-white/50">Правил пока нет</div>}{templates.map(t => { const instance = instances.find(i => i.template_id === t.id && i.period === month); const task = tasks.find(x => x.id === instance?.task_id); return <div key={t.id} className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">{t.title}</h3><p className="mt-1 text-sm text-white/50">{staff.find(p => p.id === t.assignee_id)?.full_name || "Сотрудник"} · до {t.due_day}-го числа, {t.due_time.slice(0,5)} · {t.is_active ? "Активно" : "Приостановлено"}</p><p className="mt-2 text-sm text-white/60">Результат: {t.expected_result}</p><p className="mt-2 text-xs text-white/40">Будущие напоминания: за {t.reminder_days.join(", ")} дн. · Задача этого месяца: {task ? task.status === "completed" ? "завершена" : new Date(task.deadline).getTime() < Date.now() ? "просрочена" : "в работе" : "ещё не создана"}</p></div><div className="flex flex-wrap gap-2">{task && <button className={button} onClick={() => openTask(task.id)}>Открыть задачу</button>}{me.role === "owner" && <><button className={button} onClick={() => edit(t)}>Изменить</button><button className={button} onClick={() => toggle(t)}>{t.is_active ? "Приостановить" : "Возобновить"}</button></>}</div></div></div>; })}</div>
  </section>;
}

