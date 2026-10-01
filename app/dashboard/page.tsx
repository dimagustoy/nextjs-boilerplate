"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import RecurringPanel from "./RecurringPanel";
import TelegramPanel from "./TelegramPanel";
import Overview, { type Pending, type Rule, type Occurrence } from "./Overview";
import { Avatar, Brand, Icon, type IconName } from "./ui";
import TaskChecklist from "./TaskChecklist";
import Drawer from "./Drawer";
import { monthAt } from "../lib/recurring";

type Role = "owner" | "manager" | "smm" | "senior_master";
type Status = "new" | "accepted" | "in_progress" | "waiting" | "at_risk" | "review" | "completed";
type Priority = "low" | "normal" | "high" | "critical";
type Profile = { id: string; full_name: string; role: Role; is_active: boolean };
type Project = { id: string; name: string; is_active: boolean };
type Task = { id: string; title: string; description: string | null; expected_result: string; assignee_id: string; created_by: string; project_id: string | null; priority: Priority; status: Status; deadline: string; created_at: string; completed_at: string | null };
type Comment = { id: string; author_id: string; body: string; created_at: string };
type Event = { id: number; user_id: string | null; action: string; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null; created_at: string };
type DeadlineRequest = { id: string; requested_by: string; requested_deadline: string; reason: string; status: string; created_at: string };
type Tab = "overview" | "tasks" | "mine" | "recurring" | "telegram" | "team" | "calendar";
const statuses: Status[] = ["new", "accepted", "in_progress", "waiting", "at_risk", "review", "completed"];
const statusNames: Record<Status, string> = { new: "Новая", accepted: "Принята", in_progress: "В работе", waiting: "Ожидание", at_risk: "Под угрозой", review: "На проверке", completed: "Завершена" };
const roleNames: Record<Role, string> = { owner: "Владелец", manager: "Управляющий", smm: "SMM", senior_master: "Старший мастер" };
const priorityNames: Record<Priority, string> = { low: "Низкий", normal: "Обычный", high: "Высокий", critical: "Критичный" };
const blank = { title: "", description: "", expected_result: "", assignee_id: "", project_id: "", priority: "normal" as Priority, due_at: "" };
const field = "w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-stone-900 outline-none focus:border-orange-500";
const button = "rounded-xl border border-stone-200 px-4 py-2.5 text-sm hover:bg-stone-100 disabled:opacity-40";
const panel = "rounded-2xl border border-stone-200 bg-white p-5 md:p-6";
const fmt = (v: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Yekaterinburg" }).format(new Date(v));
const toYekatInput = (v: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Yekaterinburg", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(v));
  const value = (type: string) => parts.find(part => part.type === type)?.value || "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
};
const fromYekatInput = (v: string) => new Date(`${v}:00+05:00`).toISOString();
const yekatDay = (v: string) => toYekatInput(v).slice(0, 10);
const overdue = (t: Task) => t.status !== "completed" && new Date(t.deadline).getTime() < Date.now();
const errorText = (e: { message: string } | null) => e?.message || "Не удалось выполнить действие";

export default function Dashboard() {
  const [me, setMe] = useState<Profile | null>(null);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(blank);
  const [comments, setComments] = useState<Comment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [requests, setRequests] = useState<DeadlineRequest[]>([]);
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const [proposed, setProposed] = useState("");
  const [filter, setFilter] = useState({ employee: "", project: "", status: "", due: "" });
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [projectName, setProjectName] = useState("");
  const [invite, setInvite] = useState({ full_name: "", email: "", role: "smm" });
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviting, setInviting] = useState(false);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState("");
  const [pendingRequests, setPendingRequests] = useState<Pending[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [instances, setInstances] = useState<Occurrence[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  const refresh = useCallback(async () => {
    async function allTasks() {
      const rows: Task[] = [];
      for (let offset=0;;offset+=500) {
        const result=await supabase.from("tasks").select("*").order("deadline").order("id").range(offset,offset+499);
        if(result.error)return {data:null,error:result.error};
        rows.push(...result.data as Task[]);
        if(result.data.length<500)return {data:rows,error:null};
      }
    }
    const [p,j,t,r,rt,ri] = await Promise.all([
      supabase.from("profiles").select("id,full_name,role,is_active").order("full_name"),
      supabase.from("projects").select("id,name,is_active").order("name"),
      allTasks(),
      supabase.from("deadline_requests").select("id,task_id,requested_deadline").eq("status","pending"),
      supabase.from("recurring_task_templates").select("*").eq("is_active",true),
      supabase.from("recurring_task_instances").select("template_id,period,task_id").gte("period",monthAt(0)).lt("period",monthAt(2)),
    ]);
    if (p.error || j.error || t.error || r.error || rt.error || ri.error) setNotice(errorText(p.error || j.error || t.error || r.error || rt.error || ri.error));
    if(!p.error)setStaff((p.data || []) as Profile[]);
    if(!j.error)setProjects((j.data || []) as Project[]);
    if(!t.error)setTasks((t.data || []) as Task[]);
    if(!r.error)setPendingRequests((r.data || []) as Pending[]);
    if(!rt.error)setRules((rt.data || []).filter(r=>r.frequency) as Rule[]);
    if(!ri.error)setInstances((ri.data || []) as Occurrence[]);
  }, []);

  useEffect(() => {
    let alive = true;
    async function start() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/"; return; }
      const { data, error } = await supabase.from("profiles").select("id,full_name,role,is_active").eq("id", user.id).single();
      if (error || !data || !data.is_active) { await supabase.auth.signOut(); window.location.href = "/"; return; }
      if (!alive) return;
      setMe(data as Profile);
      if(data.role!=="owner")setTab("mine");
      await refresh();
      if (alive) setBusy(false);
    }
    start();
    return () => { alive = false; };
  }, [refresh]);

  const task = tasks.find(t => t.id === selected);
  const name = (id: string) => staff.find(p => p.id === id)?.full_name || "Сотрудник";
  const project = (id: string | null) => projects.find(p => p.id === id)?.name || "Без проекта";
  const canManage = (id: string) => !!me && (me.role === "owner" || (me.role === "manager" && ["smm", "senior_master"].includes(staff.find(p => p.id === id)?.role || "")));
  const candidates = staff.filter(p => p.is_active && canManage(p.id));
  const canEdit = !!task && canManage(task.assignee_id);
  const visible = useMemo(() => tasks.filter(t => {
    if(search.trim()&&!`${t.title} ${t.description||""} ${t.expected_result}`.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")))return false;
    if(quickFilter==="active"&&t.status==="completed")return false;
    if(quickFilter==="done-week"&&(t.status!=="completed"||!t.completed_at||Date.parse(t.completed_at)<clock-7*86400000||Date.parse(t.completed_at)>clock))return false;
    if(quickFilter==="attention"&&!overdue(t)&&t.status!=="at_risk"&&t.status!=="review"&&!pendingRequests.some(r=>r.task_id===t.id))return false;
    if (tab === "mine" && t.assignee_id !== me?.id) return false;
    if (filter.employee && t.assignee_id !== filter.employee) return false;
    if (filter.project && t.project_id !== filter.project) return false;
    if (filter.status && t.status !== filter.status) return false;
    if (filter.due === "overdue" && !overdue(t)) return false;
    if (filter.due === "today" && yekatDay(t.deadline) !== yekatDay(new Date(clock).toISOString())) return false;
    if (filter.due === "week" && (new Date(t.deadline).getTime() < clock || new Date(t.deadline).getTime() > clock + 7 * 86400000)) return false;
    return true;
  }), [tasks, tab, me, filter, clock, search, quickFilter, pendingRequests]);

  const loadDetail = useCallback(async (id: string) => {
    const [c, e, r] = await Promise.all([
      supabase.from("task_comments").select("id,author_id,body,created_at").eq("task_id", id).order("created_at"),
      supabase.from("task_history").select("id,user_id,action,old_value,new_value,created_at").eq("task_id", id).order("created_at", { ascending: false }),
      supabase.from("deadline_requests").select("id,requested_by,requested_deadline,reason,status,created_at").eq("task_id", id).order("created_at", { ascending: false }),
    ]);
    if (c.error || e.error || r.error) setNotice(errorText(c.error || e.error || r.error));
    setComments((c.data || []) as Comment[]); setEvents((e.data || []) as Event[]); setRequests((r.data || []) as DeadlineRequest[]);
  }, []);
  useEffect(() => {
    if (busy) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("task");
    if (!id) return;
    params.delete("task");
    window.history.replaceState(null,"",`${window.location.pathname}${params.size ? `?${params}` : ""}`);
    if (tasks.some(t => t.id === id)) { setSelected(id); setEditing(false); void loadDetail(id); }
    else setNotice("Задача удалена или у вас нет доступа к ней.");
  }, [busy,tasks,loadDetail]);
  function openTask(id: string) { setSelected(id); setEditing(false); setComments([]);setEvents([]);setRequests([]);setComment("");setReason("");setProposed("");void loadDetail(id); }

  async function mutate(action: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    setNotice("");
    const result = await action();
    if (result.error) { setNotice(errorText(result.error)); return false; }
    setNotice(success); await refresh();
    if (selected) await loadDetail(selected);
    return true;
  }
  async function saveTask(e: FormEvent) {
    e.preventDefault();
    if (!form.expected_result.trim() || !form.assignee_id || !form.due_at) return;
    if (!me) return;
    const values = { title: form.title.trim(), description: form.description.trim(), expected_result: form.expected_result.trim(), assignee_id: form.assignee_id, project_id: form.project_id || null, priority: form.priority, deadline: fromYekatInput(form.due_at) };
    const ok = await mutate(() => task ? supabase.from("tasks").update(values).eq("id", task.id) : supabase.from("tasks").insert({ ...values, created_by: me.id }), task ? "Задача обновлена" : "Задача создана");
    if (ok) { setEditing(false); if (!task) setSelected(null); }
  }
  async function changeStatus(status: Status) {
    if (!task) return;
    await mutate(() => supabase.from("tasks").update({ status }).eq("id", task.id), status === "completed" ? "Завершение подтверждено" : "Статус обновлён");
  }
  async function deleteTask() {
    if (!task || me?.role !== "owner") return;
    if (!window.confirm(`Удалить задачу «${task.title}» вместе с комментариями и историей? Это действие нельзя отменить.`)) return;
    if (await mutate(() => supabase.rpc("nu_delete_task", { p_task_id: task.id }), "Задача удалена")) setSelected(null);
  }
  async function addComment(e: FormEvent) {
    e.preventDefault(); if (!task || !comment.trim()) return;
    if (await mutate(() => supabase.from("task_comments").insert({ task_id: task.id, author_id: me!.id, body: comment.trim() }), "Комментарий добавлен")) setComment("");
  }
  async function askDeadline(e: FormEvent) {
    e.preventDefault(); if (!task || !reason.trim() || !proposed) return;
    if (await mutate(() => supabase.from("deadline_requests").insert({ task_id: task.id, requested_by: me!.id, old_deadline: task.deadline, requested_deadline: fromYekatInput(proposed), reason: reason.trim() }), "Запрос отправлен")) { setReason(""); setProposed(""); }
  }
  async function resolve(id: string, status: "approved" | "rejected") {
    await mutate(() => supabase.from("deadline_requests").update({ status }).eq("id", id), status === "approved" ? "Новый срок утверждён" : "Запрос отклонён");
  }
  async function logout() { await supabase.auth.signOut(); localStorage.removeItem("nu_profile"); window.location.href = "/"; }
  async function inviteStaff(e: FormEvent) {
    e.preventDefault(); setInviteMessage(""); setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setInviteMessage("Войдите снова"); return; }
      const response = await fetch("/api/staff/invite", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(invite) });
      const result = await response.json().catch(() => null);
      if (!response.ok) { setInviteMessage(result?.error || `Не удалось пригласить (HTTP ${response.status})`); return; }
      setInviteMessage("Приглашение отправлено"); setInvite({ full_name: "", email: "", role: "smm" }); await refresh();
    } catch { setInviteMessage("Ошибка сети при отправке приглашения"); }
    finally { setInviting(false); }
  }
  function openCreate() { setForm({ ...blank, assignee_id: candidates[0]?.id || "" }); setSelected(null); setEditing(true); }
  function openEdit() { if (!task) return; setForm({ title: task.title, description: task.description || "", expected_result: task.expected_result, assignee_id: task.assignee_id, project_id: task.project_id || "", priority: task.priority, due_at: toYekatInput(task.deadline) }); setEditing(true); }

  function navigate(next:Tab) {setTab(next);setMenuOpen(false);setSearch("");setQuickFilter("");setFilter({employee:"",project:"",status:"",due:""});}
  function showTasks(kind:string) {
    navigate("tasks");
    if(kind==="review")setFilter({employee:"",project:"",status:"review",due:""});
    else if(["overdue","today","week"].includes(kind))setFilter({employee:"",project:"",status:"",due:kind});
    else setQuickFilter(kind);
  }
  const navItems: {key:Tab;label:string;icon:IconName}[]=[{key:"overview",label:"Обзор",icon:"home"},{key:"mine",label:"Мои задачи",icon:"mine"},{key:"tasks",label:"Все задачи",icon:"tasks"},{key:"recurring",label:"Регулярные",icon:"repeat"},{key:"calendar",label:"Календарь",icon:"calendar"},{key:"team",label:"Команда",icon:"team"},{key:"telegram",label:"Telegram",icon:"send"}];
  const currentNav=navItems.find(n=>n.key===tab)!;
  if (busy) return <main className="nu-loading"><Brand/><span className="nu-spinner"/><p>Загружаем рабочее пространство…</p></main>;
  return <main className="nu-app">
    {menuOpen&&<button className="nu-menu-backdrop" aria-label="Закрыть меню" onClick={()=>setMenuOpen(false)}/>}
    <aside className={`nu-sidebar ${menuOpen?"is-open":""}`}>
      <div className="nu-sidebar-brand"><Brand/><button className="nu-mobile-close" aria-label="Закрыть меню" onClick={()=>setMenuOpen(false)}><Icon name="close"/></button></div>
      <div className="nu-sidebar-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">{navItems.map(n=><button key={n.key} aria-current={tab===n.key?"page":undefined} className={`nu-nav-item ${tab===n.key?"active":""}`} onClick={()=>navigate(n.key)}><Icon name={n.icon}/><span>{n.label}</span>{n.key==="tasks"&&tasks.filter(overdue).length>0&&<span className="nu-nav-count">{tasks.filter(overdue).length}</span>}</button>)}</nav>
      <div className="nu-sidebar-footer"><Avatar name={me?.full_name||""}/><div><strong>{me?.full_name}</strong><small>{me&&roleNames[me.role]}</small></div><button aria-label="Выйти из аккаунта" title="Выйти" onClick={logout}><Icon name="logout" size={18}/></button></div>
    </aside>
    <div className="nu-workspace">
      <header className="nu-topbar"><button className="nu-mobile-menu nu-icon-button" aria-label="Открыть меню" onClick={()=>setMenuOpen(true)}><Icon name="menu"/></button><div className="nu-breadcrumb">Рабочее пространство <span>/</span> <strong>{currentNav.label}</strong></div><label className="nu-search"><Icon name="search" size={18}/><input aria-label="Поиск задач" placeholder="Найти задачу…" value={search} onChange={e=>{setSearch(e.target.value);setTab("tasks");setQuickFilter("");setFilter({employee:"",project:"",status:"",due:""});}}/>{search&&<button aria-label="Очистить поиск" onClick={()=>setSearch("")}><Icon name="close" size={15}/></button>}</label><button className="nu-icon-button nu-topbar-alert" aria-label="Задачи, требующие внимания" title="Требуют внимания" onClick={()=>showTasks("attention")}><Icon name="bell"/>{tasks.some(t=>overdue(t)||t.status==="review"||t.status==="at_risk")&&<i/>}</button></header>
      <div className="nu-content">
        <div className="nu-page-heading"><div><p className="nu-eyebrow">НЕ УСЛОЖНЯЙ · КОМАНДА</p><h1>{tab==="overview"?<>Всё под контролем<span>.</span></>:currentNav.label}</h1><p className="nu-page-subtitle">{new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",weekday:"long",day:"numeric",month:"long"}).format(new Date(clock))} · Екатеринбург</p></div>{candidates.length>0&&<button className="nu-primary" onClick={openCreate}><Icon name="plus" size={18}/><span>Создать задачу</span></button>}</div>
      {notice && <div role="status" className="mb-5 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">{notice}</div>}
      {tab === "overview" && me && <Overview tasks={tasks} staff={staff} requests={pendingRequests} rules={rules} instances={instances} me={me} clock={clock} open={openTask} showTasks={showTasks} showCalendar={()=>navigate("calendar")} showTeam={()=>navigate("team")}/>}
      {tab==="mine"&&<div className="nu-my-summary">{[{label:"На сегодня",value:tasks.filter(t=>t.assignee_id===me?.id&&t.status!=="completed"&&yekatDay(t.deadline)===yekatDay(new Date(clock).toISOString())).length,due:"today",status:""},{label:"Просрочено",value:tasks.filter(t=>t.assignee_id===me?.id&&overdue(t)).length,due:"overdue",status:""},{label:"На проверке",value:tasks.filter(t=>t.assignee_id===me?.id&&t.status==="review").length,due:"",status:"review"}].map(m=><button key={m.label} onClick={()=>setFilter({employee:"",project:"",status:m.status,due:m.due})}><span>{m.label}</span><strong>{m.value}</strong><Icon name="arrow" size={15}/></button>)}</div>}
      {(tab === "tasks" || tab === "mine") && <section className={panel}><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">{tab === "mine" ? "Мои задачи" : "Задачи команды"}</h2><p className="mt-1 text-sm text-stone-500">{visible.length} задач</p></div></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Select value={filter.employee} onChange={v => setFilter({ ...filter, employee: v })} options={[["","Все сотрудники"],...staff.map(p => [p.id,p.full_name])]} /><Select value={filter.project} onChange={v => setFilter({ ...filter, project: v })} options={[["","Все проекты"],...projects.map(p => [p.id,p.name])]} /><Select value={filter.status} onChange={v => setFilter({ ...filter, status: v })} options={[["","Все статусы"],...statuses.map(s => [s,statusNames[s]])]} /><Select value={filter.due} onChange={v => setFilter({ ...filter, due: v })} options={[["","Любой срок"],["overdue","Просрочено"],["today","Сегодня"],["week","Следующие 7 дней"]]} /></div>
        {(search||quickFilter||Object.values(filter).some(Boolean))&&<button className="nu-link mt-4" onClick={()=>{setSearch("");setQuickFilter("");setFilter({employee:"",project:"",status:"",due:""});}}>Сбросить фильтры</button>}
        <TaskList items={visible} name={name} project={project} open={openTask} /></section>}
      {tab === "telegram" && me && <TelegramPanel owner={me.role === "owner"} />}
      {(tab === "recurring" || tab === "calendar") && me && <RecurringPanel key={tab} initialView={tab==="calendar"?"calendar":"rules"} me={me} staff={staff} projects={projects} tasks={tasks} openTask={openTask} refreshTasks={refresh} />}
      {tab === "team" && <section className="grid gap-5 lg:grid-cols-[2fr_1fr]"><div className={panel}><h2 className="text-xl font-semibold">Сотрудники</h2><div className="mt-5 space-y-3">{staff.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 p-4"><div><div className="font-medium">{p.full_name}</div><div className="text-xs text-stone-500">{roleNames[p.role]} · {p.is_active ? "Активен" : "Отключён"} · {tasks.filter(t => t.assignee_id === p.id && t.status !== "completed").length} задач</div></div>{me?.role === "owner" && p.id !== me.id && <div className="flex flex-wrap gap-2"><select aria-label={`Роль ${p.full_name}`} value={p.role} className="rounded-lg bg-stone-100 p-2 text-sm" onChange={e => mutate(() => supabase.from("profiles").update({ role: e.target.value }).eq("id", p.id), "Роль обновлена")}><option value="manager">Управляющий</option><option value="smm">SMM</option><option value="senior_master">Старший мастер</option></select><button className={button} onClick={() => mutate(() => supabase.from("profiles").update({ is_active: !p.is_active }).eq("id", p.id), "Доступ обновлён")}>{p.is_active ? "Отключить" : "Включить"}</button></div>}</div>)}</div>{me?.role === "owner" && <form onSubmit={inviteStaff} className="mt-6 grid gap-3 border-t border-stone-200 pt-5 sm:grid-cols-2"><h3 className="font-semibold sm:col-span-2">Пригласить сотрудника</h3><input className={field} required maxLength={100} placeholder="Имя" value={invite.full_name} onChange={e => setInvite({ ...invite, full_name: e.target.value })} /><input className={field} required type="email" placeholder="Email" value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} /><Select value={invite.role} onChange={v => setInvite({ ...invite, role: v })} options={[["manager","Управляющий"],["smm","SMM"],["senior_master","Старший мастер"]]} /><button type="submit" disabled={inviting} className={button}>{inviting ? "Отправляем…" : "Отправить приглашение"}</button>{inviteMessage && <p role="status" aria-live="polite" className="text-sm sm:col-span-2">{inviteMessage}</p>}</form>}</div><div className={panel}><h2 className="text-xl font-semibold">Проекты</h2><div className="mt-4 space-y-2 text-sm">{projects.map(p => <div key={p.id} className="rounded-lg bg-stone-50 p-3">{p.name}</div>)}</div>{me?.role === "owner" && <form className="mt-5 flex flex-col gap-2" onSubmit={async e => { e.preventDefault(); if (await mutate(() => supabase.from("projects").insert({ name: projectName.trim(), owner_id: me?.id }), "Проект создан")) setProjectName(""); }}><input className={field} value={projectName} onChange={e => setProjectName(e.target.value)} minLength={2} maxLength={100} required placeholder="Название проекта" /><button className={button}>Добавить проект</button></form>}</div></section>}
      <footer className="nu-page-footer"><span>Не Усложняй · Рабочее пространство</span><button onClick={()=>navigate("telegram")}><Icon name="send" size={14}/> Настроить Telegram</button></footer>
      </div>
    </div>
    <nav className="nu-bottom-nav" aria-label="Мобильная навигация">{([{key:"overview",label:"Обзор",icon:"home"},{key:"mine",label:"Мои",icon:"mine"},{key:"calendar",label:"Календарь",icon:"calendar"}] as const).map(n=><button key={n.key} className={tab===n.key?"active":""} onClick={()=>navigate(n.key)}><Icon name={n.icon}/><span>{n.label}</span></button>)}<button className={menuOpen?"active":""} onClick={()=>setMenuOpen(v=>!v)}><Icon name="menu"/><span>Ещё</span></button></nav>
    {(task || editing) && <Drawer close={()=>{setSelected(null);setEditing(false);}}><section className="nu-drawer-content"><div className="flex items-start justify-between gap-4"><h2 className="text-2xl font-semibold">{editing ? task ? "Редактировать задачу" : "Новая задача" : task?.title}</h2><button aria-label="Закрыть" className={button} onClick={() => { setSelected(null); setEditing(false); }}>✕</button></div>
      {notice&&<p className="nu-feedback" role="status">{notice}</p>}
      {editing ? <form onSubmit={saveTask} className="mt-7 space-y-4"><Label text="Название"><input className={field} required minLength={3} maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Label><Label text="Описание"><textarea className={field} rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Label><Label text="Ожидаемый результат *"><textarea className={field} rows={3} required value={form.expected_result} onChange={e => setForm({ ...form, expected_result: e.target.value })} /></Label><div className="grid gap-4 sm:grid-cols-2"><Label text="Исполнитель"><Select value={form.assignee_id} onChange={v => setForm({ ...form, assignee_id: v })} options={[["","Выберите"],...candidates.map(p => [p.id,p.full_name])]} /></Label><Label text="Проект"><Select value={form.project_id} onChange={v => setForm({ ...form, project_id: v })} options={[["","Без проекта"],...projects.filter(p => p.is_active).map(p => [p.id,p.name])]} /></Label><Label text="Приоритет"><Select value={form.priority} onChange={v => setForm({ ...form, priority: v as Priority })} options={(Object.keys(priorityNames) as Priority[]).map(p => [p,priorityNames[p]])} /></Label><Label text="Дедлайн, Екатеринбург"><input className={field} type="datetime-local" required value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} /></Label></div><button className="rounded-xl bg-[#ff641f] px-5 py-3 font-medium text-white">Сохранить задачу</button></form> : task && <div className="mt-6 space-y-7"><div className="flex flex-wrap gap-2 text-sm"><span className="rounded-lg bg-stone-100 px-3 py-1">{statusNames[task.status]}</span>{overdue(task) && <span className="rounded-lg bg-red-50 px-3 py-1 text-red-700">Просрочено</span>}<span className="rounded-lg bg-stone-100 px-3 py-1">{priorityNames[task.priority]}</span></div><div className="grid gap-3 text-sm sm:grid-cols-2"><Info label="Исполнитель" value={name(task.assignee_id)} /><Info label="Постановщик" value={name(task.created_by)} /><Info label="Проект" value={project(task.project_id)} /><Info label="Дедлайн" value={fmt(task.deadline)} /></div><div><div className="text-xs uppercase tracking-widest text-stone-500">Описание</div><p className="mt-2 whitespace-pre-wrap text-stone-700">{task.description ? task.description.split("\n").filter(l=>!/^[•*–-]\s+/.test(l.trim())&&!/^Чек-лист:?$/i.test(l.trim())).join("\n").trim() || "Выполните проверки из чек-листа ниже." : "Нет описания"}</p></div><div className="rounded-xl border border-stone-200 bg-stone-50 p-4"><div className="text-xs uppercase tracking-widest text-stone-500">Ожидаемый результат</div><p className="mt-2 whitespace-pre-wrap">{task.expected_result}</p></div>
        <TaskChecklist taskId={task.id} description={task.description||""} editable={task.status!=="completed"&&(canEdit||task.assignee_id===me?.id)} onChange={()=>void loadDetail(task.id)}/>
        <div className="flex flex-wrap gap-2">{canEdit && <button className={button} onClick={openEdit}>Редактировать</button>}{me?.role === "owner" && <Select value={task.status} onChange={v => changeStatus(v as Status)} options={statuses.map(s => [s,statusNames[s]])} />}{me?.role !== "owner" && task.assignee_id === me?.id && task.status !== "completed" && <Select value={task.status} onChange={v => changeStatus(v as Status)} options={statuses.filter(s => s !== "completed"&&(s!=="new"||task.status==="new")).map(s => [s,statusNames[s]])} />}{me?.role !== "owner" && canEdit && task.status === "review" && <button className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black" onClick={() => changeStatus("completed")}>Подтвердить завершение</button>}{me?.role !== "owner" && canEdit && task.status === "completed" && <button className={button} onClick={() => changeStatus("in_progress")}>Вернуть в работу</button>}{me?.role === "owner" && <button className="rounded-xl border border-red-500/40 px-4 py-2 text-sm text-red-700 hover:bg-red-500/10" onClick={deleteTask}>Удалить задачу</button>}</div>
        {task.status==="review"&&canEdit&&me?.role==="owner"&&<button className="nu-primary" onClick={()=>changeStatus("completed")}><Icon name="check" size={18}/>Подтвердить завершение</button>}
        {task.assignee_id === me?.id && task.status !== "completed" && <form onSubmit={askDeadline} className="space-y-3 rounded-xl border border-stone-200 p-4"><h3 className="font-semibold">Запросить перенос срока</h3><input className={field} type="datetime-local" required value={proposed} onChange={e => setProposed(e.target.value)} /><textarea className={field} required placeholder="Причина переноса" value={reason} onChange={e => setReason(e.target.value)} /><button className={button}>Отправить запрос</button></form>}
        <div><h3 className="font-semibold">Переносы сроков</h3><div className="mt-3 space-y-3">{requests.length === 0 && <p className="text-sm text-stone-500">Запросов нет</p>}{requests.map(r => <div key={r.id} className="rounded-xl bg-stone-50 p-4 text-sm"><div>{name(r.requested_by)} просит до {fmt(r.requested_deadline)}</div><p className="my-2 text-stone-600">{r.reason}</p><span className="text-stone-500">{r.status === "pending" ? "Ожидает решения" : r.status === "approved" ? "Одобрено" : "Отклонено"}</span>{canEdit && r.status === "pending" && <div className="mt-3 flex gap-2"><button className={button} onClick={() => resolve(r.id,"approved")}>Одобрить</button><button className={button} onClick={() => resolve(r.id,"rejected")}>Отклонить</button></div>}</div>)}</div></div>
        <div><h3 className="font-semibold">Комментарии</h3><div className="mt-3 space-y-3">{comments.map(c => <div key={c.id} className="rounded-xl bg-stone-50 p-4"><div className="text-xs text-stone-500">{name(c.author_id)} · {fmt(c.created_at)}</div><p className="mt-2 whitespace-pre-wrap text-sm">{c.body}</p></div>)}</div><form onSubmit={addComment} className="mt-3 flex flex-col gap-2"><textarea className={field} value={comment} onChange={e => setComment(e.target.value)} required placeholder="Написать комментарий" /><button className={button}>Отправить</button></form></div>
        <div><h3 className="font-semibold">История изменений</h3><div className="mt-3 space-y-2">{events.map(e => <div key={e.id} className="border-l border-stone-200 py-1 pl-4 text-sm text-stone-600">{fmt(e.created_at)} · {name(e.user_id || "")} · {e.action === "created" ? "Создал задачу" : e.action === "updated" ? "Изменил задачу" : e.action === "deadline_requested" ? "Запросил перенос" : e.action === "deadline_approved" ? "Одобрил перенос" : "Отклонил перенос"}{e.action === "updated" && <EventChanges before={e.old_value} after={e.new_value} />}</div>)}</div></div>
      </div>}
    </section></Drawer>}
  </main>;
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[][] }) { return <select className={field} value={value} onChange={e => onChange(e.target.value)}>{options.map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select>; }
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-sm text-stone-600">{text}</span>{children}</label>; }
function Info({ label, value }: { label: string; value: string }) { return <div><div className="text-xs text-stone-500">{label}</div><div className="mt-1">{value}</div></div>; }
function TaskList({ items, name, project, open }: { items: Task[]; name: (id: string) => string; project: (id: string | null) => string; open: (id: string) => void }) { return <div className="nu-task-list">{items.length === 0 && <div className="nu-empty"><span className="nu-empty-icon"><Icon name="check" size={24}/></span><h3>Здесь пока нет задач</h3><p>Выберите другой период или измените фильтры.</p></div>}{items.map(t => <button key={t.id} onClick={() => open(t.id)} className="nu-task-card"><span className={`nu-task-icon ${overdue(t)?"is-late":""}`}><Icon name={overdue(t)?"alert":"tasks"}/></span><span className="nu-task-card-body"><strong>{t.title}</strong><span className="nu-task-card-meta">{project(t.project_id)} · {name(t.assignee_id)}</span></span><span className="nu-task-card-info"><span className={`nu-status-text status-${t.status}`}>{statusNames[t.status]}</span><time className={overdue(t)?"nu-danger":"nu-muted"}>{fmt(t.deadline)}</time>{(t.priority==="high"||t.priority==="critical")&&<span className="nu-badge nu-badge-orange">{priorityNames[t.priority]}</span>}</span><span className="nu-task-card-arrow"><Icon name="arrow" size={17}/></span></button>)}</div>; }
function EventChanges({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) { const prior = before || {}; const next = after || {}; const changed = Object.keys(next).filter(k => JSON.stringify(prior[k]) !== JSON.stringify(next[k]) && k !== "completed_at"); const labels: Record<string,string> = { title: "Название", description: "Описание", expected_result: "Результат", assignee_id: "Исполнитель", project_id: "Проект", priority: "Приоритет", status: "Статус", deadline: "Дедлайн", checklist:"Чек-лист" }; return <div className="mt-1 text-xs text-stone-500">{changed.map(k => labels[k] || k).join(", ")}</div>; }

