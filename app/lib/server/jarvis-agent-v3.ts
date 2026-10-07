import {
  renderActionProposal,
  renderActionResult,
  runJarvisAgent as runStandardAgent,
  type AgentContext,
  type JarvisAction,
  type JarvisAgentResult,
} from "./jarvis-agent";
import { loadJarvisMemory } from "./jarvis-brain";

export { renderActionProposal, renderActionResult };
export type { JarvisAction };

const TZ = "Asia/Yekaterinburg";
type Priority = "low" | "normal" | "high" | "critical";

type CompactAction = {
  type: "update_task" | "add_comment" | "create_reminder";
  task_id: string | null;
  priority: Priority | null;
  deadline: string | null;
  reason: string | null;
  body: string | null;
  remind_at: string | null;
};

type CompactResult = {
  mode: "reply" | "action";
  reply: string | null;
  actions: CompactAction[];
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

function isBroadManagementRequest(text: string) {
  const q = text.toLowerCase();
  return (
    (/проанализ|разбери|оцени|приоритиз|критич|просроч|неуспева|хвост|нагруз/.test(q) && /задач|управля|сотруд|команд/.test(q)) ||
    /все задачи|всю просроч|все хвост/.test(q) ||
    /из предложенн|оставь только|не трогай/.test(q)
  );
}

function blankAction(type: JarvisAction["type"]): JarvisAction {
  return {
    type,
    task_id: null,
    assignee_id: null,
    project_id: null,
    title: null,
    description: null,
    expected_result: null,
    priority: null,
    status: null,
    deadline: null,
    reason: null,
    body: null,
    depends_on_task_id: null,
    item_index: null,
    label: null,
    done: null,
    request_id: null,
    decision: null,
    clear_description: null,
    clear_project: null,
    waiting_for: null,
    risk_reason: null,
    clear_waiting_for: null,
    clear_risk_reason: null,
    project_name: null,
    project_description: null,
    project_is_active: null,
    recurring_id: null,
    frequency: null,
    month_pattern: null,
    due_kind: null,
    due_day: null,
    due_weekday: null,
    due_time: null,
    reminder_mode: null,
    reminder_day: null,
    reminder_days: null,
    starts_on: null,
    is_active: null,
    reminder_id: null,
    remind_at: null,
  };
}

function priorityWeight(priority: string) {
  if (priority === "critical") return 50;
  if (priority === "high") return 25;
  if (priority === "normal") return 8;
  return 0;
}

function taskScore(task: any, now: number) {
  const due = new Date(task.deadline).getTime();
  const hours = Number.isFinite(due) ? (due - now) / 3_600_000 : 99999;
  let score = priorityWeight(task.priority);
  if (task.status === "at_risk") score += 45;
  if (task.status === "waiting") score += 20;
  if (hours < 0) score += 60 + Math.min(60, Math.abs(hours) / 24 * 3);
  else if (hours <= 24) score += 35;
  else if (hours <= 72) score += 20;
  return Math.round(score);
}

function mergeUpdates(actions: JarvisAction[]) {
  const out: JarvisAction[] = [];
  const byTask = new Map<string, JarvisAction>();
  for (const action of actions) {
    if (action.type !== "update_task" || !action.task_id) {
      out.push(action);
      continue;
    }
    const existing = byTask.get(action.task_id);
    if (!existing) {
      byTask.set(action.task_id, action);
      out.push(action);
      continue;
    }
    if (action.priority) existing.priority = action.priority;
    if (action.deadline) existing.deadline = action.deadline;
    if (action.reason) existing.reason = action.reason;
  }
  return out.slice(0, 20);
}

async function runManagementPlanner(ctx: AgentContext, chatId: number, text: string): Promise<JarvisAgentResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const now = Date.now();
  const staff = new Map(ctx.staff.map(p => [p.id, p.full_name]));
  const projects = new Map(ctx.projects.map(p => [p.id, p.name]));
  const active = ctx.visibleTasks
    .filter(t => t.status !== "completed")
    .map(t => ({
      id: t.id,
      title: t.title,
      assignee_id: t.assignee_id,
      assignee: staff.get(t.assignee_id) || "Сотрудник",
      project_id: t.project_id,
      project: projects.get(t.project_id || "") || "Без проекта",
      priority: t.priority,
      status: t.status,
      deadline: t.deadline,
      expected_result: String(t.expected_result || "").slice(0, 260),
      description: String(t.description || "").slice(0, 220),
      risk_score: taskScore(t, now),
      overdue_days: Math.max(0, Math.floor((now - new Date(t.deadline).getTime()) / 86_400_000)),
    }))
    .sort((a, b) => b.risk_score - a.risk_score)
    .slice(0, 180);

  const [memory, recurringRes] = await Promise.all([
    loadJarvisMemory(ctx as any, chatId, 10),
    ctx.me.role === "owner"
      ? ctx.admin.from("recurring_task_templates").select("title,assignee_id,is_active,frequency").eq("is_active", true).limit(200)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  const recurring = recurringRes.error ? [] : recurringRes.data || [];

  const operationSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", enum: ["update_task", "add_comment", "create_reminder"] },
      task_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      priority: { anyOf: [{ type: "string", enum: ["low", "normal", "high", "critical"] }, { type: "null" }] },
      deadline: { anyOf: [{ type: "string" }, { type: "null" }] },
      reason: { anyOf: [{ type: "string" }, { type: "null" }] },
      body: { anyOf: [{ type: "string" }, { type: "null" }] },
      remind_at: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["type", "task_id", "priority", "deadline", "reason", "body", "remind_at"],
  };
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

  const system = `Ты Jarvis, операционный AI NU TEAM. Сейчас ${new Date().toISOString()}, рабочая таймзона ${TZ} (UTC+5).\n\nЭто режим комплексного анализа задач. Работай как сильный операционный руководитель: сначала оцени срочность по сроку, статусу, приоритету и масштабу просрочки; не переноси всё подряд и не создавай искусственную активность. Выбирай только те изменения, которые реально полезны.\n\nПользователь может просить одновременно: выделить критичные задачи, поднять приоритет, разумно перенести просроченные сроки, добавить комментарии там, где нужен отчёт, и поставить личное напоминание. Для одного task_id объединяй priority и deadline в ОДИН update_task. Комментарий остаётся отдельным add_comment. create_reminder используй с task_id=null, если напоминание относится ко всему плану.\n\nЕсли срок меняется, reason обязателен. Если пользователь не дал точный новый срок, назначай реалистичный срок по срочности: критичное 1 день, высокое 2-3 дня, обычное до 7 дней. Не переноси задачу, если по данным нет оснований считать срок нереалистичным. Если пользователь просит не трогать повторяющиеся задачи, сопоставь их по названию/исполнителю со списком recurring и исключи.\n\nНикогда не выдумывай task_id. Используй только id из списка. Максимум 20 действий. Если полезных действий больше, выбери самые критичные и в reply режима reply объясни, как разбить остальное. Все изменения позже потребуют подтверждения пользователя.\n\nПользователь: ${JSON.stringify({ id: ctx.me.id, name: ctx.me.full_name, role: ctx.me.role })}\nКоманда: ${JSON.stringify(ctx.staff.map(p => ({ id: p.id, name: p.full_name, role: p.role })))}\nАктивные повторяющиеся правила: ${JSON.stringify(recurring)}\nАктивные задачи, уже отсортированные примерно по риску: ${JSON.stringify(active)}`;

  const input = [
    { role: "system", content: system },
    ...memory.slice(-8).map(m => ({ role: m.role, content: m.body.slice(0, 1800) })),
    { role: "user", content: text.slice(0, 5000) },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_COMPLEX_MODEL || "gpt-6.1-sol",
        reasoning: { effort: "low" },
        input,
        text: { format: { type: "json_schema", name: "jarvis_management_plan", strict: true, schema } },
        max_output_tokens: 6000,
        truncation: "auto",
        store: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("Jarvis management planner failed", { status: response.status });
      return null;
    }
    const data = await response.json();
    if (data?.status === "incomplete") {
      console.error("Jarvis management planner incomplete", { reason: data?.incomplete_details?.reason || "unknown" });
      return null;
    }
    const raw = responseText(data);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompactResult;
    if (parsed.mode === "reply") {
      return { mode: "reply", reply: (parsed.reply || "Не смог собрать безопасный план.").trim().slice(0, 3900), actions: [] };
    }

    const visible = new Set(ctx.visibleTasks.map(t => t.id));
    const actions: JarvisAction[] = [];
    for (const item of (parsed.actions || []).slice(0, 20)) {
      if (item.type === "update_task") {
        if (!item.task_id || !visible.has(item.task_id)) continue;
        const deadline = item.deadline && Number.isFinite(new Date(item.deadline).getTime()) ? item.deadline : null;
        if (deadline && !item.reason?.trim()) continue;
        if (!item.priority && !deadline) continue;
        actions.push({ ...blankAction("update_task"), task_id: item.task_id, priority: item.priority, deadline, reason: deadline ? item.reason?.trim() || null : null });
      } else if (item.type === "add_comment") {
        if (!item.task_id || !visible.has(item.task_id) || !item.body?.trim()) continue;
        actions.push({ ...blankAction("add_comment"), task_id: item.task_id, body: item.body.trim().slice(0, 1200) });
      } else if (item.type === "create_reminder") {
        if (!item.body?.trim() || !item.remind_at || !Number.isFinite(new Date(item.remind_at).getTime())) continue;
        if (new Date(item.remind_at).getTime() <= Date.now()) continue;
        actions.push({ ...blankAction("create_reminder"), task_id: item.task_id && visible.has(item.task_id) ? item.task_id : null, body: item.body.trim().slice(0, 1200), remind_at: item.remind_at });
      }
    }
    const merged = mergeUpdates(actions);
    if (!merged.length) {
      return { mode: "reply", reply: "Я разобрал задачи, но не нашёл изменений, которые можно безопасно предложить без гадания. Дам рекомендации без автоматического редактирования.", actions: [] };
    }
    return { mode: "action", reply: null, actions: merged };
  } catch (error) {
    console.error("Jarvis management planner unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runJarvisAgent(ctx: AgentContext, chatId: number, text: string): Promise<JarvisAgentResult | null> {
  if ((ctx.me.role === "owner" || ctx.me.role === "manager") && isBroadManagementRequest(text)) {
    const planned = await runManagementPlanner(ctx, chatId, text);
    if (planned) return planned;
  }
  return runStandardAgent(ctx, chatId, text);
}
