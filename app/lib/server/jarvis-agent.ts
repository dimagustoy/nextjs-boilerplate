import type { SupabaseClient } from "@supabase/supabase-js";
import { loadJarvisMemory } from "./jarvis-brain";

type Role = "owner" | "manager" | "smm" | "senior_master";
type Status = "new" | "accepted" | "in_progress" | "waiting" | "at_risk" | "review" | "completed";
type Priority = "low" | "normal" | "high" | "critical";

type Profile = { id: string; full_name: string; role: Role; is_active: boolean };
type Project = { id: string; name: string; is_active: boolean };
type Task = {
  id: string;
  title: string;
  description: string | null;
  expected_result: string;
  assignee_id: string;
  created_by: string;
  project_id: string | null;
  priority: Priority;
  status: Status;
  deadline: string;
  completed_at: string | null;
};

export type AgentContext = {
  admin: SupabaseClient;
  me: Profile;
  staff: Profile[];
  projects: Project[];
  visibleTasks: Task[];
  assignable: Profile[];
};

export type JarvisAction = {
  type:
    | "create_task"
    | "update_task"
    | "add_comment"
    | "add_dependency"
    | "remove_dependency"
    | "set_checklist_item"
    | "resolve_deadline_request"
    | "create_project"
    | "update_project"
    | "create_recurring_rule"
    | "update_recurring_rule"
    | "create_reminder"
    | "cancel_reminder";
  task_id: string | null;
  assignee_id: string | null;
  project_id: string | null;
  title: string | null;
  description: string | null;
  expected_result: string | null;
  priority: Priority | null;
  status: Status | null;
  deadline: string | null;
  reason: string | null;
  body: string | null;
  depends_on_task_id: string | null;
  item_index: number | null;
  label: string | null;
  done: boolean | null;
  request_id: string | null;
  decision: "approved" | "rejected" | null;
  clear_description: boolean | null;
  clear_project: boolean | null;
  waiting_for: string | null;
  risk_reason: string | null;
  clear_waiting_for: boolean | null;
  clear_risk_reason: boolean | null;
  project_name: string | null;
  project_description: string | null;
  project_is_active: boolean | null;
  recurring_id: string | null;
  frequency: "daily" | "weekly" | "monthly" | null;
  month_pattern: "all" | "odd" | "even" | null;
  due_kind: "day" | "last_day" | "last_weekday" | null;
  due_day: number | null;
  due_weekday: number | null;
  due_time: string | null;
  reminder_mode: "offsets" | "month_day" | null;
  reminder_day: number | null;
  reminder_days: number[] | null;
  starts_on: string | null;
  is_active: boolean | null;
  reminder_id: string | null;
  remind_at: string | null;
};

export type JarvisAgentResult = {
  mode: "reply" | "action";
  reply: string | null;
  actions: JarvisAction[];
};

const TZ = "Asia/Yekaterinburg";
const RU_PRIORITY: Record<Priority, string> = { low: "низкий", normal: "обычный", high: "высокий", critical: "критичный" };
const RU_STATUS: Record<Status, string> = {
  new: "Новая",
  accepted: "Принята",
  in_progress: "В работе",
  waiting: "Ожидание",
  at_risk: "Под угрозой",
  review: "На проверке",
  completed: "Завершена",
};

function responseText(data: any): string | null {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  return null;
}

function fmtDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function taskName(ctx: AgentContext, id: string | null) {
  return ctx.visibleTasks.find(t => t.id === id)?.title || "задача";
}
function staffName(ctx: AgentContext, id: string | null) {
  return ctx.staff.find(p => p.id === id)?.full_name || "сотрудник";
}
function projectName(ctx: AgentContext, id: string | null) {
  return ctx.projects.find(p => p.id === id)?.name || "Без проекта";
}
function nullable(type: Record<string, unknown>) {
  return { anyOf: [type, { type: "null" }] };
}

const actionTypes = [
  "create_task",
  "update_task",
  "add_comment",
  "add_dependency",
  "remove_dependency",
  "set_checklist_item",
  "resolve_deadline_request",
  "create_project",
  "update_project",
  "create_recurring_rule",
  "update_recurring_rule",
  "create_reminder",
  "cancel_reminder",
] as const;

const operationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: actionTypes },
    task_id: nullable({ type: "string" }),
    assignee_id: nullable({ type: "string" }),
    project_id: nullable({ type: "string" }),
    title: nullable({ type: "string" }),
    description: nullable({ type: "string" }),
    expected_result: nullable({ type: "string" }),
    priority: { anyOf: [{ type: "string", enum: ["low", "normal", "high", "critical"] }, { type: "null" }] },
    status: { anyOf: [{ type: "string", enum: ["new", "accepted", "in_progress", "waiting", "at_risk", "review", "completed"] }, { type: "null" }] },
    deadline: nullable({ type: "string" }),
    reason: nullable({ type: "string" }),
    body: nullable({ type: "string" }),
    depends_on_task_id: nullable({ type: "string" }),
    item_index: nullable({ type: "integer" }),
    label: nullable({ type: "string" }),
    done: nullable({ type: "boolean" }),
    request_id: nullable({ type: "string" }),
    decision: { anyOf: [{ type: "string", enum: ["approved", "rejected"] }, { type: "null" }] },
    clear_description: nullable({ type: "boolean" }),
    clear_project: nullable({ type: "boolean" }),
    waiting_for: nullable({ type: "string" }),
    risk_reason: nullable({ type: "string" }),
    clear_waiting_for: nullable({ type: "boolean" }),
    clear_risk_reason: nullable({ type: "boolean" }),
    project_name: nullable({ type: "string" }),
    project_description: nullable({ type: "string" }),
    project_is_active: nullable({ type: "boolean" }),
    recurring_id: nullable({ type: "string" }),
    frequency: { anyOf: [{ type: "string", enum: ["daily", "weekly", "monthly"] }, { type: "null" }] },
    month_pattern: { anyOf: [{ type: "string", enum: ["all", "odd", "even"] }, { type: "null" }] },
    due_kind: { anyOf: [{ type: "string", enum: ["day", "last_day", "last_weekday"] }, { type: "null" }] },
    due_day: nullable({ type: "integer" }),
    due_weekday: nullable({ type: "integer" }),
    due_time: nullable({ type: "string" }),
    reminder_mode: { anyOf: [{ type: "string", enum: ["offsets", "month_day"] }, { type: "null" }] },
    reminder_day: nullable({ type: "integer" }),
    reminder_days: { anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }] },
    starts_on: nullable({ type: "string" }),
    is_active: nullable({ type: "boolean" }),
    reminder_id: nullable({ type: "string" }),
    remind_at: nullable({ type: "string" }),
  },
  required: [
    "type", "task_id", "assignee_id", "project_id", "title", "description", "expected_result", "priority", "status",
    "deadline", "reason", "body", "depends_on_task_id", "item_index", "label", "done", "request_id", "decision",
    "clear_description", "clear_project", "waiting_for", "risk_reason", "clear_waiting_for", "clear_risk_reason",
    "project_name", "project_description", "project_is_active", "recurring_id", "frequency", "month_pattern", "due_kind",
    "due_day", "due_weekday", "due_time", "reminder_mode", "reminder_day", "reminder_days", "starts_on", "is_active",
    "reminder_id", "remind_at",
  ],
};

function hasTaskUpdate(a: JarvisAction) {
  return !!(
    a.priority || a.status || a.deadline || a.assignee_id || a.project_id || a.title || a.description || a.expected_result ||
    a.waiting_for || a.risk_reason || a.clear_description || a.clear_project || a.clear_waiting_for || a.clear_risk_reason
  );
}

function cleanActions(
  ctx: AgentContext,
  actions: JarvisAction[],
  recurringIds: Set<string>,
  requestIds: Set<string>,
  reminderIds: Set<string>,
) {
  const visible = new Set(ctx.visibleTasks.map(t => t.id));
  const assignable = new Set(ctx.assignable.map(p => p.id));
  const projects = new Set(ctx.projects.map(p => p.id));
  return actions.slice(0, 20).filter(a => {
    if (["create_project", "update_project", "create_recurring_rule", "update_recurring_rule"].includes(a.type) && ctx.me.role !== "owner") return false;
    if (a.task_id && !visible.has(a.task_id)) return false;
    if (a.assignee_id && !assignable.has(a.assignee_id) && a.assignee_id !== ctx.me.id) return false;
    if (a.project_id && !projects.has(a.project_id)) return false;
    if (a.depends_on_task_id && !visible.has(a.depends_on_task_id)) return false;
    if (a.request_id && !requestIds.has(a.request_id)) return false;
    if (a.recurring_id && !recurringIds.has(a.recurring_id)) return false;
    if (a.reminder_id && !reminderIds.has(a.reminder_id)) return false;
    if (a.deadline && !Number.isFinite(new Date(a.deadline).getTime())) return false;
    if (a.remind_at && !Number.isFinite(new Date(a.remind_at).getTime())) return false;
    if (a.deadline && !a.reason?.trim()) return false;

    if (a.type === "create_task") return !!(a.assignee_id && a.title?.trim() && a.expected_result?.trim() && a.deadline);
    if (a.type === "update_task") return !!a.task_id && hasTaskUpdate(a);
    if (a.type === "add_comment") return !!(a.task_id && a.body?.trim());
    if (["add_dependency", "remove_dependency"].includes(a.type)) return !!(a.task_id && a.depends_on_task_id && a.task_id !== a.depends_on_task_id);
    if (a.type === "set_checklist_item") return !!(a.task_id && Number.isInteger(a.item_index) && a.label?.trim() && typeof a.done === "boolean");
    if (a.type === "resolve_deadline_request") return !!(a.request_id && a.decision);
    if (a.type === "create_project") return !!a.project_name?.trim();
    if (a.type === "update_project") return !!a.project_id;
    if (a.type === "create_recurring_rule") return !!(a.title?.trim() && a.expected_result?.trim() && a.assignee_id);
    if (a.type === "update_recurring_rule") return !!a.recurring_id;
    if (a.type === "create_reminder") return !!(a.body?.trim() && a.remind_at);
    if (a.type === "cancel_reminder") return !!a.reminder_id;
    return false;
  });
}

function compactHistoryRow(row: any, staff: Map<string, string>) {
  const oldValue = row.old_value || {};
  const newValue = row.new_value || {};
  const fields = ["status", "priority", "deadline", "assignee_id", "project_id", "title", "waiting_for", "risk_reason"];
  const changes: Record<string, unknown> = {};
  for (const field of fields) {
    if (oldValue?.[field] !== newValue?.[field]) {
      const before = field === "assignee_id" ? staff.get(oldValue?.[field]) || oldValue?.[field] : oldValue?.[field];
      const after = field === "assignee_id" ? staff.get(newValue?.[field]) || newValue?.[field] : newValue?.[field];
      changes[field] = { before, after };
    }
  }
  return {
    action: row.action,
    actor: staff.get(row.user_id) || "Система",
    at: row.created_at,
    changes,
  };
}

export async function runJarvisAgent(ctx: AgentContext, chatId: number, text: string): Promise<JarvisAgentResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const active = ctx.visibleTasks.filter(t => t.status !== "completed").slice(0, 180);
  const completed = ctx.visibleTasks
    .filter(t => t.status === "completed")
    .sort((a, b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime())
    .slice(0, 25);
  const selectedIds = [...active, ...completed].map(t => t.id);

  const [memory, depsRes, deadlineRes, recurringRes, detailsRes, checklistRes, commentsRes, historyRes, remindersRes] = await Promise.all([
    loadJarvisMemory(ctx as any, chatId, 20),
    ctx.admin.from("task_dependencies").select("task_id,depends_on_task_id").limit(3000),
    ctx.admin.from("deadline_requests").select("id,task_id,requested_by,old_deadline,requested_deadline,reason,status,created_at").eq("status", "pending").limit(200),
    ctx.me.role === "owner"
      ? ctx.admin.from("recurring_task_templates").select("id,title,expected_result,description,assignee_id,project_id,priority,frequency,month_pattern,due_kind,due_day,due_weekday,due_time,reminder_mode,reminder_day,reminder_days,starts_on,is_active").limit(200)
      : ctx.admin.from("recurring_task_templates").select("id,title,expected_result,description,assignee_id,project_id,priority,frequency,month_pattern,due_kind,due_day,due_weekday,due_time,reminder_mode,reminder_day,reminder_days,starts_on,is_active").eq("assignee_id", ctx.me.id).limit(100),
    selectedIds.length
      ? ctx.admin.from("tasks").select("id,title,description,expected_result,assignee_id,created_by,project_id,priority,status,deadline,completed_at,waiting_for,risk_reason,deadline_changes,updated_at").in("id", selectedIds)
      : Promise.resolve({ data: [], error: null } as any),
    selectedIds.length
      ? ctx.admin.from("task_checklist_items").select("task_id,item_index,label,done").in("task_id", selectedIds).limit(1200)
      : Promise.resolve({ data: [], error: null } as any),
    selectedIds.length
      ? ctx.admin.from("task_comments").select("task_id,author_id,body,created_at").in("task_id", selectedIds).order("created_at", { ascending: false }).limit(160)
      : Promise.resolve({ data: [], error: null } as any),
    selectedIds.length
      ? ctx.admin.from("task_history").select("task_id,user_id,action,old_value,new_value,created_at").in("task_id", selectedIds).order("created_at", { ascending: false }).limit(240)
      : Promise.resolve({ data: [], error: null } as any),
    ctx.admin.from("jarvis_reminders").select("id,task_id,body,remind_at,state,chat_id").eq("user_id", ctx.me.id).in("state", ["pending", "sending"]).order("remind_at").limit(100),
  ]);

  const taskDetails = detailsRes.error ? [] : detailsRes.data || [];
  const detailMap = new Map(taskDetails.map((t: any) => [t.id, t]));
  const deps = depsRes.error ? [] : depsRes.data || [];
  const depMap = new Map<string, string[]>();
  for (const d of deps as any[]) {
    const list = depMap.get(d.task_id) || [];
    list.push(d.depends_on_task_id);
    depMap.set(d.task_id, list);
  }
  const checklists = checklistRes.error ? [] : checklistRes.data || [];
  const checklistMap = new Map<string, any[]>();
  for (const c of checklists as any[]) {
    const list = checklistMap.get(c.task_id) || [];
    list.push(c);
    checklistMap.set(c.task_id, list);
  }
  const comments = commentsRes.error ? [] : commentsRes.data || [];
  const commentMap = new Map<string, any[]>();
  for (const c of comments as any[]) {
    const list = commentMap.get(c.task_id) || [];
    if (list.length < 4) list.push(c);
    commentMap.set(c.task_id, list);
  }
  const rawHistory = historyRes.error ? [] : historyRes.data || [];
  const historyMap = new Map<string, any[]>();
  const recurring = recurringRes.error ? [] : recurringRes.data || [];
  const pending = deadlineRes.error ? [] : deadlineRes.data || [];
  const reminders = remindersRes.error ? [] : remindersRes.data || [];
  const recurringIds = new Set((recurring as any[]).map(r => r.id));
  const requestIds = new Set((pending as any[]).map(r => r.id));
  const reminderIds = new Set((reminders as any[]).map(r => r.id));
  const staff = new Map(ctx.staff.map(p => [p.id, p.full_name]));
  const projects = new Map(ctx.projects.map(p => [p.id, p.name]));

  for (const h of rawHistory as any[]) {
    const list = historyMap.get(h.task_id) || [];
    if (list.length < 5) list.push(compactHistoryRow(h, staff));
    historyMap.set(h.task_id, list);
  }

  const taskPayload = [...active, ...completed].map(base => {
    const t: any = detailMap.get(base.id) || base;
    return {
      id: t.id,
      title: t.title,
      description: (t.description || "").slice(0, 700),
      expected_result: (t.expected_result || "").slice(0, 700),
      assignee_id: t.assignee_id,
      assignee: staff.get(t.assignee_id) || "Сотрудник",
      created_by: t.created_by,
      project_id: t.project_id,
      project: projects.get(t.project_id) || "Без проекта",
      priority: t.priority,
      status: t.status,
      deadline: t.deadline,
      completed_at: t.completed_at,
      waiting_for: t.waiting_for || null,
      risk_reason: t.risk_reason || null,
      deadline_changes: t.deadline_changes || 0,
      updated_at: t.updated_at || null,
      blocked_by: (depMap.get(t.id) || [])
        .map(id => {
          const x: any = detailMap.get(id);
          return x ? { id, title: x.title, status: x.status, deadline: x.deadline } : null;
        })
        .filter(Boolean),
      checklist: (checklistMap.get(t.id) || []).sort((a, b) => a.item_index - b.item_index),
      recent_comments: (commentMap.get(t.id) || []).map(c => ({
        author: staff.get(c.author_id) || "Сотрудник",
        body: String(c.body).slice(0, 500),
        created_at: c.created_at,
      })),
      recent_history: historyMap.get(t.id) || [],
    };
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["reply", "action"] },
      reply: { anyOf: [{ type: "string" }, { type: "null" }] },
      actions: { type: "array", items: operationSchema, maxItems: 20 },
    },
    required: ["mode", "reply", "actions"],
  };

  const permissions = ctx.me.role === "owner"
    ? "Ты можешь создавать и полноценно редактировать задачи, менять приоритет, исполнителя, проект, название, описание, ожидаемый результат, статус и дедлайн; добавлять комментарии, зависимости, менять чек-листы; согласовывать переносы; создавать и редактировать проекты и повторяющиеся правила; создавать личные напоминания. Жесткое удаление данных не делай."
    : ctx.me.role === "manager"
      ? "Ты можешь создавать и полноценно редактировать задачи только у разрешённых исполнителей, менять их приоритеты, сроки, статусы, комментарии, зависимости и чек-листы; создавать личные напоминания. Проекты и повторяющиеся правила не меняй."
      : "Ты можешь менять статус своих задач, добавлять комментарии, отмечать свой чек-лист, запрашивать перенос дедлайна и создавать личные напоминания. Не меняй приоритет, исполнителя, проект или содержание задачи без управленческих прав.";

  const system = `Ты Jarvis, рабочий AI-ассистент NU TEAM сети «Не Усложняй». С тобой говорят обычным русским языком. Понимай контекст, ссылки «эта задача», «её», «у него», «последняя», продолжения прошлой реплики и сразу используй доступные возможности. Не заставляй пользователя вспоминать синтаксис команд.\n\nСейчас ${new Date().toISOString()}, рабочая таймзона ${TZ} (UTC+5).\n\n${permissions}\n\nРежим reply: отвечай естественно, анализируй реальные данные команды, риски, нагрузку, историю изменений, комментарии, зависимости и сроки. Не выдумывай факты. Если можно сделать вывод из данных, делай его.\nРежим action: когда пользователь хочет изменить данные, верни одно или несколько действий. Связанные изменения объединяй в один пакет. Ничего не считай выполненным до подтверждения. Если реально неоднозначно, задай один точный вопрос.\n\nДоступные действия:\n- create_task: создать задачу; сам сформулируй короткое название и измеримый expected_result, если пользователь просит.\n- update_task: изменить priority, status, assignee_id, project_id, title, description, expected_result, waiting_for, risk_reason, deadline. Для deadline всегда укажи reason. clear_* только по явной просьбе очистить поле.\n- add_comment.\n- add_dependency/remove_dependency.\n- set_checklist_item.\n- resolve_deadline_request.\n- create_project/update_project для owner; деактивацию проекта делай через project_is_active=false, не удаление.\n- create_recurring_rule/update_recurring_rule для owner; отключение через is_active=false.\n- create_reminder: разовое напоминание. body = текст напоминания, remind_at = конкретный ISO момент, task_id можно связать с задачей.\n- cancel_reminder: отменить существующее активное напоминание по reminder_id.\n\nПравила статусов: исполнитель, сообщивший «готово/сделано», переводит свою задачу в review, а не completed. Завершение completed допустимо для руководителя после review. Если руководитель просит закрыть задачу, которая ещё не review, не скрывай правило: либо предложи сначала review, либо сформируй последовательные изменения только если смысл просьбы однозначно означает финальное закрытие.\n\nНикогда не выдумывай UUID. Используй только id из данных ниже. Не показывай UUID человеку. Если говорят «завтра», «в пятницу», «до вечера», верни конкретный ISO по Екатеринбургу. Если время задачи не названо, используй 23:59. Для напоминаний без времени спроси время, если из контекста оно неочевидно; для «утром» используй 09:00, «днём» 14:00, «вечером» 19:00. Для recurring due_weekday: 1=понедельник ... 7=воскресенье.\n\nПри массовой просьбе можно вернуть до 20 действий. Не молча обрезай запрос: если нужно больше 20 изменений, сначала ответь, что пакет слишком большой, и предложи логичное разбиение.\n\nПользователь: ${JSON.stringify(ctx.me)}\nРазрешённые исполнители: ${JSON.stringify(ctx.assignable.map(p => ({ id: p.id, name: p.full_name, role: p.role })))}\nКоманда: ${JSON.stringify(ctx.staff.map(p => ({ id: p.id, name: p.full_name, role: p.role })))}\nПроекты: ${JSON.stringify(ctx.projects.map(p => ({ id: p.id, name: p.name, is_active: p.is_active })))}\nЗадачи: ${JSON.stringify(taskPayload)}\nОжидающие запросы переноса: ${JSON.stringify(pending)}\nПовторяющиеся правила: ${JSON.stringify(recurring)}\nАктивные напоминания пользователя: ${JSON.stringify(reminders)}`;

  const input = [
    { role: "system", content: system },
    ...memory.slice(-20).map(m => ({ role: m.role, content: m.body.slice(0, 3500) })),
    { role: "user", content: text.slice(0, 8000) },
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
        reasoning: { effort: "low" },
        input,
        text: { format: { type: "json_schema", name: "jarvis_agent", strict: true, schema } },
        max_output_tokens: 4200,
        store: false,
      }),
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("Jarvis agent request failed", { status: response.status });
      return null;
    }
    const raw = responseText(await response.json());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JarvisAgentResult;
    if (parsed.mode === "reply") {
      return { mode: "reply", reply: (parsed.reply || "Не смог нормально сформулировать ответ.").trim().slice(0, 3900), actions: [] };
    }
    if ((parsed.actions || []).length > 20) {
      return { mode: "reply", reply: "Тут больше 20 изменений. Разобью это на несколько безопасных пакетов, но сначала уточни, с какой группы задач начать.", actions: [] };
    }
    const actions = cleanActions(ctx, parsed.actions || [], recurringIds, requestIds, reminderIds);
    if (!actions.length) {
      return { mode: "reply", reply: "Не хочу гадать и менять не ту запись. Уточни, какую именно задачу или объект нужно изменить.", actions: [] };
    }
    return { mode: "action", reply: null, actions };
  } catch (error) {
    console.error("Jarvis agent unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

function recurringSummary(a: JarvisAction) {
  const bits: string[] = [];
  if (a.frequency) bits.push(`частота: ${a.frequency}`);
  if (a.due_kind) bits.push(`срок: ${a.due_kind}`);
  if (a.due_day) bits.push(`день: ${a.due_day}`);
  if (a.due_weekday) bits.push(`день недели: ${a.due_weekday}`);
  if (a.due_time) bits.push(`время: ${a.due_time}`);
  if (a.priority) bits.push(`приоритет: ${RU_PRIORITY[a.priority]}`);
  if (a.is_active !== null) bits.push(a.is_active ? "включить" : "отключить");
  return bits.join(" · ");
}

export function renderActionProposal(ctx: AgentContext, actions: JarvisAction[]) {
  const blocks = actions.map((a, index) => {
    const n = actions.length > 1 ? `${index + 1}. ` : "";
    if (a.type === "create_task") {
      return `${n}Создать задачу «${a.title}»\nИсполнитель: ${staffName(ctx, a.assignee_id)}\nПроект: ${projectName(ctx, a.project_id)}\nДедлайн: ${fmtDate(a.deadline!)}\nПриоритет: ${RU_PRIORITY[a.priority || "normal"]}\nРезультат: ${a.expected_result}${a.description ? `\nОписание: ${a.description}` : ""}`;
    }
    if (a.type === "update_task") {
      const changes: string[] = [];
      if (a.priority) changes.push(`приоритет → ${RU_PRIORITY[a.priority]}`);
      if (a.status) changes.push(`статус → ${RU_STATUS[a.status]}`);
      if (a.deadline) changes.push(`дедлайн → ${fmtDate(a.deadline)}${a.reason ? ` · причина: ${a.reason}` : ""}`);
      if (a.assignee_id) changes.push(`исполнитель → ${staffName(ctx, a.assignee_id)}`);
      if (a.project_id) changes.push(`проект → ${projectName(ctx, a.project_id)}`);
      if (a.clear_project) changes.push("убрать проект");
      if (a.title) changes.push(`название → ${a.title}`);
      if (a.description) changes.push(`описание → ${a.description}`);
      if (a.clear_description) changes.push("очистить описание");
      if (a.expected_result) changes.push(`результат → ${a.expected_result}`);
      if (a.waiting_for) changes.push(`ожидание → ${a.waiting_for}`);
      if (a.clear_waiting_for) changes.push("очистить ожидание");
      if (a.risk_reason) changes.push(`риск → ${a.risk_reason}`);
      if (a.clear_risk_reason) changes.push("очистить причину риска");
      return `${n}Изменить «${taskName(ctx, a.task_id)}»\n${changes.map(x => `• ${x}`).join("\n") || "• обновить данные задачи"}`;
    }
    if (a.type === "add_comment") return `${n}Добавить комментарий к «${taskName(ctx, a.task_id)}»\n${a.body}`;
    if (a.type === "add_dependency") return `${n}Заблокировать «${taskName(ctx, a.task_id)}» задачей «${taskName(ctx, a.depends_on_task_id)}»`;
    if (a.type === "remove_dependency") return `${n}Убрать зависимость «${taskName(ctx, a.task_id)}» от «${taskName(ctx, a.depends_on_task_id)}»`;
    if (a.type === "set_checklist_item") return `${n}${a.done ? "Отметить выполненным" : "Вернуть в работу"} пункт «${a.label}» в задаче «${taskName(ctx, a.task_id)}»`;
    if (a.type === "resolve_deadline_request") return `${n}${a.decision === "approved" ? "Согласовать" : "Отклонить"} запрос переноса срока`;
    if (a.type === "create_project") return `${n}Создать проект «${a.project_name}»${a.project_description ? `\nОписание: ${a.project_description}` : ""}`;
    if (a.type === "update_project") {
      const changes: string[] = [];
      if (a.project_name) changes.push(`название → ${a.project_name}`);
      if (a.project_description) changes.push(`описание → ${a.project_description}`);
      if (a.clear_description) changes.push("очистить описание");
      if (a.project_is_active !== null) changes.push(a.project_is_active ? "активировать" : "деактивировать");
      return `${n}Изменить проект «${projectName(ctx, a.project_id)}»${changes.length ? `\n${changes.map(x => `• ${x}`).join("\n")}` : ""}`;
    }
    if (a.type === "create_recurring_rule") return `${n}Создать повторяющуюся задачу «${a.title}» для ${staffName(ctx, a.assignee_id)}\n${recurringSummary(a)}\nРезультат: ${a.expected_result}`;
    if (a.type === "update_recurring_rule") return `${n}Изменить повторяющееся правило${recurringSummary(a) ? `\n${recurringSummary(a)}` : ""}`;
    if (a.type === "create_reminder") return `${n}Напомнить ${fmtDate(a.remind_at!)}\n${a.body}${a.task_id ? `\nЗадача: ${taskName(ctx, a.task_id)}` : ""}`;
    if (a.type === "cancel_reminder") return `${n}Отменить напоминание`;
    return `${n}Выполнить действие`;
  });
  return [actions.length > 1 ? `Подтвердить пакет из ${actions.length} действий?` : "Подтвердить действие?", "", ...blocks].join("\n\n");
}

export function renderActionResult(ctx: AgentContext, actions: JarvisAction[]) {
  if (actions.length === 1) {
    const a = actions[0];
    if (a.type === "create_task") return `Задача создана: ${a.title}`;
    if (a.type === "update_task") return `Готово. Задача «${taskName(ctx, a.task_id)}» обновлена.`;
    if (a.type === "add_comment") return `Комментарий добавлен к задаче «${taskName(ctx, a.task_id)}».`;
    if (a.type === "add_dependency" || a.type === "remove_dependency") return `Готово. Зависимости задачи «${taskName(ctx, a.task_id)}» обновлены.`;
    if (a.type === "set_checklist_item") return `Готово. Чек-лист задачи «${taskName(ctx, a.task_id)}» обновлён.`;
    if (a.type === "resolve_deadline_request") return a.decision === "approved" ? "Перенос срока согласован." : "Перенос срока отклонён.";
    if (a.type === "create_project") return `Проект создан: ${a.project_name}`;
    if (a.type === "update_project") return "Проект обновлён.";
    if (a.type === "create_recurring_rule") return `Повторяющееся правило создано: ${a.title}`;
    if (a.type === "update_recurring_rule") return "Повторяющееся правило обновлено.";
    if (a.type === "create_reminder") return `Напоминание создано на ${fmtDate(a.remind_at!)}.`;
    if (a.type === "cancel_reminder") return "Напоминание отменено.";
  }
  return `Готово. Выполнено действий: ${actions.length}.`;
}
