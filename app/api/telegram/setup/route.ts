import { activeUser, appUrl, telegram, TelegramError } from "../../../lib/server/telegram";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await activeUser(request);
    if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
    if (user.role !== "owner") return Response.json({ error: "Доступ запрещён" }, { status: 403 });

    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
      return Response.json(
        { error: "TELEGRAM_WEBHOOK_SECRET отсутствует или имеет неверный формат. Нужны 32–256 символов: буквы, цифры, _ или -." },
        { status: 503 },
      );
    }

    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return Response.json({ error: "TELEGRAM_BOT_TOKEN отсутствует в окружении приложения." }, { status: 503 });
    }

    const deployEnv = process.env.NU_ENV || process.env.VERCEL_ENV;
    if (deployEnv && deployEnv !== "production") {
      return Response.json({ error: "Подключение бота выполняется в основной версии" }, { status: 403 });
    }

    await telegram("setWebhook", {
      url: `${appUrl()}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      max_connections: 2,
    });

    const info = await telegram("getMe", {});
    return Response.json({ ok: true, username: info.username });
  } catch (error) {
    const diagnostic = error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "UnknownError", message: String(error) };
    console.error("[telegram/setup] failed", diagnostic);

    if (error instanceof TelegramError) {
      const message = error.code === 401
        ? "Telegram отклонил TELEGRAM_BOT_TOKEN. Возьмите актуальный API Token у @BotFather и замените TELEGRAM_BOT_TOKEN в Timeweb."
        : `Telegram API вернул ошибку ${error.code}. Проверьте TELEGRAM_BOT_TOKEN и APP_URL.`;
      return Response.json({ error: message, telegramCode: error.code }, { status: 503 });
    }

    if (error instanceof Error) {
      if (error.message === "Telegram configuration missing") {
        return Response.json({ error: "TELEGRAM_BOT_TOKEN отсутствует или содержит пробелы." }, { status: 503 });
      }
      if (error.message === "APP_URL must use HTTPS") {
        return Response.json({ error: "APP_URL должен начинаться с https://" }, { status: 503 });
      }
      if (error.message === "Supabase server configuration missing") {
        return Response.json({ error: "Ошибка серверной конфигурации Supabase." }, { status: 503 });
      }
      if (error.name === "TimeoutError" || error.message.toLowerCase().includes("fetch failed")) {
        return Response.json({ error: "Timeweb не смог связаться с API Telegram. Откройте логи приложения: там будет точная сетевая ошибка." }, { status: 503 });
      }
      if (error.message.startsWith("Invalid URL")) {
        return Response.json({ error: "APP_URL имеет неверный формат." }, { status: 503 });
      }
    }

    return Response.json({ error: "Не удалось настроить бота. Откройте логи приложения Timeweb и найдите строку [telegram/setup] failed." }, { status: 503 });
  }
}
