import { activeUser, appUrl, telegram } from "../../../lib/server/telegram";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await activeUser(request);
    if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
    if (user.role !== "owner") return Response.json({ error: "Доступ запрещён" }, { status: 403 });
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return Response.json({ error: "Добавьте TELEGRAM_WEBHOOK_SECRET в Vercel (32–256 букв, цифр, _ или -)" }, { status: 503 });
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return Response.json({ error: "Подключение бота выполняется в основной версии" }, { status: 403 });
    await telegram("setWebhook", {
      url: `${appUrl()}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      max_connections: 2,
    });
    const info = await telegram("getMe", {});
    return Response.json({ ok: true, username: info.username });
  } catch {
    return Response.json({ error: "Не удалось настроить бота. Проверьте переменные Telegram в Vercel." }, { status: 503 });
  }
}
