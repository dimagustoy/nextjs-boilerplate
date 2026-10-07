import { POST as legacyPost } from "../webhook-v3-legacy/route";
import { sameSecret, telegram } from "../../../lib/server/telegram";
import { rememberJarvis } from "../../../lib/server/jarvis-brain";
import { loadJarvisContext } from "../../../lib/server/jarvis";
import { isBroadManagementRequest, isReminderRequest, runManagementPlanner } from "../../../lib/server/jarvis-management-planner";

export const runtime = "nodejs";
export const maxDuration = 60;

const TZ = "Asia/Yekaterinburg";
const PRIORITY: Record<string, string> = { low: "низкий", normal: "обычный", high: "высокий", critical: "критичный" };

type Ctx = NonNullable<Awaited<ReturnType<typeof loadJarvisContext>>>;

async function send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, ...extra });
}

async function sendRemembered(ctx: Ctx, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const result = await send(chatId, text, extra);
  await rememberJarvis(ctx as any, chatId, "assistant", text.slice(0, 12000));
  return result;
}

function fmtDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function taskTitle(ctx: Ctx, id: unknown) {
  return ctx.visibleTasks.find((task) => task.id === id)?.title || "задача";
}

function splitText(text: string, limit = 3800) {
  if (text.length <= limit) return [text];
  const blocks = text.split(/\n\n+/);
  const parts: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (block.length > limit) {
      if (current) { parts.push(current); current = ""; }
      for (let i = 0; i < block.length; i += limit) parts.push(block.slice(i, i + limit));
      continue;
    }
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > limit) { parts.push(current); current = block; }
    else current = next;
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}

function proposalText(ctx: Ctx, actions: any[]) {
  const blocks = actions.map((action, index) => {
    const n = actions.length > 1 ? `${index + 1}. ` : "";
    if (action.type === "update_task") {
      const changes: string[] = [];
      if (action.priority) changes.push(`приоритет → ${PRIORITY[action.priority] || action.priority}`);
      if (action.deadline) changes.push(`дедлайн → ${fmtDate(action.deadline)}${action.reason ? `\n   причина → ${action.reason}` : ""}`);
      return `${n}Изменить «${taskTitle(ctx, action.task_id)}»\n${changes.map((x) => `• ${x}`).join("\n")}`;
    }
    if (action.type === "add_comment") {
      return `${n}Добавить комментарий к «${taskTitle(ctx, action.task_id)}»\n${action.body}`;
    }
    if (action.type === "create_reminder") {
      return `${n}Создать личное напоминание\n• когда → ${fmtDate(action.remind_at)}\n• текст → ${action.body}${action.task_id ? `\n• задача → ${taskTitle(ctx, action.task_id)}` : ""}`;
    }
    if (action.type === "cancel_reminder") return `${n}Отменить личное напоминание`;
    return `${n}Выполнить действие`;
  });
  return [actions.length > 1 ? `Подтвердить управленческий пакет из ${actions.length} действий?` : "Подтвердить действие?", "", ...blocks].join("\n\n");
}

async function sendProposal(ctx: Ctx, chatId: number, text: string, bundleId: string) {
  const parts = splitText(text);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await send(chatId, parts[i], last ? {
      reply_markup: { inline_keyboard: [[
        { text: "✅ Подтвердить", callback_data: `j4:ok:${bundleId}` },
        { text: "❌ Отмена", callback_data: `j4:no:${bundleId}` },
      ]] },
    } : {});
  }
  await rememberJarvis(ctx as any, chatId, "assistant", text.slice(0, 12000));
}

async function staleTasks(ctx: Ctx, actions: any[]) {
  const expected = new Map<string, number>();
  for (const action of actions) {
    if (action.type === "update_task" && action.task_id && action.expected_updated_at) {
      expected.set(action.task_id, Date.parse(action.expected_updated_at));
    }
  }
  if (!expected.size) return [] as string[];
  const ids = [...expected.keys()];
  const result = await ctx.admin.from("tasks").select("id,updated_at").in("id", ids);
  if (result.error) throw result.error;
  const stale: string[] = [];
  for (const row of result.data || []) {
    const before = expected.get(row.id);
    const current = Date.parse(row.updated_at);
    if (!Number.isFinite(before) || !Number.isFinite(current) || before !== current) stale.push(row.id);
  }
  for (const id of ids) if (!(result.data || []).some((row: any) => row.id === id)) stale.push(id);
  return stale;
}

async function handleCallback(update: any) {
  const callback = update?.callback_query;
  const match = typeof callback?.data === "string" ? callback.data.match(/^j4:(ok|no):([0-9a-f-]{36})$/i) : null;
  if (!match) return null;
  const chatId = callback?.message?.chat?.id;
  const actorId = callback?.from?.id;
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(actorId) || actorId <= 0) return Response.json({ ok: true });
  const ctx = await loadJarvisContext(actorId);
  if (!ctx) {
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Telegram не привязан к NU TEAM" });
    return Response.json({ ok: true });
  }

  if (match[1] === "no") {
    const cancelled = await ctx.admin.rpc("nu_jarvis_cancel_action_bundle", { p_id: match[2], p_actor: ctx.me.id, p_chat: chatId });
    const ok = !cancelled.error && cancelled.data === true;
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: ok ? "Отменено" : "Подтверждение уже неактуально" });
    if (ok) {
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      await sendRemembered(ctx, chatId, "Отменил. Ничего не изменено.");
    }
    return Response.json({ ok: true });
  }

  const claim = await ctx.admin.rpc("nu_jarvis_claim_action_bundle", { p_id: match[2], p_actor: ctx.me.id, p_chat: chatId });
  if (claim.error || !claim.data) {
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Действие уже выполнено, отменено или устарело" });
    return Response.json({ ok: true });
  }
  const actions = claim.data as any[];

  try {
    const stale = await staleTasks(ctx, actions);
    if (stale.length) {
      await ctx.admin.rpc("nu_jarvis_finish_action_bundle", { p_id: match[2], p_actor: ctx.me.id, p_chat: chatId, p_success: false, p_result: null, p_error: "Task changed since proposal" });
      await ctx.admin.rpc("nu_jarvis_cancel_action_bundle", { p_id: match[2], p_actor: ctx.me.id, p_chat: chatId });
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Задачи уже изменились" });
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      await sendRemembered(ctx, chatId, "Часть задач изменилась после подготовки пакета. Ничего не перезаписал. Повтори просьбу, я соберу свежий план.");
      return Response.json({ ok: true });
    }

    const applied = await ctx.admin.rpc("nu_jarvis_apply_action_bundle_v2", { p_actor: ctx.me.id, p_chat: chatId, p_actions: actions });
    if (applied.error) throw applied.error;
    await ctx.admin.rpc("nu_jarvis_finish_action_bundle", { p_id: match[2], p_actor: ctx.me.id, p_chat: chatId, p_success: true, p_result: applied.data, p_error: null });
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Готово" });
    await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
    const count = Number(applied.data?.count || actions.length);
    await sendRemembered(ctx, chatId, `Готово. Применено действий: ${count}.`);
    return Response.json({ ok: true });
  } catch (error: any) {
    const message = String(error?.message || "failed");
    console.error("Jarvis management bundle failed", { code: error?.code || null, message: message.slice(0, 200) });
    await ctx.admin.rpc("nu_jarvis_finish_action_bundle", { p_id: match[2], p_actor: ctx.me.id, p_chat: chatId, p_success: false, p_result: null, p_error: message });
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Не применилось" });
    await sendRemembered(ctx, chatId, "Не смог применить пакет. Ничего не изменено; подтверждение сохранено для повторной попытки.");
    return Response.json({ ok: true });
  }
}

export async function POST(request: Request) {
  const legacyRequest = request.clone();
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let update: any;
  try { update = await request.json(); }
  catch { return legacyPost(legacyRequest); }

  if (update?.callback_query) {
    const handled = await handleCallback(update);
    return handled || legacyPost(legacyRequest);
  }

  const message = update?.message;
  if (!message || message.from?.is_bot || message.chat?.type !== "private") return legacyPost(legacyRequest);
  const chatId = message.chat.id;
  const actorId = message.from?.id;
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(actorId) || actorId <= 0 || chatId !== actorId) return legacyPost(legacyRequest);
  const text = typeof message.text === "string" ? message.text.trim() : typeof message.caption === "string" ? message.caption.trim() : "";
  if (!text || /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i.test(text)) return legacyPost(legacyRequest);

  const ctx = await loadJarvisContext(actorId);
  if (!ctx) return legacyPost(legacyRequest);
  const broad = isBroadManagementRequest(text);
  const reminder = isReminderRequest(text);
  if (!reminder && !(broad && ctx.me.role === "owner")) return legacyPost(legacyRequest);

  const accepted = Number.isSafeInteger(update?.update_id)
    ? await ctx.admin.rpc("nu_telegram_accept_update", { p_update: update.update_id })
    : { data: true, error: null } as any;
  if (!accepted.error && accepted.data === false) return Response.json({ ok: true });

  const reply = message.reply_to_message;
  const replyContext = typeof reply?.text === "string" ? reply.text : typeof reply?.caption === "string" ? reply.caption : null;
  const plan = await runManagementPlanner(ctx as any, chatId, text, replyContext);
  if (!plan) {
    await sendRemembered(ctx, chatId, "Не смог собрать сложный управленческий пакет за один проход. Данные не менял. Это уже не старый общий AI-контур, а отдельный планировщик, поэтому ошибка зафиксирована отдельно.");
    return Response.json({ ok: true });
  }

  await rememberJarvis(ctx as any, chatId, "user", text.slice(0, 12000));
  if (plan.mode === "reply") {
    await sendRemembered(ctx, chatId, plan.reply || "Не смог сформулировать вывод.");
    return Response.json({ ok: true });
  }

  const saved = await ctx.admin.rpc("nu_jarvis_save_action_bundle", { p_actor: ctx.me.id, p_chat: chatId, p_actions: plan.actions });
  if (saved.error || !saved.data) {
    console.error("Jarvis management bundle save failed", { code: saved.error?.code || null });
    await sendRemembered(ctx, chatId, "Не смог подготовить подтверждение. Ничего не изменено.");
    return Response.json({ ok: true });
  }
  await sendProposal(ctx, chatId, proposalText(ctx, plan.actions), saved.data as string);
  return Response.json({ ok: true });
}
