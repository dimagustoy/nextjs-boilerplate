import { adminClient, appUrl, sameSecret, telegram, TelegramError } from "../../../lib/server/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;
const labels: Record<string,string> = { created: "Новая задача", status: "Изменён статус", deadline: "Изменён дедлайн", changed: "Задача обновлена", comment: "Новый комментарий", deadline_requested: "Запрос переноса срока", deadline_approved: "Перенос срока согласован", deadline_rejected: "Перенос срока отклонён", reminder: "Напоминание о задаче", overdue: "Задача просрочена" };
const statuses: Record<string,string> = { new: "Новая", accepted: "Принята", in_progress: "В работе", waiting: "Ожидание", at_risk: "Под угрозой", review: "На проверке", completed: "Завершена" };
type Item = { id: string; lease_id: string; user_id: string; chat_id: number; task_id: string; kind: string; title: string; status: string; deadline: string; expected_result: string };
export async function POST(request: Request) {
  if (!sameSecret(request.headers.get("authorization"), process.env.TELEGRAM_DISPATCH_SECRET ? `Bearer ${process.env.TELEGRAM_DISPATCH_SECRET}` : undefined)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return Response.json({ error: "Production only" }, { status: 403 });
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) return Response.json({ error: "Not configured" }, { status: 503 });
    const admin = adminClient();
    const reminders = await admin.rpc("nu_telegram_reminders");
    if (reminders.error) return Response.json({ error: "Reminder queue unavailable" }, { status: 503 });
    const { data, error } = await admin.rpc("nu_telegram_claim", { p_limit: 10 });
    if (error) return Response.json({ error: "Queue unavailable" }, { status: 503 });
    let sent = 0;
    // Two workers keep requests below Telegram's overall rate limit; leases
    // prevent two concurrent dispatch calls from taking the same queue item.
    const items = [...(data || [])] as Item[];
    async function worker() {
      let item: Item | undefined;
      while ((item = items.shift())) {
        // Recheck immediately before delivery: employee/assignment may change.
        const visible = await admin.rpc("nu_telegram_visible", { p_user: item.user_id, p_task: item.task_id });
        const link = await admin.from("telegram_links").select("chat_id").eq("user_id",item.user_id).maybeSingle();
        if (visible.error || link.error) throw new Error("Permission check unavailable");
        let code = 403, retry = 60;
        if (visible.data && link.data?.chat_id === item.chat_id) {
          try {
            const due = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Yekaterinburg", dateStyle: "medium", timeStyle: "short" }).format(new Date(item.deadline));
            await telegram("sendMessage", { chat_id: item.chat_id, text: `${labels[item.kind] || "Событие по задаче"}\n\n${item.title.slice(0,200)}\nСтатус: ${statuses[item.status] || item.status}\nСрок: ${due} (Екатеринбург)\nРезультат: ${item.expected_result.slice(0,1000)}`, reply_markup: { inline_keyboard: [[{ text: "Открыть задачу", url: `${appUrl()}/dashboard?task=${item.task_id}` }]] } });
            code = 200; sent++;
          } catch (e) { code = e instanceof TelegramError ? e.code : 503; retry = e instanceof TelegramError ? e.retryAfter : 60; }
        }
        const finished = await admin.rpc("nu_telegram_finish", { p_id: item.id, p_lease: item.lease_id, p_code: code, p_retry: retry });
        if (finished.error) throw new Error("Queue acknowledgement failed");
      }
    }
    await Promise.all([worker(),worker()]);
    return Response.json({ ok: true, sent });
  } catch { return Response.json({ error: "Dispatch failed" }, { status: 503 }); }
}
