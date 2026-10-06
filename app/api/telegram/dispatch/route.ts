import { adminClient, appUrl, telegram, TelegramError } from "../../../lib/server/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;
const labels: Record<string,string> = { created: "Новая задача", status: "Изменён статус", deadline: "Изменён дедлайн", changed: "Задача обновлена", comment: "Новый комментарий", deadline_requested: "Запрос переноса срока", deadline_approved: "Перенос срока согласован", deadline_rejected: "Перенос срока отклонён", reminder: "Напоминание о задаче", overdue: "Задача просрочена" };
const statuses: Record<string,string> = { new: "Новая", accepted: "Принята", in_progress: "В работе", waiting: "Ожидание", at_risk: "Под угрозой", review: "На проверке", completed: "Завершена" };
type Item = { id: string; lease_id: string; user_id: string; chat_id: number; task_id: string; kind: string; title: string; status: string; deadline: string; expected_result: string };
type CheckinTask = { id:string; title:string; status:string; deadline:string; priority:string };
type Checkin = { id:string; lease_id:string; user_id:string; chat_id:number; task_ids:string[]; tasks:CheckinTask[] };

function checkinText(tasks:CheckinTask[]) {
  const rows=tasks.map((task,index)=>{
    const due=new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(task.deadline));
    return `${index+1}. ${task.title}\n${statuses[task.status]||task.status} · срок ${due}`;
  });
  return [
    "🌙 Короткий итог дня",
    "",
    "Ответь на это сообщение по номерам задач. Jarvis подготовит изменения и ничего не запишет без твоего подтверждения.",
    "",
    ...rows,
    "",
    "Пример:",
    "1 готово",
    "2 не успеваю, жду поставщика",
    "3 всё по плану",
  ].join("\n");
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return Response.json({ error: "Forbidden" }, { status: 403 });
  const deployEnv = process.env.NU_ENV || process.env.VERCEL_ENV;
  if (deployEnv && deployEnv !== "production") return Response.json({ error: "Production only" }, { status: 403 });
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) return Response.json({ error: "Not configured" }, { status: 503 });
    const admin = adminClient();
    const authorized = await admin.rpc("nu_telegram_dispatch_authorize", { p_secret: token });
    if (authorized.error || !authorized.data) return Response.json({ error: "Forbidden" }, { status: 403 });
    const reminders = await admin.rpc("nu_telegram_reminders");
    if (reminders.error) return Response.json({ error: "Reminder queue unavailable" }, { status: 503 });

    let sent = 0;
    const checkins = await admin.rpc("nu_jarvis_checkin_claim", { p_limit: 10 });
    if (!checkins.error) {
      for (const checkin of (checkins.data || []) as Checkin[]) {
        let code=503;
        let messageId:number|null=null;
        try {
          if (!checkin.tasks?.length) code=400;
          else {
            const result=await telegram("sendMessage", {
              chat_id:checkin.chat_id,
              text:checkinText(checkin.tasks),
              reply_markup:{force_reply:true,selective:true,input_field_placeholder:"1 готово · 2 не успеваю..."},
            }) as {message_id?:number};
            messageId=Number.isSafeInteger(result?.message_id)?Number(result.message_id):null;
            code=200; sent++;
          }
        } catch (e) { code=e instanceof TelegramError?e.code:503; }
        const finish=await admin.rpc("nu_jarvis_checkin_finish",{p_id:checkin.id,p_lease:checkin.lease_id,p_code:code,p_message_id:messageId});
        if(finish.error)throw new Error("Check-in acknowledgement failed");
      }
    }

    const { data, error } = await admin.rpc("nu_telegram_claim", { p_limit: 10 });
    if (error) return Response.json({ error: "Queue unavailable" }, { status: 503 });
    const items = [...(data || [])] as Item[];
    async function worker() {
      let item: Item | undefined;
      while ((item = items.shift())) {
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
