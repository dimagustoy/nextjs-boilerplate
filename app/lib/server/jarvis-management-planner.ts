import { loadJarvisMemory } from "./jarvis-brain";

const TZ = "Asia/Yekaterinburg";
type Priority = "low" | "normal" | "high" | "critical";

type CompactAction = {
  type: "update_task" | "add_comment" | "create_reminder" | "cancel_reminder";
  task_id: string | null;
  priority: Priority | null;
  deadline: string | null;
  reason: string | null;
  body: string | null;
  remind_at: string | null;
  reminder_id: string | null;
};

type PlannerResult = {
  mode: "reply" | "action";
  reply: string | null;
  actions: Record<string, unknown>[];
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

function norm(value: string) {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function isBroadManagementRequest(text: string) {
  const q = norm(text);
  return (
    (/проанализ|разбери|оцени|приорит|критич|просроч|неуспева|хвост|нагруз/.test(q) && /задач|управля|сотруд|команд/.test(q)) ||
    /все задачи|всю просроч|все хвост/.test(q) ||
    /из предложенн|оставь только|не трогай/.test(q)
  );
}

export function isReminderRequest(text: string) {
  return /\bнапомни\b|\bнапоминан|\bотмени напомин/i.test(text);
}

function score(task: any, now: number, blocked: boolean) {
  const due = Date.parse(task.deadline);
  const hours = Number.isFinite(due) ? (due - now) / 3_600_000 : 99999;
  let value = task.priority === "critical" ? 45 : task.priority === "high" ? 24 : task.priority === "normal" ? 8 : 0;
  if (task.status === "at_risk") value += 45;
  if (task.status === "waiting") value += 24;
  if (blocked) value += 22;
  if (hours < 0) value += 65 + Math.min(60, Math.abs(hours) / 24 * 3);
  else if (hours <= 24) value += 35;
  else if (hours <= 72) value += 20;
  const staleDays = Number.isFinite(Date.parse(task.updated_at)) ? Math.floor((now - Date.parse(task.updated_at)) / 86_400_000) : 0;
  if (staleDays >= 5) value += Math.min(20, staleDays);
  return Math.round(value);
}

function blankCore(type: "update_task" | "add_comment") {
  return {
    type,
    task_id: null,
    expected_updated_at: null,
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
    member_id: null,
    member_role: null,
    member_is_active: null,
    email: null,
    full_name: null,
  } as Record<string, unknown>;
}

function mergeTaskUpdates(actions: Record<string, unknown>[]) {
  const result: Record<string, unknown>[] = [];
  const seen = new Map<string, Record<string, unknown>>();
  for (const action of actions) {
    if (action.type !== "update_task" || typeof action.task_id !== "string") {
      result.push(action);
      continue;
    }
    const existing = seen.get(action.task_id);
    if (!existing) {
      seen.set(action.task_id, action);
      result.push(action);
      continue;
    }
    if (action.priority) existing.priority = action.priority;
    if (action.deadline) existing.deadline = action.deadline;
    if (action.reason) existing.reason = action.reason;
  }
  return result.slice(0, 20);
}

function staffTargets(ctx: any, text: string) {
  const q = norm(text);
  const active = (ctx.staff || []).filter((person: any) => person.is_active !== false);
  const named = active.filter((person: any) => {
    const full = norm(person.full_name || "");
    const first = full.split(" ")[0];
    return full && (q.includes(full) || (first.length >= 3 && q.split(" ").includes(first)));
  });
  if (named.length) return named.map((person: any) => person.id);
  if (/управляющ/.test(q)) return active.filter((person: any) => person.role === "manager").map((person: any) => person.id);
  return [];
}

export async function runManagementPlanner(ctx: any, chatId: number, text: string, replyContext?: string | null): Promise<PlannerResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const reminderOnly = isReminderRequest(text) && !isBroadManagementRequest(text);
  const targetIds = staffTargets(ctx, text);
  const visibleActive = (ctx.visibleTasks || []).filter((task: any) => task.status !== "completed");
  const baseTasks = targetIds.length ? visibleActive.filter((task: any) => targetIds.includes(task.assignee_id)) : visibleActive;
  const candidateIds = baseTasks.slice(0, 180).map((task: any) => task.id);

  const [detailsRes, depsRes, recurringRes, remindersRes, memory] = await Promise.all([
    candidateIds.length
      ? ctx.admin.from("tasks").select("id,title,description,expected_result,assignee_id,project_id,priority,status,deadline,waiting_for,risk_reason,deadline_changes,updated_at").in("id", candidateIds)
      : Promise.resolve({ data: [], error: null }),
    candidateIds.length
      ? ctx.admin.from("task_dependencies").select("task_id,depends_on_task_id").in("task_id", candidateIds).limit(1000)
      : Promise.resolve({ data: [], error: null }),
    ctx.admin.from("recurring_task_templates").select("id,title,assignee_id,frequency,is_active").eq("is_active", true).limit(300),
    ctx.admin.from("jarvis_reminders").select("id,task_id,body,remind_at,state").eq("user_id", ctx.me.id).in("state", ["pending", "sending"]).order("remind_at").limit(50),
    loadJarvisMemory(ctx as any, chatId, 8),
  ]);

  if (detailsRes.error || depsRes.error) {
    console.error("Jarvis management context failed", { tasks: detailsRes.error?.code || null, deps: depsRes.error?.code || null });
    return null;
  }

  const staff = new Map((ctx.staff || []).map((person: any) => [person.id, person.full_name]));
  const projects = new Map((ctx.projects || []).map((project: any) => [project.id, project.name]));
  const blocked = new Set((depsRes.data || []).map((dep: any) => dep.task_id));
  const now = Date.now();
  const tasks = (detailsRes.data || [])
    .map((task: any) => ({
      id: task.id,
      title: task.title,
      assignee_id: task.assignee_id,
      assignee: staff.get(task.assignee_id) || "Сотрудник",
      project_id: task.project_id,
      project: projects.get(task.project_id) || "Без проекта",
      priority: task.priority,
      status: task.status,
      deadline: task.deadline,
      waiting_for: task.waiting_for,
      risk_reason: task.risk_reason,
      deadline_changes: task.deadline_changes || 0,
      updated_at: task.updated_at,
      blocked: blocked.has(task.id),
      overdue_days: Math.max(0, Math.floor((now - Date.parse(task.deadline)) / 86_400_000)),
      risk_score: score(task, now, blocked.has(task.id)),
      expected_result: String(task.expected_result || "").slice(0, 260),
      description: String(task.description || "").slice(0, 180),
    }))
    .sort((a: any, b: any) => b.risk_score - a.risk_score || Date.parse(a.deadline) - Date.parse(b.deadline))
    .slice(0, reminderOnly ? 25 : 90);

  const operationSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      type: { type: "string", enum: ["update_task", "add_comment", "create_reminder", "cancel_reminder"] },
      task_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      priority: { anyOf: [{ type: "string", enum: ["low", "normal", "high", "critical"] }, { type: "null" }] },
      deadline: { anyOf: [{ type: "string" }, { type: "null" }] },
      reason: { anyOf: [{ type: "string" }, { type: "null" }] },
      body: { anyOf: [{ type: "string" }, { type: "null" }] },
      remind_at: { anyOf: [{ type: "string" }, { type: "null" }] },
      reminder_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["type", "task_id", "priority", "deadline", "reason", "body", "remind_at", "reminder_id"],
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["reply", "action"] },
      reply: { anyOf: [{ type: "string" }, { type: "null" }] },
      actions: { type: "array", maxItems: 20, items: operationSchema },
    },
    required: ["mode", "reply", "actions"],
  };

  const system = `Ты Jarvis, операционный AI NU TEAM. Сейчас ${new Date().toISOString()}, рабочая таймзона ${TZ} (UTC+5).\n\nЭто компактный режим для сложных управленческих запросов и личных напоминаний. Не пиши Markdown-звёздочки.\n\nЕсли пользователь просит анализ без изменений, mode=reply и дай конкретный вывод по данным. Если просит изменить данные, mode=action. Все изменения позже будут показаны человеку на подтверждение.\n\nДоступные действия здесь:\n- update_task: можно менять только priority и/или deadline. Если меняешь deadline, reason обязателен. Объединяй priority+deadline одной задачи в один update_task.\n- add_comment: body = конкретный запрос/комментарий к задаче.\n- create_reminder: личное напоминание пользователю; body и remind_at обязательны, task_id можно оставить null.\n- cancel_reminder: reminder_id обязателен.\n\nРаботай как сильный операционный руководитель, а не как генератор активности. Не переноси всё подряд. Перенос оправдан в первую очередь для уже просроченных, at_risk, waiting или явно заблокированных задач. Не переноси нормальную будущую задачу только ради красивого плана. Важнейшим задачам ставь high, critical только при реально критичной ситуации. Комментарий с требованием отчёта добавляй только там, где руководителю действительно нужен статус/причина/следующий шаг.\n\nЕсли пользователь сам не дал новый срок, для просрочки назначай реалистично: критичное примерно 1 день, высокое 2–3 дня, обычное до 7 дней. Время без указания = 23:59 Екатеринбург. Для «завтра в 12» используй 12:00 Екатеринбург.\n\nМаксимум 20 действий. Выбери самые важные, а не обрезай случайно. Никогда не выдумывай id.\n\nПользователь: ${JSON.stringify({ id: ctx.me.id, name: ctx.me.full_name, role: ctx.me.role })}\nКоманда: ${JSON.stringify((ctx.staff || []).map((p: any) => ({ id: p.id, name: p.full_name, role: p.role })))}\nЗадачи-кандидаты, отсортированы по риск-скору: ${JSON.stringify(tasks)}\nАктивные повторяющиеся правила: ${JSON.stringify(recurringRes.error ? [] : recurringRes.data || [])}\nАктивные личные напоминания: ${JSON.stringify(remindersRes.error ? [] : remindersRes.data || [])}${replyContext ? `\nКонтекст сообщения, на которое отвечает пользователь: ${JSON.stringify(replyContext.slice(0, 1600))}` : ""}`;

  const input = [
    { role: "system", content: system },
    ...memory.slice(-6).map((m: any) => ({ role: m.role, content: String(m.body || "").slice(0, 1600) })),
    { role: "user", content: text.slice(0, 5000) },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 32_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_COMPLEX_MODEL || process.env.OPENAI_MODEL || "gpt-6-luna",
        reasoning: { effort: "low" },
        input,
        text: { format: { type: "json_schema", name: "jarvis_management_plan", strict: true, schema } },
        max_output_tokens: 5200,
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
    const parsed = JSON.parse(raw) as { mode: "reply" | "action"; reply: string | null; actions: CompactAction[] };
    if (parsed.mode === "reply") {
      return { mode: "reply", reply: (parsed.reply || "Не смог сформулировать вывод.").replace(/\*\*/g, "").trim().slice(0, 3900), actions: [] };
    }

    const taskMap = new Map((detailsRes.data || []).map((task: any) => [task.id, task]));
    const reminderIds = new Set((remindersRes.error ? [] : remindersRes.data || []).map((r: any) => r.id));
    const actions: Record<string, unknown>[] = [];

    for (const item of (parsed.actions || []).slice(0, 20)) {
      if (item.type === "update_task") {
        const task: any = item.task_id ? taskMap.get(item.task_id) : null;
        if (!task) continue;
        const deadline = item.deadline && Number.isFinite(Date.parse(item.deadline)) && Date.parse(item.deadline) > Date.now() ? item.deadline : null;
        if (deadline && !item.reason?.trim()) continue;
        if (!item.priority && !deadline) continue;
        const action = blankCore("update_task");
        action.task_id = task.id;
        action.expected_updated_at = task.updated_at || null;
        action.priority = item.priority || null;
        action.deadline = deadline;
        action.reason = deadline ? item.reason!.trim().slice(0, 500) : null;
        actions.push(action);
      } else if (item.type === "add_comment") {
        const task: any = item.task_id ? taskMap.get(item.task_id) : null;
        if (!task || !item.body?.trim()) continue;
        const action = blankCore("add_comment");
        action.task_id = task.id;
        action.body = item.body.trim().slice(0, 1200);
        actions.push(action);
      } else if (item.type === "create_reminder") {
        if (!item.body?.trim() || !item.remind_at || !Number.isFinite(Date.parse(item.remind_at)) || Date.parse(item.remind_at) <= Date.now()) continue;
        actions.push({
          type: "create_reminder",
          task_id: item.task_id && taskMap.has(item.task_id) ? item.task_id : null,
          body: item.body.trim().slice(0, 1200),
          remind_at: item.remind_at,
        });
      } else if (item.type === "cancel_reminder") {
        if (!item.reminder_id || !reminderIds.has(item.reminder_id)) continue;
        actions.push({ type: "cancel_reminder", reminder_id: item.reminder_id });
      }
    }

    const merged = mergeTaskUpdates(actions);
    if (!merged.length) {
      return { mode: "reply", reply: "Я разобрал запрос, но не нашёл изменений, которые можно безопасно подготовить без гадания. Данные не менял.", actions: [] };
    }
    return { mode: "action", reply: null, actions: merged };
  } catch (error) {
    console.error("Jarvis management planner unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
