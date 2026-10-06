import { adminClient, sameSecret, telegram, tokenHash } from "../../../lib/server/telegram";
import { renderExecutiveAttention } from "../../../lib/server/jarvis-executive";
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

function executiveKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🔴 Все", callback_data: "j:read:all" },
        { text: "⚠️ Критичные", callback_data: "j:read:critical" },
      ],
      [
        { text: "👥 По сотрудникам", callback_data: "j:read:people" },
        { text: "📅 Мои сегодня", callback_data: "j:read:today" },
      ],
      [{ text: "🔥 Сводка", callback_data: "j:read:summary" }],
    ],
  };
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

function normalizeSelfAssignment(text: string, fullName: string) {
  const isWrite = /(постав|создай|поручи|назнач|добав|задач|нужно|надо)/i.test(text);
  if (!isWrite) return text;
  return text
    .replace(/поставь\s+мне/gi, `Поставь ${fullName}`)
    .replace(/(назначь|поручи)\s+мне/gi, `$1 ${fullName}`)
    .replace(/(^|[\s,.:;!?])на\s+меня(?=$|[\s,.:;!?])/gi, `$1${fullName}`)
    .replace(/(^|[\s,.:;!?])для\s+меня(?=$|[\s,.:;!?])/gi, `$1${fullName}`)
    .replace(/(^|[\s,.:;!?])себе(?=$|[\s,.:;!?])/gi, `$1${fullName}`)
    .replace(/(^|[\s,.:;!?])мне(?=$|[\s,.:;!?])/gi, `$1${fullName}`);
}

function groupJarvisCommand(text: string) {
  const source = text.trim();
  const patterns = [
    /^\/jarvis(?:@ne_uslozhnyay_tasks_bot)?(?:\s+|$)/i,
    /^@ne_uslozhnyay_tasks_bot(?:\s*[:,]\s*|\s+|$)/i,
    /^(?:джарвис|jarvis)(?:\s*[:,]\s*|\s+|$)/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(source)) {
      return { explicit: true, text: source.replace(pattern, "").trim() };
    }
  }
  return { explicit: false, text: source };
}

function isGroupChat(type: unknown) {
  return type === "group" || type === "supergroup";
}

function replyTaskContext(message: any, commandText: string) {
  const match = commandText.match(/^(?:задача|в задачу|сделай задачей|создай задачу)(?:\s*[:,.\-]?\s*(.*))?$/i);
  if (!match || !message?.reply_to_message) return commandText;

  const replied = message.reply_to_message;
  const source = typeof replied.text === "string"
    ? replied.text.trim()
    : typeof replied.caption === "string"
      ? replied.caption.trim()
      : "";
  if (!source) return commandText;

  const tail = match[1]?.trim();
  return `Создай задачу${tail ? ` ${tail}` : ""}. Исходное сообщение: ${source.slice(0, 2000)}`;
}

export async function POST(request: Request) {
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const update = await request.json();

    const callback = update.callback_query;
    if (callback && !callback.from?.is_bot && callback.message?.chat) {
      const chatType = callback.message.chat.type;
      const privateChat = chatType === "private";
      const groupChat = isGroupChat(chatType);
      const chatId = callback.message.chat.id;
      const actorTelegramId = callback.from?.id;

      if ((!privateChat && !groupChat) || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(actorTelegramId) || actorTelegramId <= 0) {
        return Response.json({ ok: true });
      }
      if (privateChat && chatId !== actorTelegramId) return Response.json({ ok: true });

      const ctx = await loadJarvisContext(actorTelegramId);
      if (!ctx) {
        await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Telegram не привязан к NU TEAM" });
        return Response.json({ ok: true });
      }

      const readMatch = typeof callback.data === "string" ? callback.data.match(/^j:read:(summary|all|critical|people|today)$/) : null;
      if (readMatch) {
        if (!privateChat) {
          await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Сводки доступны в личном чате с Jarvis" });
          return Response.json({ ok: true });
        }

        let result: string | null = null;
        if (readMatch[1] === "today") {
          const intent = await interpretJarvis(ctx, "Какие у меня задачи сегодня?");
          result = renderReadIntent(ctx, intent);
        } else {
          const query = readMatch[1] === "all"
            ? "покажи все горящие"
            : readMatch[1] === "critical"
              ? "критичные"
              : readMatch[1] === "people"
                ? "по сотрудникам"
                : "что горит?";
          result = renderExecutiveAttention(ctx, query);
        }

        await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Обновил" });
        if (result) {
          await telegram("editMessageText", {
            chat_id: chatId,
            message_id: callback.message.message_id,
            text: result,
            reply_markup: executiveKeyboard(),
          });
        }
        return Response.json({ ok: true });
      }

      const match = typeof callback.data === "string" ? callback.data.match(/^j:(ok|no):([0-9a-f-]{36})$/i) : null;
      if (!match) return Response.json({ ok: true });

      if (groupChat) {
        const { data: ownedAction } = await ctx.admin
          .from("telegram_pending_actions")
          .select("id")
          .eq("id", match[2])
          .eq("user_id", ctx.me.id)
          .eq("chat_id", chatId)
          .maybeSingle();
        if (!ownedAction) {
          await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Это подтверждение принадлежит другому сотруднику" });
          return Response.json({ ok: true });
        }
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
    const chatType = message?.chat?.type;
    const privateChat = chatType === "private";
    const groupChat = isGroupChat(chatType);
    const chatId = message?.chat?.id;
    const actorTelegramId = message?.from?.id;

    if (!message || message.from?.is_bot || (!privateChat && !groupChat) || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(actorTelegramId) || actorTelegramId <= 0) {
      return Response.json({ ok: true });
    }
    if (privateChat && chatId !== actorTelegramId) return Response.json({ ok: true });

    const rawText: string = typeof message.text === "string" ? message.text.trim() : "";
    const groupCommand = groupChat ? groupJarvisCommand(rawText) : { explicit: true, text: rawText };
    if (groupChat && !groupCommand.explicit) return Response.json({ ok: true });

    const text = groupCommand.text;
    const token = privateChat ? text.match(/^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{32})$/)?.[1] : undefined;

    if (token) {
      const { data, error } = await adminClient().rpc("nu_telegram_bind", {
        p_hash: tokenHash(token), p_chat: chatId, p_username: typeof message.from.username === "string" ? message.from.username : null,
      });
      if (error) return Response.json({ error: "Temporary error" }, { status: 503 });
      await send(chatId, data ? `Telegram подключён. Теперь я могу работать с задачами NU TEAM прямо здесь.\n\n${jarvisHelp()}` : "Ссылка истекла или уже использована. Создай новую ссылку в NU TEAM.");
      return Response.json({ ok: true });
    }

    const ctx = await loadJarvisContext(actorTelegramId);
    if (!ctx) {
      const messageText = groupChat
        ? "Сначала подключи свой Telegram к NU TEAM в личном чате с ботом. После этого сможешь ставить задачи отсюда."
        : "Открой NU TEAM → Telegram → «Подключить», затем перейди по персональной ссылке. После привязки я смогу читать и управлять твоими задачами.";
      await send(chatId, messageText, groupChat ? { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } } : {});
      return Response.json({ ok: true });
    }

    if (!text) {
      await send(chatId, groupChat
        ? "Напиши поручение после обращения к Jarvis. Например: «Джарвис, поставь Сергею до пятницы проверить остатки. Результат: таблица по точкам»."
        : "Пока работаю с текстовыми сообщениями. Напиши «помощь», чтобы посмотреть примеры.",
      groupChat ? { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } } : {});
      return Response.json({ ok: true });
    }

    if (privateChat) {
      const executiveReply = renderExecutiveAttention(ctx, text);
      if (executiveReply) {
        await send(chatId, executiveReply, { reply_markup: executiveKeyboard() });
        return Response.json({ ok: true });
      }
    }

    const baseText = groupChat ? replyTaskContext(message, text) : normalizeJarvisReadQuery(text);
    const interpretedText = normalizeSelfAssignment(baseText, ctx.me.full_name);
    const intent = await interpretJarvis(ctx, interpretedText);
    const readReply = renderReadIntent(ctx, intent);
    if (readReply) {
      if (groupChat) {
        await send(chatId, "Управленческие сводки и личные списки задач показываю только в личном чате, чтобы не выкладывать внутренние данные в группу.", {
          reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
        });
      } else {
        await send(chatId, readReply);
      }
      return Response.json({ ok: true });
    }

    const validation = validateWrite(ctx, intent);
    if (validation) {
      await send(chatId, validation, groupChat ? { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } } : {});
      return Response.json({ ok: true });
    }

    const actionId = await savePendingAction(ctx, chatId, intent);
    await send(chatId, renderProposal(ctx, intent), {
      ...(groupChat ? { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } } : {}),
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