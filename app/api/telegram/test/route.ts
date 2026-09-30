import { activeUser, appUrl, telegram } from "../../../lib/server/telegram";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await activeUser(request);
    if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const { data, error } = await user.admin.from("telegram_links").select("chat_id").eq("user_id",user.id).maybeSingle();
    if (error || !data) return Response.json({ error: "Сначала подключите Telegram" }, { status: 400 });
    await telegram("sendMessage", { chat_id: data.chat_id, text: "Всё работает! Telegram подключён к платформе «Не Усложняй».", reply_markup: { inline_keyboard: [[{ text: "Открыть платформу", url: `${appUrl()}/dashboard` }]] } });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Не удалось отправить сообщение. Проверьте, что бот запущен и не заблокирован." }, { status: 503 }); }
}
