import type { SupabaseClient } from "@supabase/supabase-js";
import { loadJarvisMemory } from "./jarvis-brain";

type Role = "owner" | "manager" | "smm" | "senior_master";
type Status = "new" | "accepted" | "in_progress" | "waiting" | "at_risk" | "review" | "completed";
type Priority = "low" | "normal" | "high" | "critical";

type Profile = { id: string; full_name: string; role: Role; is_active: boolean };
type Project = { id: string; name: string; is_active: boolean };
type Task = {
  id: string;
  title: string;
  description: string | null;
  expected_result: string;
  assignee_id: string;
  created_by: string;
  project_id: string | null;
  priority: Priority;
  status: Status;
  deadline: string;
  completed_at: string | null;
};

export type AgentContext = {
  admin: SupabaseClient;
  me: Profile;
  staff: Profile[];
  projects: Project[];
  visibleTasks: Task[];
  assignable: Profile[];
};

export type JarvisAction = {
  type: "create_task" | "update_task" | "add_comment" | "add_dependency" | "remove_dependency" | "set_checklist_item" | "resolve_deadline_request" | "create_project" | "update_project" | "create_recurring_rule" | "update_recurring_rule";
  task_id: string | null;
  assignee_id: string | null;
  project_id: string | null;
  title: string | null;
  description: string | null;
  expected_result: string | null;
  priority: Priority | null;
  status: Status | null;
  deadline: string | null;
  reason: string | null;
  body: string | null;
  depends_on_task_id: string | null;
  item_index: number | null;
  label: string | null;
  done: boolean | null;
  request_id: string | null;
  decision: "approved" | "rejected" | null;
  clear_description: boolean | null;
  clear_project: boolean | null;
  waiting_for: string | null;
  risk_reason: string | null;
  clear_waiting_for: boolean | null;
  clear_risk_reason: boolean | null;
  project_name: string | null;
  project_description: string | null;
  project_is_active: boolean | null;
  recurring_id: string | null;
  frequency: "daily" | "weekly" | "monthly" | null;
  month_pattern: "all" | "odd" | "even" | null;
  due_kind: "day" | "last_day" | "last_weekday" | null;
  due_day: number | null;
  due_weekday: number | null;
  due_time: string | null;
  reminder_mode: "offsets" | "month_day" | null;
  reminder_day: number | null;
  reminder_days: number[] | null;
  starts_on: string | null;
  is_active: boolean | null;
};

export type JarvisAgentResult = {
  mode: "reply" | "action";
  reply: string | null;
  actions: JarvisAction[];
};

const TZ = "Asia/Yekaterinburg";
const RU_PRIORITY: Record<Priority, string> = { low: "низкий", normal: "обычный", high: "высокий", critical: "критичный" };
const RU_STATUS: Record<Status, string> = { new: "Новая", accepted: "Принята", in_progress: "В работе", waiting: "Ожидание", at_risk: "Под угрозой", review: "На проверке", completed: "Завершена" };

function responseText(data: any): string | null {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of data?.output || []) for (const content of item?.content || []) if (typeof content?.text === "string") return content.text;
  return null;
}

function fmtDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function taskName(ctx: AgentContext, id: string | null) {
  return ctx.visibleTasks.find(t => t.id === id)?.title || "задача";
}
function staffName(ctx: AgentContext, id: string | null) {
  return ctx.staff.find(p => p.id === id)?.full_name || "сотрудник";
}
function projectName(ctx: AgentContext, id: string | null) {
  return ctx.projects.find(p => p.id === id)?.name || "Без проекта";
}

function nullable(type: Record<string, unknown>) {
  return { anyOf: [type, { type: "null" }] };
}

const operationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["create_task","update_task","add_comment","add_dependency","remove_dependency","set_checklist_item","resolve_deadline_request","create_project","update_project","create_recurring_rule","update_recurring_rule"] },
    task_id: nullable({ type: "string" }),
    assignee_id: nullable({ type: "string" }),
    project_id: nullable({ type: "string" }),
    title: nullable({ type: "string" }),
    description: nullable({ type: "string" }),
    expected_result: nullable({ type: "string" }),
    priority: { anyOf: [{ type: "string", enum: ["low","normal","high","critical"] }, { type: "null" }] },
    status: { anyOf: [{ type: "string", enum: ["new","accepted","in_progress","waiting","at_risk","review","completed"] }, { type: "null" }] },
    deadline: nullable({ type: "string" }),
    reason: nullable({ type: "string" }),
    body: nullable({ type: "string" }),
    depends_on_task_id: nullable({ type: "string" }),
    item_index: nullable({ type: "integer" }),
    label: nullable({ type: "string" }),
    done: nullable({ type: "boolean" }),
    request_id: nullable({ type: "string" }),
    decision: { anyOf: [{ type: "string", enum: ["approved","rejected"] }, { type: "null" }] },
    clear_description: nullable({ type: "boolean" }),
    clear_project: nullable({ type: "boolean" }),
    waiting_for: nullable({ type: "string" }),
    risk_reason: nullable({ type: "string" }),
    clear_waiting_for: nullable({ type: "boolean" }),
    clear_risk_reason: nullable({ type: "boolean" }),
    project_name: nullable({ type: "string" }),
    project_description: nullable({ type: "string" }),
    project_is_active: nullable({ type: "boolean" }),
    recurring_id: nullable({ type: "string" }),
    frequency: { anyOf: [{ type: "string", enum: ["daily","weekly","monthly"] }, { type: "null" }] },
    month_pattern: { anyOf: [{ type: "string", enum: ["all","odd","even"] }, { type: "null" }] },
    due_kind: { anyOf: [{ type: "string", enum: ["day","last_day","last_weekday"] }, { type: "null" }] },
    due_day: nullable({ type: "integer" }),
    due_weekday: nullable({ type: "integer" }),
    due_time: nullable({ type: "string" }),
    reminder_mode: { anyOf: [{ type: "string", enum: ["offsets","month_day"] }, { type: "null" }] },
    reminder_day: nullable({ type: "integer" }),
    reminder_days: { anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }] },
    starts_on: nullable({ type: "string" }),
    is_active: nullable({ type: "boolean" }),
  },
  required: ["type","task_id","assignee_id","project_id","title","description","expected_result","priority","status","deadline","reason","body","depends_on_task_id","item_index","label","done","request_id","decision","clear_description","clear_project","waiting_for","risk_reason","clear_waiting_for","clear_risk_reason","project_name","project_description","project_is_active","recurring_id","frequency","month_pattern","due_kind","due_day","due_weekday","due_time","reminder_mode","reminder_day","reminder_days","starts_on","is_active"],
};

function cleanActions(ctx: AgentContext, actions: JarvisAction[], recurringIds: Set<string>, requestIds: Set<string>) {
  const visible = new Set(ctx.visibleTasks.map(t => t.id));
  const assignable = new Set(ctx.assignable.map(p => p.id));
  const projects = new Set(ctx.projects.map(p => p.id));
  return actions.slice(0, 12).filter(a => {
    if (["create_project","update_project","create_recurring_rule","update_recurring_rule"].includes(a.type) && ctx.me.role !== "owner") return false;
    if (a.task_id && !visible.has(a.task_id)) return false;
    if (a.assignee_id && !assignable.has(a.assignee_id) && a.assignee_id !== ctx.me.id) return false;
    if (a.project_id && !projects.has(a.project_id)) return false;
    if (a.depends_on_task_id && !visible.has(a.depends_on_task_id)) return false;
    if (a.request_id && !requestIds.has(a.request_id)) return false;
    if (a.recurring_id && !recurringIds.has(a.recurring_id)) return false;
    if (a.deadline && !Number.isFinite(new Date(a.deadline).getTime())) return false;
    if (a.type === "create_task") return !!(a.assignee_id && a.title?.trim() && a.expected_result?.trim() && a.deadline);
    if (a.type === "update_task") return !!a.task_id;
    if (a.type === "add_comment") return !!(a.task_id && a.body?.trim());
    if (["add_dependency","remove_dependency"].includes(a.type)) return !!(a.task_id && a.depends_on_task_id);
    if (a.type === "set_checklist_item") return !!(a.task_id && Number.isInteger(a.item_index) && a.label && typeof a.done === "boolean");
    if (a.type === "resolve_deadline_request") return !!(a.request_id && a.decision);
    if (a.type === "create_project") return !!a.project_name?.trim();
    if (a.type === "update_project") return !!a.project_id;
    if (a.type === "create_recurring_rule") return !!(a.title?.trim() && a.expected_result?.trim() && a.assignee_id);
    if (a.type === "update_recurring_rule") return !!a.recurring_id;
    return false;
  });
}

export async function runJarvisAgent(ctx: AgentContext, chatId: number, text: string): Promise<JarvisAgentResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const active = ctx.visibleTasks.filter(t => t.status !== "completed").slice(0, 180);
  const completed = ctx.visibleTasks.filter(t => t.status === "completed").sort((a,b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime()).slice(0, 25);
  const selectedIds = [...active, ...completed].map(t => t.id);
  const [history, depsRes, deadlineRes, recurringRes, detailsRes, checklistRes, commentsRes] = await Promise.all([
    loadJarvisMemory(ctx as any, chatId, 16),
    ctx.admin.from("task_dependencies").select("task_id,depends_on_task_id").limit(3000),
    ctx.admin.from("deadline_requests").select("id,task_id,requested_by,old_deadline,requested_deadline,reason,status").eq("status","pending").limit(200),
    ctx.me.role === "owner" ? ctx.admin.from("recurring_task_templates").select("id,title,expected_result,description,assignee_id,project_id,priority,frequency,month_pattern,due_kind,due_day,due_weekday,due_time,reminder_mode,reminder_day,reminder_days,starts_on,is_active").limit(200) : ctx.admin.from("recurring_task_templates").select("id,title,expected_result,description,assignee_id,project_id,priority,frequency,month_pattern,due_kind,due_day,due_weekday,due_time,reminder_mode,reminder_day,reminder_days,starts_on,is_active").eq("assignee_id",ctx.me.id).limit(100),
    selectedIds.length ? ctx.admin.from("tasks").select("id,title,description,expected_result,assignee_id,created_by,project_id,priority,status,deadline,completed_at,waiting_for,risk_reason,deadline_changes,updated_at").in("id",selectedIds) : Promise.resolve({ data: [], error: null } as any),
    selectedIds.length ? ctx.admin.from("task_checklist_items").select("task_id,item_index,label,done").in("task_id",selectedIds).limit(1000) : Promise.resolve({ data: [], error: null } as any),
    selectedIds.length ? ctx.admin.from("task_comments").select("task_id,author_id,body,created_at").in("task_id",selectedIds).order("created_at",{ascending:false}).limit(100) : Promise.resolve({ data: [], error: null } as any),
  ]);

  const taskDetails = detailsRes.error ? [] : (detailsRes.data || []);
  const detailMap = new Map(taskDetails.map((t:any) => [t.id,t]));
  const deps = depsRes.error ? [] : (depsRes.data || []);
  const depMap = new Map<string,string[]>();
  for (const d of deps as any[]) { const list=depMap.get(d.task_id)||[]; list.push(d.depends_on_task_id); depMap.set(d.task_id,list); }
  const checklists = checklistRes.error ? [] : (checklistRes.data || []);
  const checklistMap = new Map<string,any[]>();
  for (const c of checklists as any[]) { const list=checklistMap.get(c.task_id)||[]; list.push(c); checklistMap.set(c.task_id,list); }
  const comments = commentsRes.error ? [] : (commentsRes.data || []);
  const commentMap = new Map<string,any[]>();
  for (const c of comments as any[]) { const list=commentMap.get(c.task_id)||[]; if(list.length<4) list.push(c); commentMap.set(c.task_id,list); }
  const recurring = recurringRes.error ? [] : (recurringRes.data || []);
  const pending = deadlineRes.error ? [] : (deadlineRes.data || []);
  const recurringIds = new Set((recurring as any[]).map(r=>r.id));
  const requestIds = new Set((pending as any[]).map(r=>r.id));
  const staff = new Map(ctx.staff.map(p => [p.id,p.full_name]));
  const projects = new Map(ctx.projects.map(p => [p.id,p.name]));

  const taskPayload = [...active,...completed].map(base => {
    const t:any = detailMap.get(base.id) || base;
    return {
      id:t.id,title:t.title,description:(t.description||"").slice(0,500),expected_result:(t.expected_result||"").slice(0,500),
      assignee_id:t.assignee_id,assignee:staff.get(t.assignee_id)||"Сотрудник",created_by:t.created_by,
      project_id:t.project_id,project:projects.get(t.project_id)||"Без проекта",priority:t.priority,status:t.status,deadline:t.deadline,
      completed_at:t.completed_at,waiting_for:t.waiting_for||null,risk_reason:t.risk_reason||null,deadline_changes:t.deadline_changes||0,updated_at:t.updated_at||null,
      blocked_by:(depMap.get(t.id)||[]).map(id=>{const x:any=detailMap.get(id);return x?{id,title:x.title,status:x.status,deadline:x.deadline}:null}).filter(Boolean),
      checklist:(checklistMap.get(t.id)||[]).sort((a,b)=>a.item_index-b.item_index),
      recent_comments:(commentMap.get(t.id)||[]).map(c=>({author:staff.get(c.author_id)||"Сотрудник",body:String(c.body).slice(0,400),created_at:c.created_at})),
    };
  });

  const schema = {
    type:"object", additionalProperties:false,
    properties:{
      mode:{type:"string",enum:["reply","action"]},
      reply:{anyOf:[{type:"string"},{type:"null"}]},
      actions:{type:"array",items:operationSchema,maxItems:12},
    },
    required:["mode","reply","actions"],
  };

  const permissions = ctx.me.role === "owner"
    ? "Ты можешь создавать и полностью редактировать задачи, менять приоритет, исполнителя, проект, название, описание, ожидаемый результат, статус и дедлайн; добавлять комментарии, зависимости и менять чек-листы; согласовывать переносы; создавать и редактировать проекты и повторяющиеся правила. Не удаляй данные: жесткое удаление оставлено интерфейсу NU TEAM."
    : ctx.me.role === "manager"
      ? "Ты можешь создавать и полноценно редактировать задачи только у разрешённых исполнителей, менять их приоритеты/сроки/статусы, комментарии, зависимости и чек-листы. Проекты и повторяющиеся правила не меняй."
      : "Ты можешь менять статус своих задач, добавлять комментарии, отмечать свой чек-лист и запрашивать перенос дедлайна. Не меняй приоритет, исполнителя, проект или содержание задачи, если у тебя нет управленческих прав.";

  const system = `Ты Jarvis, рабочий AI-ассистент NU TEAM сети «Не Усложняй». С тобой говорят обычным русским языком. Ты должен понимать контекст, ссылки вроде «эта задача», «её», «у него», продолжения прошлой реплики и сразу использовать все доступные возможности, а не отвечать списком искусственных ограничений.\n\nСейчас ${new Date().toISOString()}, рабочая таймзона ${TZ} (UTC+5).\n\n${permissions}\n\nРежим reply: отвечай естественно, анализируй реальные данные команды и задач, предлагай решения. Не выдумывай факты.\nРежим action: когда пользователь явно хочет что-то изменить, верни одно или несколько действий в actions. Можно выполнять несколько связанных изменений одним пакетом. Ничего не считай уже выполненным: система покажет человеку единое подтверждение. Если действие неоднозначно, mode=reply и один точный уточняющий вопрос.\n\nДоступные действия:\n- create_task: создать задачу. Сам формулируй нормальное название и измеримый expected_result, если пользователь просит.\n- update_task: изменить существующую задачу. Можно одновременно поменять priority, status, assignee_id, project_id, title, description, expected_result, waiting_for, risk_reason и deadline. Для изменения deadline обязательно reason. clear_* используй только по явной просьбе очистить поле.\n- add_comment.\n- add_dependency/remove_dependency.\n- set_checklist_item.\n- resolve_deadline_request.\n- create_project/update_project для owner.\n- create_recurring_rule/update_recurring_rule для owner.\n\nНикогда не выдумывай UUID. Используй только id из данных ниже. Не показывай UUID пользователю в reply. Если человек говорит «завтра», «в пятницу», «до вечера», верни конкретный ISO дедлайн по Екатеринбургу. Если время не названо, для задач используй 23:59. Для recurring due_weekday: 1=понедельник ... 7=воскресенье.\n\nПользователь: ${JSON.stringify(ctx.me)}\nРазрешённые исполнители: ${JSON.stringify(ctx.assignable.map(p=>({id:p.id,name:p.full_name,role:p.role})))}\nКоманда: ${JSON.stringify(ctx.staff.map(p=>({id:p.id,name:p.full_name,role:p.role})))}\nПроекты: ${JSON.stringify(ctx.projects.map(p=>({id:p.id,name:p.name,is_active:p.is_active})))}\nЗадачи: ${JSON.stringify(taskPayload)}\nОжидающие запросы переноса: ${JSON.stringify(pending)}\nПовторяющиеся правила: ${JSON.stringify(recurring)}`;

  const input = [
    { role:"system", content:system },
    ...history.slice(-16).map(m=>({role:m.role,content:m.body.slice(0,3500)})),
    { role:"user", content:text },
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
      body:JSON.stringify({
        model:process.env.OPENAI_MODEL||"gpt-6-luna",
        reasoning:{effort:"low"},
        input,
        text:{format:{type:"json_schema",name:"jarvis_agent",strict:true,schema}},
        max_output_tokens:2600,
        store:false,
      }),
      signal:AbortSignal.timeout(40000),
      cache:"no-store",
    });
    if(!response.ok){ console.error("Jarvis agent request failed",{status:response.status}); return null; }
    const raw=responseText(await response.json());
    if(!raw)return null;
    const parsed=JSON.parse(raw) as JarvisAgentResult;
    if(parsed.mode==="reply") return {mode:"reply",reply:(parsed.reply||"Не смог нормально сформулировать ответ.").trim().slice(0,3800),actions:[]};
    const actions=cleanActions(ctx,parsed.actions||[],recurringIds,requestIds);
    if(!actions.length)return {mode:"reply",reply:"Не хочу гадать и менять не ту запись. Уточни, какую именно задачу или объект нужно изменить.",actions:[]};
    return {mode:"action",reply:null,actions};
  } catch(error){
    console.error("Jarvis agent unavailable",{name:error instanceof Error?error.name:"UnknownError"});
    return null;
  }
}

export function renderActionProposal(ctx: AgentContext, actions: JarvisAction[]) {
  const blocks=actions.map((a,index)=>{
    const n=actions.length>1?`${index+1}. `:"";
    if(a.type==="create_task")return `${n}Создать задачу «${a.title}»\nИсполнитель: ${staffName(ctx,a.assignee_id)}\nПроект: ${projectName(ctx,a.project_id)}\nДедлайн: ${fmtDate(a.deadline!)}\nПриоритет: ${RU_PRIORITY[a.priority||"normal"]}\nРезультат: ${a.expected_result}`;
    if(a.type==="update_task"){
      const changes:string[]=[];
      if(a.priority)changes.push(`приоритет → ${RU_PRIORITY[a.priority]}`);
      if(a.status)changes.push(`статус → ${RU_STATUS[a.status]}`);
      if(a.deadline)changes.push(`дедлайн → ${fmtDate(a.deadline)}`);
      if(a.assignee_id)changes.push(`исполнитель → ${staffName(ctx,a.assignee_id)}`);
      if(a.project_id)changes.push(`проект → ${projectName(ctx,a.project_id)}`);
      if(a.clear_project)changes.push("убрать проект");
      if(a.title)changes.push(`название → ${a.title}`);
      if(a.expected_result)changes.push(`результат → ${a.expected_result}`);
      if(a.waiting_for)changes.push(`ожидание → ${a.waiting_for}`);
      if(a.risk_reason)changes.push(`риск → ${a.risk_reason}`);
      return `${n}Изменить «${taskName(ctx,a.task_id)}»\n${changes.map(x=>`• ${x}`).join("\n")||"• обновить данные задачи"}`;
    }
    if(a.type==="add_comment")return `${n}Добавить комментарий к «${taskName(ctx,a.task_id)}»\n${a.body}`;
    if(a.type==="add_dependency")return `${n}Заблокировать «${taskName(ctx,a.task_id)}» задачей «${taskName(ctx,a.depends_on_task_id)}»`;
    if(a.type==="remove_dependency")return `${n}Убрать зависимость «${taskName(ctx,a.task_id)}» от «${taskName(ctx,a.depends_on_task_id)}»`;
    if(a.type==="set_checklist_item")return `${n}${a.done?"Отметить выполненным":"Вернуть в работу"} пункт «${a.label}» в задаче «${taskName(ctx,a.task_id)}»`;
    if(a.type==="resolve_deadline_request")return `${n}${a.decision==="approved"?"Согласовать":"Отклонить"} запрос переноса срока`;
    if(a.type==="create_project")return `${n}Создать проект «${a.project_name}»`;
    if(a.type==="update_project")return `${n}Изменить проект «${projectName(ctx,a.project_id)}»`;
    if(a.type==="create_recurring_rule")return `${n}Создать повторяющуюся задачу «${a.title}» для ${staffName(ctx,a.assignee_id)}`;
    if(a.type==="update_recurring_rule")return `${n}Изменить повторяющееся правило`;
    return `${n}Выполнить действие`;
  });
  return [actions.length>1?`Подтвердить пакет из ${actions.length} действий?`:"Подтвердить действие?","",...blocks].join("\n\n").slice(0,3900);
}

export function renderActionResult(ctx: AgentContext, actions: JarvisAction[]) {
  if(actions.length===1){
    const a=actions[0];
    if(a.type==="create_task")return `Задача создана: ${a.title}`;
    if(a.type==="update_task")return `Готово. Задача «${taskName(ctx,a.task_id)}» обновлена.`;
    if(a.type==="add_comment")return `Комментарий добавлен к задаче «${taskName(ctx,a.task_id)}».`;
    if(a.type==="add_dependency"||a.type==="remove_dependency")return `Готово. Зависимости задачи «${taskName(ctx,a.task_id)}» обновлены.`;
    if(a.type==="set_checklist_item")return `Готово. Чек-лист задачи «${taskName(ctx,a.task_id)}» обновлён.`;
    if(a.type==="resolve_deadline_request")return a.decision==="approved"?"Перенос срока согласован.":"Перенос срока отклонён.";
    if(a.type==="create_project")return `Проект создан: ${a.project_name}`;
    if(a.type==="update_project")return `Проект обновлён.`;
    if(a.type==="create_recurring_rule")return `Повторяющееся правило создано: ${a.title}`;
    if(a.type==="update_recurring_rule")return `Повторяющееся правило обновлено.`;
  }
  return `Готово. Выполнено действий: ${actions.length}.`;
}
