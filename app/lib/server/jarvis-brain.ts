import type { SupabaseClient } from "@supabase/supabase-js";

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

type BrainContext = {
  admin: SupabaseClient;
  me: Profile;
  staff: Profile[];
  projects: Project[];
  visibleTasks: Task[];
};

type MemoryMessage = { role: "user" | "assistant"; body: string };
export type BrainResult = { mode: "reply" | "action"; reply: string | null; action_text: string | null };

const TZ = "Asia/Yekaterinburg";

function responseText(data: any): string | null {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  return null;
}

function isActionLike(text: string) {
  return /(постав|созда|поруч|назнач|добав|перенес|измени|помен|закрой|заверш|отмет|обнов|убер|удал|сформулиру|разбер|сделай задач)/i.test(text);
}

function sanitizeActionText(text: string) {
  return text
    .replace(/что\s+горит/gi, "критический список")
    .replace(/требует\s+внимания/gi, "нужно обработать")
    .replace(/просроч[а-яё]*/gi, "задачи с нарушенными сроками")
    .trim();
}

function safeFallback(text: string): BrainResult {
  if (isActionLike(text)) {
    return { mode: "action", reply: null, action_text: sanitizeActionText(text) };
  }
  return {
    mode: "reply",
    reply: "AI-мозг Jarvis временно не ответил. Данные NU TEAM я не менял. Повтори сообщение через несколько секунд.",
    action_text: null,
  };
}

export async function loadJarvisMemory(ctx: BrainContext, chatId: number, limit = 8): Promise<MemoryMessage[]> {
  const { data, error } = await ctx.admin
    .from("jarvis_chat_messages")
    .select("role,body,created_at,id")
    .eq("user_id", ctx.me.id)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 12)));
  if (error) {
    console.error("Jarvis memory read failed", { code: error.code });
    return [];
  }
  return (data || []).reverse().map(row => ({ role: row.role as "user" | "assistant", body: String(row.body) }));
}

export async function rememberJarvis(ctx: BrainContext, chatId: number, role: "user" | "assistant", body: string) {
  const clean = body.trim().slice(0, 12000);
  if (!clean) return;
  const { error } = await ctx.admin.from("jarvis_chat_messages").insert({
    user_id: ctx.me.id,
    chat_id: chatId,
    role,
    body: clean,
  });
  if (error) console.error("Jarvis memory write failed", { code: error.code });
}

export async function clearJarvisMemory(ctx: BrainContext, chatId: number) {
  const { error } = await ctx.admin.from("jarvis_chat_messages").delete().eq("user_id", ctx.me.id).eq("chat_id", chatId);
  if (error) throw error;
}

function taskPayload(ctx: BrainContext, dependencies: Array<{ task_id: string; depends_on_task_id: string }>) {
  const visibleIds = new Set(ctx.visibleTasks.map(t => t.id));
  const depMap = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!visibleIds.has(dep.task_id) || !visibleIds.has(dep.depends_on_task_id)) continue;
    const list = depMap.get(dep.task_id) || [];
    list.push(dep.depends_on_task_id);
    depMap.set(dep.task_id, list);
  }

  const name = (id: string) => ctx.staff.find(p => p.id === id)?.full_name || "Сотрудник";
  const project = (id: string | null) => ctx.projects.find(p => p.id === id)?.name || "Без проекта";
  const active = ctx.visibleTasks.filter(t => t.status !== "completed").slice(0, 100);
  const recentlyCompleted = ctx.visibleTasks
    .filter(t => t.status === "completed" && t.completed_at)
    .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
    .slice(0, 12);

  const mapTask = (t: Task) => ({
    id: t.id,
    title: t.title,
    description: (t.description || "").slice(0, 320),
    expected_result: t.expected_result.slice(0, 320),
    assignee_id: t.assignee_id,
    assignee: name(t.assignee_id),
    project_id: t.project_id,
    project: project(t.project_id),
    priority: t.priority,
    status: t.status,
    deadline: t.deadline,
    completed_at: t.completed_at,
    blocked_by: (depMap.get(t.id) || []).map(id => {
      const blocker = ctx.visibleTasks.find(x => x.id === id);
      return blocker ? { id: blocker.id, title: blocker.title, status: blocker.status, deadline: blocker.deadline } : null;
    }).filter(Boolean),
  });

  return { active: active.map(mapTask), recently_completed: recentlyCompleted.map(mapTask) };
}

export async function runJarvisBrain(ctx: BrainContext, chatId: number, text: string): Promise<BrainResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      mode: "reply",
      reply: "AI-мозг Jarvis не настроен: на сервере нет OPENAI_API_KEY.",
      action_text: null,
    };
  }

  const [history, depsResult, deadlineResult] = await Promise.all([
    loadJarvisMemory(ctx, chatId),
    ctx.admin.from("task_dependencies").select("task_id,depends_on_task_id").limit(2000),
    ctx.admin.from("deadline_requests").select("task_id,requested_by,requested_deadline,reason").eq("status", "pending").limit(100),
  ]);
  const dependencies = depsResult.error ? [] : (depsResult.data || []);
  const pendingDeadlines = deadlineResult.error ? [] : (deadlineResult.data || []);

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["reply", "action"] },
      reply: { anyOf: [{ type: "string" }, { type: "null" }] },
      action_text: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["mode", "reply", "action_text"],
  };

  const system = `Ты Jarvis, полноценный рабочий AI-ассистент сети «Не Усложняй». С тобой разговаривают обычным русским языком.

Сейчас ${new Date().toISOString()}. Рабочая таймзона: ${TZ} (UTC+5).

Твои задачи:
- отвечать на вопросы о задачах, проектах и команде только по фактическим данным ниже;
- анализировать приоритеты, загрузку, нарушенные сроки, блокеры и риски;
- помнить последние реплики и понимать продолжения вроде «а у Сергея?», «её на пятницу», «тогда оставь так»;
- нормально поддерживать рабочий разговор.

mode=reply используй для вопросов, анализа, обсуждения и уточнений. Ответ до 2500 символов.

mode=action используй только когда пользователь явно хочет изменить NU TEAM: создать задачу, поменять статус, перенести дедлайн или добавить комментарий. action_text должен быть самостоятельной однозначной командой для внутреннего диспетчера.

Для создания задачи action_text обязательно должен содержать:
1) точное имя исполнителя из списка;
2) конкретный дедлайн;
3) короткое нормальное название задачи;
4) строку «Результат: ...» с измеримым ожидаемым результатом.
Если пользователь просит «сам сформулируй», сформулируй название и результат сам по смыслу.

В mode=action не используй фразы «что горит», «требует внимания» и слова с корнем «просроч». Вместо этого используй выражение «задачи с нарушенными сроками».

Если действие неоднозначно, верни mode=reply и задай один конкретный уточняющий вопрос. Не выдумывай UUID, сотрудников, проекты, задачи или факты. Не показывай UUID пользователю. Не говори, что изменение уже выполнено: система отдельно запросит подтверждение.

Пользователь: ${JSON.stringify(ctx.me)}
Команда: ${JSON.stringify(ctx.staff.map(p => ({ id: p.id, name: p.full_name, role: p.role })))}
Проекты: ${JSON.stringify(ctx.projects.map(p => ({ id: p.id, name: p.name })))}
Задачи: ${JSON.stringify(taskPayload(ctx, dependencies))}
Ожидающие запросы переноса сроков: ${JSON.stringify(pendingDeadlines)}`;

  const input = [
    { role: "system", content: system },
    ...history.slice(-8).map(message => ({ role: message.role, content: message.body.slice(0, 2500) })),
    { role: "user", content: text },
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-luna",
        reasoning: { effort: "low" },
        input,
        text: { format: { type: "json_schema", name: "jarvis_brain", strict: true, schema } },
        max_output_tokens: 1400,
        store: false,
      }),
      signal: AbortSignal.timeout(35000),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Jarvis brain request failed", { status: response.status });
      return safeFallback(text);
    }

    const raw = responseText(await response.json());
    if (!raw) {
      console.error("Jarvis brain empty response");
      return safeFallback(text);
    }

    const parsed = JSON.parse(raw) as BrainResult;
    if (parsed.mode === "reply") {
      return {
        mode: "reply",
        reply: parsed.reply?.trim().slice(0, 3500) || "Не смог нормально сформулировать ответ. Попробуй ещё раз.",
        action_text: null,
      };
    }

    const actionText = parsed.action_text?.trim().slice(0, 4000);
    if (!actionText) return safeFallback(text);
    return { mode: "action", reply: null, action_text: sanitizeActionText(actionText) };
  } catch (error) {
    console.error("Jarvis brain unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return safeFallback(text);
  }
}
