import { adminClient, sameSecret, telegram, tokenHash } from "../../../lib/server/telegram";
import {
  cancelPendingAction,
  executePendingAction,
  interpretJarvis,
  jarvisHelp,
  loadJarvisContext,
  renderProposal,
  renderReadIntent,
  savePendingAction,
  validateWrite,
} from "../../../lib/server/jarvis";

export const runtime = "nodejs";

async function send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, ...extra });
}

function normalizeJarvisReadQuery(text: string) {
  const n = text
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
  const tokens = new Set(n.split(/\s+/).filter(Boolean));
  const hasTaskStem = [...tokens].some(token => token.startsWith("задач"));
  const hasToday = tokens.has("сегодня") || (tokens.has("на") && tokens.has("день"));
  const asksOwn =
    (tokens.has("мои") || tokens.has("моя") || tokens.has("мне") || tokens.has("меня")) ||
    n.includes("что мне делать") ||
    n.includes("что у меня") ||
    n.includes("мой план") ||
    n.includes("план на сегодня");
  const isWrite = /(постав|создай|поручи|назнач|добав|перенес|измени|закрой|заверш)/i.test(n);

  if (!isWrite && hasToday && (hasTaskStem || asksOwn)) {
    return "Какие у меня задачи сегодня?";
  }
  if (!isWrite && asksOwn && (n.includes("делать сегодня") || n.includes("план на сегодня"))) {
    return "Какие у меня задачи сегодня?";
  }
  return text;
}

export async function POST(request: Request) {
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const update = await request.json();

    const callback = update.callback_query;
    if (callback && !callback.from?.is_bot && callback.message?.chat?.type === "private") {
      const chatId = callback.message.chat.id;
      if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== callback.from.id) return Response.json({ ok: true });
      const match = typeof callback.data === "string" ? callback.data.match(/^j:(ok|no):([0-9a-f-]{36})$/i) : null;
      if (!match) return Response.json({ ok: true });
      const ctx = await loadJarvisContext(chatId);
      if (!ctx) {
        await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Telegram не привязан к NU TEAM" });
        return Response.json({ ok: true });
      }
      let result: string;
      try {
        result = match[1] === "ok" ? await executePendingAction(ctx, chatId, match[2]) : await cancelPendingAction(ctx, chatId, match[2]);
      } catch (error) {
        console.error("Jarvis callback failed", error);
        result = "Не смог выполнить действие. Запись не изменена. Попробуй ещё раз или открой NU TEAM.";
      }
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: match[1] === "ok" ? "Принято" : "Отменено" });
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      await send(chatId, result);
      return Response.json({ ok: true });
    }

    const message = update.message;
    if (!message || message.chat?.type !== "private" || message.from?.is_bot || !Number.isSafeInteger(message.chat?.id) || message.chat.id <= 0 || message.chat.id !== message.from?.id) {
      return Response.json({ ok: true });
    }

    const chatId = message.chat.id as number;
    const text: string = typeof message.text === "string" ? message.text.trim() : "";
    const token = text.match(/^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{32})$/)?.[1];

    if (token) {
      const { data, error } = await adminClient().rpc("nu_telegram_bind", {
        p_hash: tokenHash(token), p_chat: chatId, p_username: typeof message.from.username === "string" ? message.from.username : null,
      });
      if (error) return Response.json({ error: "Temporary error" }, { status: 503 });
      await send(chatId, data ? `Telegram подключён. Теперь я могу работать с задачами NU TEAM прямо здесь.\n\n${jarvisHelp()}` : "Ссылка истекла или уже использована. Создай новую ссылку в NU TEAM.");
      return Response.json({ ok: true });
    }

    const ctx = await loadJarvisContext(chatId);
    if (!ctx) {
      await send(chatId, "Открой NU TEAM → Telegram → «Подключить», затем перейди по персональной ссылке. После привязки я смогу читать и управлять твоими задачами.");
      return Response.json({ ok: true });
    }

    if (!text) {
      await send(chatId, "Пока работаю с текстовыми сообщениями. Напиши «помощь», чтобы посмотреть примеры.");
      return Response.json({ ok: true });
    }

    const intent = await interpretJarvis(ctx, normalizeJarvisReadQuery(text));
    const readReply = renderReadIntent(ctx, intent);
    if (readReply) {
      await send(chatId, readReply);
      return Response.json({ ok: true });
    }

    const validation = validateWrite(ctx, intent);
    if (validation) {
      await send(chatId, validation);
      return Response.json({ ok: true });
    }

    const actionId = await savePendingAction(ctx, chatId, intent);
    await send(chatId, renderProposal(ctx, intent), {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Подтвердить", callback_data: `j:ok:${actionId}` },
          { text: "❌ Отмена", callback_data: `j:no:${actionId}` },
        ]],
      },
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook failed", error);
    return Response.json({ error: "Temporary error" }, { status: 503 });
  }
}