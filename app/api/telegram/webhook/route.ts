import { adminClient, sameSecret, telegram, tokenHash } from "../../../lib/server/telegram";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    const update = await request.json();
    const message = update.message;
    if (!message || message.chat?.type !== "private" || message.from?.is_bot || !Number.isSafeInteger(message.chat?.id) || message.chat.id <= 0 || message.chat.id !== message.from?.id) return Response.json({ ok: true });
    const text: string = typeof message.text === "string" ? message.text : "";
    const token = text.match(/^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{32})$/)?.[1];
    let reply = "Откройте платформу «Не Усложняй» → Telegram → «Подключить», затем перейдите по персональной ссылке.";
    if (token) {
      const { data, error } = await adminClient().rpc("nu_telegram_bind", { p_hash: tokenHash(token), p_chat: message.chat.id, p_username: typeof message.from.username === "string" ? message.from.username : null });
      if (error) return Response.json({ error: "Temporary error" }, { status: 503 });
      reply = data ? "Telegram подключён! Здесь будут уведомления о задачах и напоминания о сроках." : "Ссылка истекла или уже использована. Создайте новую ссылку в платформе.";
    }
    await telegram("sendMessage", { chat_id: message.chat.id, text: reply });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Temporary error" }, { status: 503 }); }
}
