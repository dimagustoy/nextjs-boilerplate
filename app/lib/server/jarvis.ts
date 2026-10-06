import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./telegram";

type Role = "owner" | "manager" | "smm" | "senior_master";
type Status = "new" | "accepted" | "in_progress" | "waiting" | "at_risk" | "review" | "completed";
type Priority = "low" | "normal" | "high" | "critical";
type IntentName = "help" | "list_today" | "attention" | "create_task" | "update_status" | "change_deadline" | "add_comment" | "unknown";

type Profile = { id: string; full_name: string; role: Role; is_active: boolean };
type Project = { id: string; name: string; is_active: boolean };
type Task = {
  id: string; title: string; description: string | null; expected_result: string; assignee_id: string; created_by: string;
  project_id: string | null; priority: Priority; status: Status; deadline: string; completed_at: string | null;
};

type JarvisContext = {
  admin: SupabaseClient;
  me: Profile;
  staff: Profile[];
  projects: Project[];
  tasks: Task[];
  visibleTasks: Task[];
  assignable: Profile[];
};

type Intent = {
  intent: IntentName;
  assignee_id: string | null;
  project_id: string | null;
  task_id: string | null;
  title: string | null;
  description: string | null;
  expected_result: string | null;
  priority: Priority | null;
  deadline: string | null;
  new_status: Status | null;
  comment: string | null;
  reason: string | null;
};

const RU_STATUS: Record<Status, string> = {
  new: "Новая", accepted: "Принята", in_progress: "В работе", waiting: "Ожидание",
  at_risk: "Под угрозой", review: "На проверке", completed: "Завершена",
};
const RU_PRIORITY: Record<Priority, string> = { low: "низкий", normal: "обычный", high: "высокий", critical: "критичный" };
const TZ = "Asia/Yekaterinburg";
const HELP = [
  "Я Jarvis, менеджер задач NU TEAM.",
  "",
  "Можно написать обычным текстом, например:",
  "• Поставь Сергею до пятницы узнать цены на оборудование. Результат: 3 варианта с ценой и сроками.",
  "• Что горит?",
  "• Какие у меня задачи сегодня?",
  "• По задаче «Посуда» всё готово.",
  "• Перенеси задачу «Каталог» на понедельник, поставщик задержал ответ.",
  "",
  "Записывающие действия я сначала покажу на подтверждение.",
].join("\n");

export function jarvisHelp() { return HELP; }

function fmtDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function dayKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function norm(s: string) { return s.toLocaleLowerCase("ru").replace(/[ё]/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").trim(); }
function words(s: string) { return norm(s).split(/\s+/).filter(Boolean); }
function visibleFor(me: Profile, staff: Profile[], task: Task) {
  if (me.role === "owner") return true;
  if (task.assignee_id === me.id || task.created_by === me.id) return true;
  if (me.role === "manager") {
    const target = staff.find(p => p.id === task.assignee_id);
    return !!target && ["smm", "senior_master"].includes(target.role);
  }
  return false;
}
function assignableFor(me: Profile, staff: Profile[]) {
  if (me.role === "owner") return staff.filter(p => p.is_active);
  if (me.role === "manager") return staff.filter(p => p.is_active && ["smm", "senior_master"].includes(p.role));
  return [];
}

export async function loadJarvisContext(chatId: number): Promise<JarvisContext | null> {
  const admin = adminClient();
  const { data: link } = await admin.from("telegram_links").select("user_id").eq("chat_id", chatId).maybeSingle();
  if (!link?.user_id) return null;
  const [meRes, staffRes, projectsRes, tasksRes] = await Promise.all([
    admin.from("profiles").select("id,full_name,role,is_active").eq("id", link.user_id).maybeSingle(),
    admin.from("profiles").select("id,full_name,role,is_active").eq("is_active", true).order("full_name"),
    admin.from("projects").select("id,name,is_active").eq("is_active", true).order("name"),
    admin.from("tasks").select("id,title,description,expected_result,assignee_id,created_by,project_id,priority,status,deadline,completed_at").order("deadline").limit(1000),
  ]);
  if (!meRes.data?.is_active || staffRes.error || projectsRes.error || tasksRes.error) return null;
  const me = meRes.data as Profile;
  const staff = (staffRes.data || []) as Profile[];
  const tasks = (tasksRes.data || []) as Task[];
  return {
    admin, me, staff, projects: (projectsRes.data || []) as Project[], tasks,
    visibleTasks: tasks.filter(t => visibleFor(me, staff, t)),
    assignable: assignableFor(me, staff),
  };
}

function emptyIntent(intent: IntentName): Intent {
  return { intent, assignee_id: null, project_id: null, task_id: null, title: null, description: null, expected_result: null, priority: null, deadline: null, new_status: null, comment: null, reason: null };
}

function findByName<T extends { id: string; full_name?: string; name?: string }>(text: string, items: T[]) {
  const n = norm(text);
  return items.find(item => {
    const label = norm(item.full_name || item.name || "");
    if (!label) return false;
    if (n.includes(label)) return true;
    const first = label.split(" ")[0];
    return first.length >= 3 && n.split(" ").includes(first);
  }) || null;
}

function bestTask(text: string, tasks: Task[]) {
  const queryWords = words(text).filter(w => !["задача","задаче","задачу","готово","сделал","сделана","выполнено","выполнена","перенеси","перенести","дедлайн","срок","комментарий"].includes(w));
  if (!queryWords.length) return null;
  let best: { task: Task; score: number } | null = null;
  for (const task of tasks.filter(t => t.status !== "completed")) {
    const hay = new Set(words(`${task.title} ${task.description || ""} ${task.expected_result}`));
    const score = queryWords.reduce((sum, w) => sum + (hay.has(w) ? 2 : [...hay].some(h => h.startsWith(w) || w.startsWith(h)) ? 1 : 0), 0);
    if (score > (best?.score || 0)) best = { task, score };
  }
  return best && best.score >= 2 ? best.task : null;
}

function yekatNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return { year: +get("year"), month: +get("month"), day: +get("day"), hour: +get("hour"), minute: +get("minute") };
}
function localDateToIso(year: number, month: number, day: number, hour = 23, minute = 59) {
  const mm = String(month).padStart(2, "0"), dd = String(day).padStart(2, "0"), hh = String(hour).padStart(2, "0"), mi = String(minute).padStart(2, "0");
  return new Date(`${year}-${mm}-${dd}T${hh}:${mi}:00+05:00`).toISOString();
}
function parseDeadlineFallback(text: string): string | null {
  const n = norm(text);
  const now = yekatNowParts();
  const timeMatch = text.match(/(?:до\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)/);
  const hour = timeMatch ? +timeMatch[1] : 23, minute = timeMatch ? +timeMatch[2] : 59;
  const explicit = text.match(/(?:до\s+)?(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
  if (explicit) {
    let year = explicit[3] ? +explicit[3] : now.year;
    if (year < 100) year += 2000;
    let iso = localDateToIso(year, +explicit[2], +explicit[1], hour, minute);
    if (new Date(iso).getTime() <= Date.now() && !explicit[3]) iso = localDateToIso(year + 1, +explicit[2], +explicit[1], hour, minute);
    return iso;
  }
  const base = new Date(localDateToIso(now.year, now.month, now.day, hour, minute));
  if (n.includes("сегодня")) return base.toISOString();
  if (n.includes("завтра")) return new Date(base.getTime() + 86400000).toISOString();
  const weekdays: Array<[string, number]> = [["понедель",1],["вторник",2],["сред",3],["четверг",4],["пятниц",5],["суббот",6],["воскрес",0]];
  const found = weekdays.find(([stem]) => n.includes(stem));
  if (found) {
    const current = new Date(`${now.year}-${String(now.month).padStart(2,"0")}-${String(now.day).padStart(2,"0")}T12:00:00+05:00`).getDay();
    let delta = (found[1] - current + 7) % 7;
    if (delta === 0 && base.getTime() <= Date.now()) delta = 7;
    return new Date(base.getTime() + delta * 86400000).toISOString();
  }
  return null;
}

function fallbackIntent(ctx: JarvisContext, text: string): Intent {
  const n = norm(text);
  if (!n || n === "помощь" || n.includes("что ты умеешь")) return emptyIntent("help");
  if (n.includes("что горит") || n.includes("требует внимания") || n.includes("просроч")) return emptyIntent("attention");
  if ((n.includes("мои задач") || n.includes("у меня задач") || n.includes("задачи на сегодня") || n.includes("задач сегодня")) && !n.includes("постав")) return emptyIntent("list_today");

  const task = bestTask(text, ctx.visibleTasks);
  if (task && /(готово|сделал|сделана|выполнено|выполнена|завершил)/i.test(text)) {
    const i = emptyIntent("update_status"); i.task_id = task.id; i.new_status = ctx.me.id === task.assignee_id ? "review" : "completed"; return i;
  }
  if (task && /(перенеси|перенести|новый срок|новый дедлайн)/i.test(text)) {
    const deadline = parseDeadlineFallback(text); if (deadline) { const i = emptyIntent("change_deadline"); i.task_id = task.id; i.deadline = deadline; i.reason = text; return i; }
  }
  if (task && /(комментарий|добавь к задаче|по задаче)/i.test(text) && !/(готово|перенеси|перенести)/i.test(text)) {
    const i = emptyIntent("add_comment"); i.task_id = task.id; i.comment = text; return i;
  }

  const assignee = findByName(text, ctx.assignable);
  const deadline = parseDeadlineFallback(text);
  if (assignee && deadline && /(постав|создай|задач|поручи|нужно|надо)/i.test(text)) {
    const i = emptyIntent("create_task");
    const resultMatch = text.match(/(?:результат|ожидаемый результат)\s*[:—-]\s*(.+)$/i);
    const needMatch = text.match(/(?:нужно получить|нужно чтобы|результатом должно быть)\s+(.+)$/i);
    i.assignee_id = assignee.id;
    i.project_id = findByName(text, ctx.projects)?.id || null;
    i.deadline = deadline;
    i.priority = /(критич|немедленно|срочно!)/i.test(text) ? "critical" : /(срочно|важно)/i.test(text) ? "high" : "normal";
    i.title = text.replace(/^(поставь|создай|поручи)\s+/i, "").replace(new RegExp(assignee.full_name.split(" ")[0], "i"), "").replace(/\s+/g, " ").trim().slice(0, 180);
    i.description = text;
    i.expected_result = (resultMatch?.[1] || needMatch?.[1] || i.title).trim().slice(0, 1000);
    return i;
  }
  return emptyIntent("unknown");
}

function responseText(data: any): string | null {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output || []) for (const content of item?.content || []) if (typeof content?.text === "string") return content.text;
  return null;
}

async function aiIntent(ctx: JarvisContext, text: string): Promise<Intent | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const activeTasks = ctx.visibleTasks.filter(t => t.status !== "completed").slice(0, 120).map(t => ({ id: t.id, title: t.title, status: t.status, assignee_id: t.assignee_id, deadline: t.deadline }));
  const now = new Date();
  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      intent: { type: "string", enum: ["help","list_today","attention","create_task","update_status","change_deadline","add_comment","unknown"] },
      assignee_id: { anyOf: [{ type: "string" }, { type: "null" }] }, project_id: { anyOf: [{ type: "string" }, { type: "null" }] }, task_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      title: { anyOf: [{ type: "string" }, { type: "null" }] }, description: { anyOf: [{ type: "string" }, { type: "null" }] }, expected_result: { anyOf: [{ type: "string" }, { type: "null" }] },
      priority: { anyOf: [{ type: "string", enum: ["low","normal","high","critical"] }, { type: "null" }] }, deadline: { anyOf: [{ type: "string" }, { type: "null" }] },
      new_status: { anyOf: [{ type: "string", enum: ["new","accepted","in_progress","waiting","at_risk","review","completed"] }, { type: "null" }] },
      comment: { anyOf: [{ type: "string" }, { type: "null" }] }, reason: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["intent","assignee_id","project_id","task_id","title","description","expected_result","priority","deadline","new_status","comment","reason"],
  };
  const system = `Ты Jarvis, диспетчер задач сети «Не Усложняй». Преобразуй сообщение в одно намерение. Сейчас ${now.toISOString()}, рабочая таймзона Asia/Yekaterinburg (UTC+5). Для дат верни ISO 8601 с явным +05:00. Никогда не выдумывай id: используй только id из справочников. Если пользователь-исполнитель говорит, что сделал задачу, новый статус review. completed ставь только когда руководитель явно подтверждает задачу, уже находящуюся на review. Если обязательных данных для записи нет, intent=unknown.\nПользователь: ${JSON.stringify(ctx.me)}\nРазрешённые исполнители: ${JSON.stringify(ctx.assignable.map(x => ({id:x.id,name:x.full_name,role:x.role})))}\nПроекты: ${JSON.stringify(ctx.projects.map(x => ({id:x.id,name:x.name})))}\nВидимые активные задачи: ${JSON.stringify(activeTasks)}`;
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna", reasoning: { effort: "none" },
        input: [{ role: "system", content: [{ type: "input_text", text: system }] }, { role: "user", content: [{ type: "input_text", text }] }],
        text: { format: { type: "json_schema", name: "jarvis_intent", strict: true, schema } },
      }), signal: AbortSignal.timeout(12000), cache: "no-store",
    });
    if (!res.ok) return null;
    const raw = responseText(await res.json());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Intent;
    return parsed;
  } catch { return null; }
}

function validateIntent(ctx: JarvisContext, intent: Intent): Intent {
  if (intent.assignee_id && !ctx.assignable.some(x => x.id === intent.assignee_id)) intent.assignee_id = null;
  if (intent.project_id && !ctx.projects.some(x => x.id === intent.project_id)) intent.project_id = null;
  if (intent.task_id && !ctx.visibleTasks.some(x => x.id === intent.task_id)) intent.task_id = null;
  if (intent.deadline) {
    const d = new Date(intent.deadline); intent.deadline = Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return intent;
}

export async function interpretJarvis(ctx: JarvisContext, text: string): Promise<Intent> {
  const quick = fallbackIntent(ctx, text);
  if (["help","list_today","attention"].includes(quick.intent)) return quick;
  const ai = await aiIntent(ctx, text);
  return validateIntent(ctx, ai || quick);
}

export function renderReadIntent(ctx: JarvisContext, intent: Intent): string | null {
  if (intent.intent === "help") return HELP;
  if (intent.intent === "list_today") {
    const today = dayKey(new Date());
    const list = ctx.visibleTasks.filter(t => t.assignee_id === ctx.me.id && t.status !== "completed" && dayKey(t.deadline) === today);
    if (!list.length) return "На сегодня активных задач нет.";
    return ["Твои задачи на сегодня:", "", ...list.map((t,i) => `${i+1}. ${t.title}\n${RU_STATUS[t.status]} · до ${fmtDate(t.deadline)}`)].join("\n");
  }
  if (intent.intent === "attention") {
    const now = Date.now();
    const hot = ctx.visibleTasks.filter(t => t.status !== "completed" && (new Date(t.deadline).getTime() < now || t.status === "at_risk" || t.status === "review"))
      .sort((a,b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()).slice(0, 20);
    if (!hot.length) return "Сейчас ничего не горит. Подозрительно, но приятно.";
    const staffName = (id: string) => ctx.staff.find(p => p.id === id)?.full_name || "Сотрудник";
    return ["Требуют внимания:", "", ...hot.map((t,i) => {
      const overdue = new Date(t.deadline).getTime() < now;
      const marker = overdue ? "🔴" : t.status === "at_risk" ? "🟠" : "🟡";
      return `${marker} ${i+1}. ${t.title}\n${staffName(t.assignee_id)} · ${RU_STATUS[t.status]} · ${fmtDate(t.deadline)}`;
    })].join("\n");
  }
  return null;
}

function projectName(ctx: JarvisContext, id: string | null) { return ctx.projects.find(p => p.id === id)?.name || "Без проекта"; }
function staffName(ctx: JarvisContext, id: string | null) { return ctx.staff.find(p => p.id === id)?.full_name || "Не определён"; }
function taskName(ctx: JarvisContext, id: string | null) { return ctx.visibleTasks.find(t => t.id === id)?.title || "Не определена"; }

export function validateWrite(ctx: JarvisContext, i: Intent): string | null {
  if (i.intent === "create_task") {
    if (!i.assignee_id) return "Не понял, кому поставить задачу.";
    if (!i.title?.trim()) return "Не понял название задачи.";
    if (!i.expected_result?.trim()) return "Не понял ожидаемый результат. Добавь фразу «Результат: …».";
    if (!i.deadline || new Date(i.deadline).getTime() <= Date.now()) return "Не понял будущий дедлайн.";
    return null;
  }
  if (["update_status","change_deadline","add_comment"].includes(i.intent) && !i.task_id) return "Не понял, о какой задаче речь.";
  if (i.intent === "update_status" && !i.new_status) return "Не понял новый статус задачи.";
  if (i.intent === "change_deadline" && (!i.deadline || !i.reason)) return "Не понял новый срок или причину переноса.";
  if (i.intent === "add_comment" && !i.comment?.trim()) return "Не понял текст комментария.";
  if (i.intent === "unknown") return "Не уверен, что именно нужно сделать. Напиши чуть конкретнее или отправь «помощь».";
  return null;
}

export function renderProposal(ctx: JarvisContext, i: Intent) {
  if (i.intent === "create_task") return [
    "Создать задачу?", "",
    `Задача: ${i.title}`, `Исполнитель: ${staffName(ctx, i.assignee_id)}`, `Проект: ${projectName(ctx, i.project_id)}`,
    `Дедлайн: ${fmtDate(i.deadline!)}`, `Приоритет: ${RU_PRIORITY[i.priority || "normal"]}`, `Результат: ${i.expected_result}`,
  ].join("\n");
  if (i.intent === "update_status") return `Изменить статус задачи «${taskName(ctx, i.task_id)}» на «${RU_STATUS[i.new_status!]}»?`;
  if (i.intent === "change_deadline") return [`Изменить срок задачи «${taskName(ctx, i.task_id)}»?`, `Новый срок: ${fmtDate(i.deadline!)}`, `Причина: ${i.reason}`].join("\n");
  if (i.intent === "add_comment") return [`Добавить комментарий к задаче «${taskName(ctx, i.task_id)}»?`, i.comment || ""].join("\n");
  return "Подтвердить действие?";
}

export async function savePendingAction(ctx: JarvisContext, chatId: number, i: Intent) {
  const actionType = i.intent as "create_task" | "update_status" | "change_deadline" | "add_comment";
  await ctx.admin.from("telegram_pending_actions").delete().eq("user_id", ctx.me.id).lt("expires_at", new Date().toISOString());
  const { data, error } = await ctx.admin.from("telegram_pending_actions").insert({ user_id: ctx.me.id, chat_id: chatId, action_type: actionType, payload: i }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function executePendingAction(ctx: JarvisContext, chatId: number, actionId: string) {
  const { data: action, error } = await ctx.admin.from("telegram_pending_actions").select("id,user_id,chat_id,action_type,payload,expires_at").eq("id", actionId).eq("user_id", ctx.me.id).eq("chat_id", chatId).maybeSingle();
  if (error || !action) return "Действие не найдено или уже выполнено.";
  if (new Date(action.expires_at).getTime() < Date.now()) { await ctx.admin.from("telegram_pending_actions").delete().eq("id", actionId); return "Подтверждение устарело. Отправь поручение ещё раз."; }
  const p = action.payload as Intent;
  let resultText = "Готово.";
  if (action.action_type === "create_task") {
    const { data, error: rpcError } = await ctx.admin.rpc("nu_jarvis_create_task", {
      p_actor: ctx.me.id, p_assignee: p.assignee_id, p_title: p.title, p_description: p.description || "", p_expected_result: p.expected_result,
      p_project: p.project_id, p_priority: p.priority || "normal", p_deadline: p.deadline,
    });
    if (rpcError) throw rpcError;
    resultText = `Задача создана: ${p.title}\nID: ${String(data).slice(0,8)}`;
  } else if (action.action_type === "update_status") {
    const { error: rpcError } = await ctx.admin.rpc("nu_jarvis_update_status", { p_actor: ctx.me.id, p_task: p.task_id, p_status: p.new_status });
    if (rpcError) throw rpcError;
    resultText = `Статус обновлён: ${taskName(ctx, p.task_id)} → ${RU_STATUS[p.new_status!]}`;
  } else if (action.action_type === "change_deadline") {
    const { data, error: rpcError } = await ctx.admin.rpc("nu_jarvis_change_deadline", { p_actor: ctx.me.id, p_task: p.task_id, p_deadline: p.deadline, p_reason: p.reason });
    if (rpcError) throw rpcError;
    resultText = data === "requested" ? "Запрос на перенос срока отправлен руководителю." : `Срок изменён: ${fmtDate(p.deadline!)}`;
  } else if (action.action_type === "add_comment") {
    const { error: rpcError } = await ctx.admin.rpc("nu_jarvis_add_comment", { p_actor: ctx.me.id, p_task: p.task_id, p_body: p.comment });
    if (rpcError) throw rpcError;
    resultText = "Комментарий добавлен к задаче.";
  }
  await ctx.admin.from("telegram_pending_actions").delete().eq("id", actionId);
  return resultText;
}

export async function cancelPendingAction(ctx: JarvisContext, chatId: number, actionId: string) {
  await ctx.admin.from("telegram_pending_actions").delete().eq("id", actionId).eq("user_id", ctx.me.id).eq("chat_id", chatId);
  return "Отменил.";
}
