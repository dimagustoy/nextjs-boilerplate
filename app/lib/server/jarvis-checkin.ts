import type { SupabaseClient } from "@supabase/supabase-js";

type Task = { id:string; title:string; status:string; assignee_id:string };
type Context = { admin:SupabaseClient; me:{id:string}; visibleTasks:Task[] };
type Session = { id:string; task_ids:string[]; message_id:number|null };
type Update = { task_id:string; status:string|null; comment:string|null };

const RU_STATUS:Record<string,string>={in_progress:"В работе",waiting:"Ожидание",at_risk:"Под угрозой",review:"На проверке"};

function classify(text:string,currentStatus:string):{status:string|null;comment:string|null} {
  const n=text.toLocaleLowerCase("ru").replace(/ё/g,"е").trim();
  if(/(готов|сделал|сделана|выполн|закрыл|заверш)/i.test(n)) {
    return {status:currentStatus==="review"?null:"review",comment:null};
  }
  if(/(не успе|задерж|проблем|блок|жду|ожида|не могу|завис|нет ответ|не готов|перенос)/i.test(n)) {
    return {status:currentStatus==="at_risk"?null:"at_risk",comment:`Check-in: ${text.trim()}`};
  }
  if(/(по плану|все нормально|всё нормально|делаю|работаю|успева|в работе|нормально|ок\b)/i.test(n)) {
    return {status:["in_progress","review"].includes(currentStatus)?null:"in_progress",comment:null};
  }
  return {status:null,comment:`Check-in: ${text.trim()}`};
}

export async function prepareCheckinAction(ctx:Context,chatId:number,session:Session,text:string) {
  const ordered=session.task_ids.map(id=>ctx.visibleTasks.find(t=>t.id===id)).filter((t):t is Task=>Boolean(t)&&t!.assignee_id===ctx.me.id&&t!.status!=="completed");
  if(!ordered.length)return {error:"В этом check-in уже нет активных задач."};

  const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const numbered=lines.map(line=>{
    const m=line.match(/^(\d{1,2})\s*[).:\-]?\s+(.+)$/);
    return m?{index:+m[1],text:m[2].trim()}:null;
  }).filter((x):x is {index:number;text:string}=>Boolean(x));

  const reports=numbered.length?numbered:ordered.length===1?[{index:1,text:text.trim()}]:[];
  if(!reports.length)return {error:"Ответь по номерам задач, например:\n1 готово\n2 не успеваю, жду поставщика\n3 всё по плану"};

  const updates:Update[]=[];
  const summary:string[]=[];
  for(const report of reports) {
    const task=ordered[report.index-1];
    if(!task)continue;
    const result=classify(report.text,task.status);
    if(!result.status&&!result.comment)continue;
    updates.push({task_id:task.id,status:result.status,comment:result.comment});
    summary.push(`${report.index}. ${task.title}\n${result.status?`→ ${RU_STATUS[result.status]}`:"→ добавить комментарий"}${result.comment?`\n${result.comment}`:""}`);
  }
  if(!updates.length)return {error:"Не нашёл изменений для подтверждения. Напиши по номерам задач чуть конкретнее."};

  await ctx.admin.from("telegram_pending_actions").delete().eq("user_id",ctx.me.id).lt("expires_at",new Date().toISOString());
  const payload={checkin_session_id:session.id,raw_reply:text,updates};
  const {data,error}=await ctx.admin.from("telegram_pending_actions").insert({user_id:ctx.me.id,chat_id:chatId,action_type:"checkin_batch",payload}).select("id").single();
  if(error)throw error;
  return {actionId:data.id as string,proposal:["Обновить задачи по итогам дня?","",...summary].join("\n\n")};
}

export async function executeCheckinAction(ctx:Context,chatId:number,actionId:string) {
  const {data:action,error}=await ctx.admin.from("telegram_pending_actions").select("id,user_id,chat_id,action_type,payload,expires_at").eq("id",actionId).eq("user_id",ctx.me.id).eq("chat_id",chatId).eq("action_type","checkin_batch").maybeSingle();
  if(error||!action)return "Действие не найдено или уже выполнено.";
  if(new Date(action.expires_at).getTime()<Date.now()) {
    await ctx.admin.from("telegram_pending_actions").delete().eq("id",actionId);
    return "Подтверждение устарело. Ответь на check-in ещё раз.";
  }
  const payload=action.payload as {checkin_session_id:string;raw_reply:string;updates:Update[]};
  const {data,count,error:rpcError}=await ctx.admin.rpc("nu_jarvis_apply_checkin",{p_actor:ctx.me.id,p_updates:payload.updates});
  void count;
  if(rpcError)throw rpcError;
  await ctx.admin.from("telegram_checkin_sessions").update({state:"done",raw_reply:payload.raw_reply,answered_at:new Date().toISOString()}).eq("id",payload.checkin_session_id).eq("user_id",ctx.me.id);
  await ctx.admin.from("telegram_pending_actions").delete().eq("id",actionId);
  return `Итог дня принят. Обновлено задач: ${Number(data)||payload.updates.length}.`;
}

export async function cancelCheckinAction(ctx:Context,chatId:number,actionId:string) {
  const {data:action}=await ctx.admin.from("telegram_pending_actions").select("id,payload").eq("id",actionId).eq("user_id",ctx.me.id).eq("chat_id",chatId).eq("action_type","checkin_batch").maybeSingle();
  if(action?.payload) {
    const payload=action.payload as {checkin_session_id?:string};
    if(payload.checkin_session_id)await ctx.admin.from("telegram_checkin_sessions").update({state:"skipped",answered_at:new Date().toISOString()}).eq("id",payload.checkin_session_id).eq("user_id",ctx.me.id);
  }
  await ctx.admin.from("telegram_pending_actions").delete().eq("id",actionId).eq("user_id",ctx.me.id).eq("chat_id",chatId);
  return "Итог дня не применял.";
}
