import { POST as legacyPost } from "../webhook/route";
import { sameSecret, telegram } from "../../../lib/server/telegram";
import { clearJarvisMemory, rememberJarvis } from "../../../lib/server/jarvis-brain";
import { loadJarvisContext } from "../../../lib/server/jarvis";
import { renderActionProposal, renderActionResult, runJarvisAgent, type JarvisAction } from "../../../lib/server/jarvis-agent";
import { transcribeTelegramAudio } from "../../../lib/server/jarvis-voice";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = NonNullable<Awaited<ReturnType<typeof loadJarvisContext>>>;

async function send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, ...extra });
}

async function sendRemembered(ctx: Ctx, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const result = await send(chatId, text, extra);
  await rememberJarvis(ctx as any, chatId, "assistant", text.slice(0, 12000));
  return result;
}

function isGroup(type: unknown) {
  return type === "group" || type === "supergroup";
}

function groupJarvisCommand(message: any, rawText: string) {
  const source = rawText.trim();
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || "ne_uslozhnyay_tasks_bot").replace(/^@/, "");
  const patterns = [
    new RegExp(`^\\/jarvis(?:@${botUsername})?(?:\\s+|$)`, "i"),
    new RegExp(`^@${botUsername}(?:\\s*[:,]\\s*|\\s+|$)`, "i"),
    /^(?:джарвис|jarvis)(?:\s*[:,]\s*|\s+|$)/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(source)) return { explicit: true, text: source.replace(pattern, "").trim() };
  }
  const repliedUsername = String(message?.reply_to_message?.from?.username || "").replace(/^@/, "");
  if (repliedUsername && repliedUsername.toLowerCase() === botUsername.toLowerCase()) {
    return { explicit: true, text: source };
  }
  return { explicit: false, text: source };
}

function splitTelegramText(text: string, limit = 3800) {
  if (text.length <= limit) return [text];
  const paragraphs = text.split(/\n\n+/);
  const parts: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > limit) {
      if (current) { parts.push(current); current = ""; }
      for (let i = 0; i < paragraph.length; i += limit) parts.push(paragraph.slice(i, i + limit));
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > limit) { parts.push(current); current = paragraph; }
    else current = next;
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}

async function sendProposal(ctx: Ctx, chatId: number, proposal: string, bundleId: string, replyTo?: number) {
  const parts = splitTelegramText(proposal);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await send(chatId, parts[i], {
      ...(replyTo && i === 0 ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      ...(last ? {
        reply_markup: { inline_keyboard: [[
          { text: "✅ Подтвердить", callback_data: `ja:ok:${bundleId}` },
          { text: "❌ Отмена", callback_data: `ja:no:${bundleId}` },
        ]] },
      } : {}),
    });
  }
  await rememberJarvis(ctx as any, chatId, "assistant", proposal.slice(0, 12000));
}

async function handleBundleCallback(update: any) {
  const callback = update?.callback_query;
  const match = typeof callback?.data === "string" ? callback.data.match(/^ja:(ok|no):([0-9a-f-]{36})$/i) : null;
  if (!match) return null;
  if (callback.from?.is_bot || !callback.message?.chat) return Response.json({ ok: true });

  const chatType = callback.message.chat.type;
  const privateChat = chatType === "private";
  const groupChat = isGroup(chatType);
  if (!privateChat && !groupChat) return Response.json({ ok: true });

  const chatId = callback.message.chat.id;
  const actorTelegramId = callback.from?.id;
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(actorTelegramId) || actorTelegramId <= 0) return Response.json({ ok: true });
  if (privateChat && chatId !== actorTelegramId) return Response.json({ ok: true });

  const ctx = await loadJarvisContext(actorTelegramId);
  if (!ctx) {
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Telegram не привязан к NU TEAM" });
    return Response.json({ ok: true });
  }

  if (match[1] === "no") {
    const cancelled = await ctx.admin.rpc("nu_jarvis_cancel_action_bundle", { p_id: match[2], p_actor: ctx.me.id, p_chat: chatId });
    const ok = !cancelled.error && cancelled.data === true;
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: ok ? "Отменено" : "Это подтверждение уже неактуально" });
    if (ok) {
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      await sendRemembered(ctx, chatId, "Отменил. Ничего не изменено.");
    }
    return Response.json({ ok: true });
  }

  const claim = await ctx.admin.rpc("nu_jarvis_claim_action_bundle", { p_id: match[2], p_actor: ctx.me.id, p_chat: chatId });
  if (claim.error || !claim.data) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: groupChat ? "Это подтверждение принадлежит другому сотруднику или уже использовано" : "Действие уже выполнено, отменено или устарело",
    });
    return Response.json({ ok: true });
  }
  const actions = claim.data as JarvisAction[];

  const applied = await ctx.admin.rpc("nu_jarvis_apply_action_bundle_v2", { p_actor: ctx.me.id, p_chat: chatId, p_actions: actions });
  if (applied.error) {
    console.error("Jarvis v2 action bundle failed", { code: applied.error.code, message: applied.error.message });
    await ctx.admin.rpc("nu_jarvis_finish_action_bundle", {
      p_id: match[2], p_actor: ctx.me.id, p_chat: chatId, p_success: false, p_result: null, p_error: applied.error.message,
    });
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Не применилось" });
    await sendRemembered(ctx, chatId, "Не смог применить пакет. Ничего не изменено. Подтверждение сохранено, после исправления причины можно попробовать ещё раз.");
    return Response.json({ ok: true });
  }

  await ctx.admin.rpc("nu_jarvis_finish_action_bundle", {
    p_id: match[2], p_actor: ctx.me.id, p_chat: chatId, p_success: true, p_result: applied.data, p_error: null,
  });
  await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Готово" });
  await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
  await sendRemembered(ctx, chatId, renderActionResult(ctx as any, actions));
  return Response.json({ ok: true });
}

async function processUpdate(update: any, legacyRequest: Request) {
  const callbackResult = await handleBundleCallback(update);
  if (callbackResult) return callbackResult;

  const message = update?.message;
  const chatType = message?.chat?.type;
  const privateChat = chatType === "private";
  const groupChat = isGroup(chatType);
  if (!message || message.from?.is_bot || (!privateChat && !groupChat)) return legacyPost(legacyRequest);

  const chatId = message.chat.id;
  const actorTelegramId = message.from?.id;
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(actorTelegramId) || actorTelegramId <= 0) return legacyPost(legacyRequest);
  if (privateChat && chatId !== actorTelegramId) return legacyPost(legacyRequest);

  const rawText = typeof message.text === "string" ? message.text.trim() : "";
  const groupCommand = groupChat ? groupJarvisCommand(message, rawText) : { explicit: true, text: rawText };
  if (groupChat && !groupCommand.explicit) return legacyPost(legacyRequest);

  if (privateChat && /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i.test(rawText)) return legacyPost(legacyRequest);

  const ctx = await loadJarvisContext(actorTelegramId);
  if (!ctx) {
    if (groupChat) {
      await send(chatId, "Сначала подключи свой Telegram к NU TEAM в личном чате с ботом, затем Jarvis сможет выполнять твои команды здесь.", {
        reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
      });
      return Response.json({ ok: true });
    }
    return legacyPost(legacyRequest);
  }

  if (privateChat && Number.isSafeInteger(message.reply_to_message?.message_id)) {
    const { data: checkin } = await ctx.admin.from("telegram_checkin_sessions")
      .select("id").eq("user_id", ctx.me.id).eq("message_id", message.reply_to_message.message_id).eq("state", "awaiting").maybeSingle();
    if (checkin) return legacyPost(legacyRequest);
  }

  let text = groupCommand.text;
  if (!text && privateChat && (message.voice?.file_id || message.audio?.file_id)) {
    try {
      const audio = message.voice || message.audio;
      text = await transcribeTelegramAudio(audio.file_id, audio.duration, audio.file_size);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Voice transcription failed";
      const friendly = reason.includes("too long") ? "Голосовое слишком длинное. Пришли до 10 минут."
        : reason.includes("too large") ? "Файл слишком большой. Пришли голосовое до 20 МБ."
          : "Не смог разобрать голосовое. Текстовые команды продолжают работать.";
      await send(chatId, friendly);
      return Response.json({ ok: true });
    }
  }

  if (!text) return legacyPost(legacyRequest);

  if (/^(?:новый диалог|сбрось контекст|очисти контекст|забудь контекст)[.!]?$/i.test(text)) {
    await clearJarvisMemory(ctx as any, chatId);
    await sendRemembered(ctx, chatId, "Контекст очищен. Начинаем с чистого листа.");
    return Response.json({ ok: true });
  }

  const agent = await runJarvisAgent(ctx as any, chatId, text);
  if (!agent) {
    await send(chatId, "AI-мозг Jarvis сейчас временно недоступен. Я не буду изображать старый командный бот и делать вид, что понял запрос. Попробуй ещё раз чуть позже.");
    return Response.json({ ok: true });
  }
  await rememberJarvis(ctx as any, chatId, "user", text.slice(0, 12000));

  if (agent.mode === "reply") {
    await sendRemembered(ctx, chatId, agent.reply || "Не смог сформулировать ответ.", groupChat ? {
      reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    } : {});
    return Response.json({ ok: true });
  }

  const saved = await ctx.admin.rpc("nu_jarvis_save_action_bundle", { p_actor: ctx.me.id, p_chat: chatId, p_actions: agent.actions });
  if (saved.error || !saved.data) {
    console.error("Jarvis action bundle save failed", { code: saved.error?.code });
    await sendRemembered(ctx, chatId, "Не смог подготовить подтверждение. Ничего не изменено.");
    return Response.json({ ok: true });
  }
  const proposal = renderActionProposal(ctx as any, agent.actions);
  await sendProposal(ctx, chatId, proposal, saved.data as string, groupChat ? message.message_id : undefined);
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const legacyRequest = request.clone();
  let update: any;
  try { update = await request.json(); }
  catch { return legacyPost(legacyRequest); }

  const updateId = Number.isSafeInteger(update?.update_id) ? update.update_id : null;
  if (updateId !== null) {
    const actorTelegramId = update?.message?.from?.id || update?.callback_query?.from?.id;
    if (Number.isSafeInteger(actorTelegramId) && actorTelegramId > 0) {
      const ctx = await loadJarvisContext(actorTelegramId);
      if (ctx) {
        const accepted = await ctx.admin.rpc("nu_telegram_accept_update", { p_update: updateId });
        if (!accepted.error && accepted.data === false) return Response.json({ ok: true });
      }
    }
  }

  return processUpdate(update, legacyRequest);
}
