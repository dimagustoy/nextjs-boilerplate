import type { SupabaseClient } from "@supabase/supabase-js";
import { loadJarvisMemory } from "./jarvis-brain";

type Role = "owner" | "manager" | "smm" | "senior_master";
type Status = "new" | "accepted" | "in_progress" | "waiting" | "at_risk" | "review" | "completed";
type Priority = "low" | "normal" | "high" | "critical";
type MemberRole = "manager" | "smm" | "senior_master";

type Profile = { id:string; full_name:string; role:Role; is_active:boolean };
type Project = { id:string; name:string; description?:string|null; is_active:boolean };
type Task = {
  id:string; title:string; description:string|null; expected_result:string; assignee_id:string; created_by:string;
  project_id:string|null; priority:Priority; status:Status; deadline:string; started_at:string|null; completed_at:string|null;
  waiting_for:string|null; risk_reason:string|null; deadline_changes:number; created_at:string; updated_at:string;
};

export type V3Context = {
  admin:SupabaseClient;
  me:Profile;
  staff:Profile[];
  projects:Project[];
  visibleTasks:Task[];
  assignable:Profile[];
};

export type JarvisV3Action = {
  type:"create_task"|"update_task"|"delete_task"|"add_comment"|"add_dependency"|"remove_dependency"|"set_checklist_item"|"resolve_deadline_request"|"create_project"|"update_project"|"create_recurring_rule"|"update_recurring_rule"|"update_member"|"invite_member";
  task_id:string|null;
  expected_updated_at:string|null;
  assignee_id:string|null;
  project_id:string|null;
  title:string|null;
  description:string|null;
  expected_result:string|null;
  priority:Priority|null;
  status:Status|null;
  deadline:string|null;
  reason:string|null;
  body:string|null;
  depends_on_task_id:string|null;
  item_index:number|null;
  label:string|null;
  done:boolean|null;
  request_id:string|null;
  decision:"approved"|"rejected"|null;
  clear_description:boolean|null;
  clear_project:boolean|null;
  waiting_for:string|null;
  risk_reason:string|null;
  clear_waiting_for:boolean|null;
  clear_risk_reason:boolean|null;
  project_name:string|null;
  project_description:string|null;
  project_is_active:boolean|null;
  recurring_id:string|null;
  frequency:"daily"|"weekly"|"monthly"|null;
  month_pattern:"all"|"odd"|"even"|null;
  due_kind:"day"|"last_day"|"last_weekday"|null;
  due_day:number|null;
  due_weekday:number|null;
  due_time:string|null;
  reminder_mode:"offsets"|"month_day"|null;
  reminder_day:number|null;
  reminder_days:number[]|null;
  starts_on:string|null;
  is_active:boolean|null;
  member_id:string|null;
  member_role:MemberRole|null;
  member_is_active:boolean|null;
  email:string|null;
  full_name:string|null;
};

export type JarvisV3Result = { mode:"reply"|"action"; reply:string|null; actions:JarvisV3Action[] };
const TZ="Asia/Yekaterinburg";
const RU_PRIORITY:Record<Priority,string>={low:"низкий",normal:"обычный",high:"высокий",critical:"критичный"};
const RU_STATUS:Record<Status,string>={new:"Новая",accepted:"Принята",in_progress:"В работе",waiting:"Ожидание",at_risk:"Под угрозой",review:"На проверке",completed:"Завершена"};

function responseText(data:any):string|null{
  if(typeof data?.output_text==="string")return data.output_text;
  for(const item of data?.output||[])for(const c of item?.content||[])if(typeof c?.text==="string")return c.text;
  return null;
}
function fmtDate(v:string){return new Intl.DateTimeFormat("ru-RU",{timeZone:TZ,dateStyle:"medium",timeStyle:"short"}).format(new Date(v));}
function norm(v:string){return v.toLocaleLowerCase("ru").replace(/ё/g,"е").replace(/[^a-zа-я0-9@._-]+/gi," ").trim();}
function words(v:string){return norm(v).split(/\s+/).filter(x=>x.length>=3);}
function nullable(t:Record<string,unknown>){return {anyOf:[t,{type:"null"}]};}
function visibleFor(me:Profile,staff:Profile[],t:Task){
  if(me.role==="owner")return true;
  if(t.assignee_id===me.id||t.created_by===me.id)return true;
  if(me.role==="manager"){const p=staff.find(x=>x.id===t.assignee_id);return !!p&&["smm","senior_master"].includes(p.role);}
  return false;
}
function canAssign(me:Profile,staff:Profile[]){
  if(me.role==="owner")return staff.filter(p=>p.is_active);
  if(me.role==="manager")return staff.filter(p=>p.is_active&&["smm","senior_master"].includes(p.role));
  return [];
}
async function allTasks(admin:SupabaseClient):Promise<Task[]>{
  const rows:Task[]=[];
  for(let offset=0;offset<5000;offset+=500){
    const r=await admin.from("tasks").select("id,title,description,expected_result,assignee_id,created_by,project_id,priority,status,deadline,started_at,completed_at,waiting_for,risk_reason,deadline_changes,created_at,updated_at").order("deadline").order("id").range(offset,offset+499);
    if(r.error)throw r.error;
    rows.push(...(r.data||[]) as Task[]);
    if((r.data||[]).length<500)break;
  }
  return rows;
}

async function buildContext(base:V3Context){
  const [staffRes,projectRes,taskRows]=await Promise.all([
    base.admin.from("profiles").select("id,full_name,role,is_active").order("full_name"),
    base.admin.from("projects").select("id,name,description,is_active").order("name"),
    allTasks(base.admin),
  ]);
  if(staffRes.error||projectRes.error)throw staffRes.error||projectRes.error;
  const allStaff=(staffRes.data||[]) as Profile[];
  const allProjects=(projectRes.data||[]) as Project[];
  const visible=taskRows.filter(t=>visibleFor(base.me,allStaff,t));
  return {
    ...base,
    staff:base.me.role==="owner"?allStaff:allStaff.filter(p=>p.is_active),
    projects:base.me.role==="owner"?allProjects:allProjects.filter(p=>p.is_active),
    visibleTasks:visible,
    assignable:canAssign(base.me,allStaff),
    allStaff,
    allProjects,
  };
}

const operationSchema={
  type:"object",additionalProperties:false,
  properties:{
    type:{type:"string",enum:["create_task","update_task","delete_task","add_comment","add_dependency","remove_dependency","set_checklist_item","resolve_deadline_request","create_project","update_project","create_recurring_rule","update_recurring_rule","update_member","invite_member"]},
    task_id:nullable({type:"string"}),expected_updated_at:nullable({type:"string"}),assignee_id:nullable({type:"string"}),project_id:nullable({type:"string"}),
    title:nullable({type:"string"}),description:nullable({type:"string"}),expected_result:nullable({type:"string"}),
    priority:{anyOf:[{type:"string",enum:["low","normal","high","critical"]},{type:"null"}]},
    status:{anyOf:[{type:"string",enum:["new","accepted","in_progress","waiting","at_risk","review","completed"]},{type:"null"}]},
    deadline:nullable({type:"string"}),reason:nullable({type:"string"}),body:nullable({type:"string"}),depends_on_task_id:nullable({type:"string"}),
    item_index:nullable({type:"integer"}),label:nullable({type:"string"}),done:nullable({type:"boolean"}),request_id:nullable({type:"string"}),
    decision:{anyOf:[{type:"string",enum:["approved","rejected"]},{type:"null"}]},clear_description:nullable({type:"boolean"}),clear_project:nullable({type:"boolean"}),
    waiting_for:nullable({type:"string"}),risk_reason:nullable({type:"string"}),clear_waiting_for:nullable({type:"boolean"}),clear_risk_reason:nullable({type:"boolean"}),
    project_name:nullable({type:"string"}),project_description:nullable({type:"string"}),project_is_active:nullable({type:"boolean"}),recurring_id:nullable({type:"string"}),
    frequency:{anyOf:[{type:"string",enum:["daily","weekly","monthly"]},{type:"null"}]},month_pattern:{anyOf:[{type:"string",enum:["all","odd","even"]},{type:"null"}]},
    due_kind:{anyOf:[{type:"string",enum:["day","last_day","last_weekday"]},{type:"null"}]},due_day:nullable({type:"integer"}),due_weekday:nullable({type:"integer"}),
    due_time:nullable({type:"string"}),reminder_mode:{anyOf:[{type:"string",enum:["offsets","month_day"]},{type:"null"}]},reminder_day:nullable({type:"integer"}),
    reminder_days:{anyOf:[{type:"array",items:{type:"integer"}},{type:"null"}]},starts_on:nullable({type:"string"}),is_active:nullable({type:"boolean"}),
    member_id:nullable({type:"string"}),member_role:{anyOf:[{type:"string",enum:["manager","smm","senior_master"]},{type:"null"}]},member_is_active:nullable({type:"boolean"}),
    email:nullable({type:"string"}),full_name:nullable({type:"string"}),
  },
  required:["type","task_id","expected_updated_at","assignee_id","project_id","title","description","expected_result","priority","status","deadline","reason","body","depends_on_task_id","item_index","label","done","request_id","decision","clear_description","clear_project","waiting_for","risk_reason","clear_waiting_for","clear_risk_reason","project_name","project_description","project_is_active","recurring_id","frequency","month_pattern","due_kind","due_day","due_weekday","due_time","reminder_mode","reminder_day","reminder_days","starts_on","is_active","member_id","member_role","member_is_active","email","full_name"],
};

function blankAction(type:JarvisV3Action["type"]):JarvisV3Action{return {
  type,task_id:null,expected_updated_at:null,assignee_id:null,project_id:null,title:null,description:null,expected_result:null,priority:null,status:null,deadline:null,reason:null,body:null,depends_on_task_id:null,item_index:null,label:null,done:null,request_id:null,decision:null,clear_description:null,clear_project:null,waiting_for:null,risk_reason:null,clear_waiting_for:null,clear_risk_reason:null,project_name:null,project_description:null,project_is_active:null,recurring_id:null,frequency:null,month_pattern:null,due_kind:null,due_day:null,due_weekday:null,due_time:null,reminder_mode:null,reminder_day:null,reminder_days:null,starts_on:null,is_active:null,member_id:null,member_role:null,member_is_active:null,email:null,full_name:null,
};}

function prepareActions(ctx:Awaited<ReturnType<typeof buildContext>>,input:JarvisV3Action[],recurringIds:Set<string>,requestIds:Set<string>){
  const visible=new Map(ctx.visibleTasks.map(t=>[t.id,t]));
  const assignable=new Set(ctx.assignable.map(p=>p.id));
  const activeProjects=new Set(ctx.allProjects.filter(p=>p.is_active).map(p=>p.id));
  const allProjects=new Set(ctx.allProjects.map(p=>p.id));
  const allMembers=new Set(ctx.allStaff.map(p=>p.id));
  const cleaned:JarvisV3Action[]=[];
  for(const raw of input.slice(0,16)){
    const a={...raw};
    if(a.task_id&&visible.has(a.task_id))a.expected_updated_at=visible.get(a.task_id)!.updated_at;
    if(["create_project","update_project","create_recurring_rule","update_recurring_rule","delete_task","update_member","invite_member"].includes(a.type)&&ctx.me.role!=="owner")continue;
    if(a.task_id&&!visible.has(a.task_id))continue;
    if(a.assignee_id&&!assignable.has(a.assignee_id)&&a.assignee_id!==ctx.me.id)continue;
    if(a.type!=="update_project"&&a.project_id&&!activeProjects.has(a.project_id))continue;
    if(a.type==="update_project"&&a.project_id&&!allProjects.has(a.project_id))continue;
    if(a.depends_on_task_id&&!visible.has(a.depends_on_task_id))continue;
    if(a.request_id&&!requestIds.has(a.request_id))continue;
    if(a.recurring_id&&!recurringIds.has(a.recurring_id))continue;
    if(a.deadline&&!Number.isFinite(Date.parse(a.deadline)))continue;
    if(a.member_id&&(!allMembers.has(a.member_id)||a.member_id===ctx.me.id))continue;

    if(!["owner","manager"].includes(ctx.me.role)&&a.type==="update_task"){
      a.assignee_id=null;a.project_id=null;a.title=null;a.description=null;a.expected_result=null;a.priority=null;a.waiting_for=null;a.risk_reason=null;
      a.clear_description=null;a.clear_project=null;a.clear_waiting_for=null;a.clear_risk_reason=null;
    }

    let valid=false;
    if(a.type==="create_task")valid=!!(a.assignee_id&&a.title?.trim()&&a.expected_result?.trim()&&a.deadline);
    else if(a.type==="update_task")valid=!!a.task_id;
    else if(a.type==="delete_task")valid=ctx.me.role==="owner"&&!!a.task_id;
    else if(a.type==="add_comment")valid=!!(a.task_id&&a.body?.trim());
    else if(["add_dependency","remove_dependency"].includes(a.type))valid=!!(a.task_id&&a.depends_on_task_id&&a.task_id!==a.depends_on_task_id);
    else if(a.type==="set_checklist_item")valid=!!(a.task_id&&Number.isInteger(a.item_index)&&a.label&&typeof a.done==="boolean");
    else if(a.type==="resolve_deadline_request")valid=!!(a.request_id&&a.decision);
    else if(a.type==="create_project")valid=!!a.project_name?.trim();
    else if(a.type==="update_project")valid=!!a.project_id;
    else if(a.type==="create_recurring_rule")valid=!!(a.title?.trim()&&a.expected_result?.trim()&&a.assignee_id);
    else if(a.type==="update_recurring_rule")valid=!!a.recurring_id;
    else if(a.type==="update_member")valid=!!(a.member_id&&(a.member_role||typeof a.member_is_active==="boolean"||a.full_name?.trim()));
    else if(a.type==="invite_member")valid=!!(a.email?.trim()&&a.full_name?.trim()&&a.member_role);
    if(!valid)continue;

    if(a.type==="update_task"&&a.status==="completed"&&a.task_id&&visible.get(a.task_id)?.status!=="review"&&["owner","manager"].includes(ctx.me.role)){
      const first={...a,status:"review" as Status}; cleaned.push(first);
      const second=blankAction("update_task");second.task_id=a.task_id;second.expected_updated_at=a.expected_updated_at;second.status="completed";cleaned.push(second);continue;
    }
    cleaned.push(a);
  }
  return cleaned.slice(0,20);
}

function workloadSummary(tasks:Task[],staff:Profile[]){
  const now=Date.now();
  return staff.filter(p=>p.is_active).map(p=>{
    const a=tasks.filter(t=>t.assignee_id===p.id&&t.status!=="completed");
    return {id:p.id,name:p.full_name,role:p.role,active:a.length,overdue:a.filter(t=>Date.parse(t.deadline)<now).length,at_risk:a.filter(t=>t.status==="at_risk").length,review:a.filter(t=>t.status==="review").length,due_7d:a.filter(t=>Date.parse(t.deadline)>=now&&Date.parse(t.deadline)<=now+7*86400000).length,high:a.filter(t=>t.priority==="high"||t.priority==="critical").length};
  }).sort((a,b)=>(b.overdue*6+b.at_risk*4+b.high*2+b.active)-(a.overdue*6+a.at_risk*4+a.high*2+a.active));
}
function projectSummary(tasks:Task[],projects:Project[],deps:any[]){
  const now=Date.now();const blocked=new Set((deps||[]).map(d=>d.task_id));
  return projects.filter(p=>p.is_active).map(p=>{const a=tasks.filter(t=>t.project_id===p.id&&t.status!=="completed");return {id:p.id,name:p.name,active:a.length,overdue:a.filter(t=>Date.parse(t.deadline)<now).length,at_risk:a.filter(t=>t.status==="at_risk").length,blocked:a.filter(t=>blocked.has(t.id)).length};}).filter(p=>p.active>0).sort((a,b)=>(b.overdue*5+b.at_risk*3+b.blocked*2+b.active)-(a.overdue*5+a.at_risk*3+a.blocked*2+a.active));
}

export async function runJarvisAgentV3(base:V3Context,chatId:number,text:string,replyContext?:string|null):Promise<JarvisV3Result|null>{
  const key=process.env.OPENAI_API_KEY;if(!key)return null;
  let ctx:Awaited<ReturnType<typeof buildContext>>;
  try{ctx=await buildContext(base);}catch(error){console.error("Jarvis v3 context failed",{name:error instanceof Error?error.name:"Unknown"});return null;}

  const queryWords=new Set(words(text));const n=norm(text);const now=Date.now();
  const mentionedStaff=new Set(ctx.allStaff.filter(p=>n.includes(norm(p.full_name))||n.split(" ").includes(norm(p.full_name).split(" ")[0])).map(p=>p.id));
  const mentionedProjects=new Set(ctx.allProjects.filter(p=>n.includes(norm(p.name))).map(p=>p.id));
  const activeAll=ctx.visibleTasks.filter(t=>t.status!=="completed");
  const scored=activeAll.map(t=>{
    let score=0;const hay=new Set(words(`${t.title} ${t.description||""} ${t.expected_result}`));
    for(const w of queryWords)if(hay.has(w)||[...hay].some(h=>h.startsWith(w)||w.startsWith(h)))score+=5;
    if(mentionedStaff.has(t.assignee_id))score+=12;if(t.project_id&&mentionedProjects.has(t.project_id))score+=12;
    if(Date.parse(t.deadline)<now)score+=10;if(t.status==="at_risk")score+=9;if(t.status==="review")score+=6;
    if(Date.parse(t.deadline)>=now&&Date.parse(t.deadline)<=now+2*86400000)score+=5;if(t.priority==="critical")score+=4;else if(t.priority==="high")score+=2;
    score+=Math.max(0,2-Math.floor((now-Date.parse(t.updated_at))/86400000));return {t,score};
  }).sort((a,b)=>b.score-a.score||Date.parse(a.t.deadline)-Date.parse(b.t.deadline));
  const active=scored.slice(0,160).map(x=>x.t);
  const completed=ctx.visibleTasks.filter(t=>t.status==="completed").sort((a,b)=>Date.parse(b.completed_at||b.updated_at)-Date.parse(a.completed_at||a.updated_at)).filter((t,i)=>i<20||words(t.title).some(w=>queryWords.has(w))).slice(0,30);
  const selected=[...active,...completed];const ids=selected.map(t=>t.id);

  const [history,depsRes,deadlineRes,recurringRes,checklistRes,commentsRes,taskHistoryRes]=await Promise.all([
    loadJarvisMemory(ctx as any,chatId,12),
    ctx.admin.from("task_dependencies").select("task_id,depends_on_task_id").limit(5000),
    ctx.admin.from("deadline_requests").select("id,task_id,requested_by,old_deadline,requested_deadline,reason,status,created_at").eq("status","pending").limit(300),
    ctx.me.role==="owner"?ctx.admin.from("recurring_task_templates").select("id,title,expected_result,description,assignee_id,project_id,priority,frequency,month_pattern,due_kind,due_day,due_weekday,due_time,reminder_mode,reminder_day,reminder_days,starts_on,is_active").limit(300):ctx.admin.from("recurring_task_templates").select("id,title,expected_result,description,assignee_id,project_id,priority,frequency,month_pattern,due_kind,due_day,due_weekday,due_time,reminder_mode,reminder_day,reminder_days,starts_on,is_active").eq("assignee_id",ctx.me.id).limit(150),
    ids.length?ctx.admin.from("task_checklist_items").select("task_id,item_index,label,done").in("task_id",ids).limit(1500):Promise.resolve({data:[],error:null} as any),
    ids.length?ctx.admin.from("task_comments").select("task_id,author_id,body,created_at").in("task_id",ids).order("created_at",{ascending:false}).limit(240):Promise.resolve({data:[],error:null} as any),
    ids.length?ctx.admin.from("task_history").select("task_id,user_id,action,old_value,new_value,created_at").in("task_id",ids).order("created_at",{ascending:false}).limit(500):Promise.resolve({data:[],error:null} as any),
  ]);
  const deps=depsRes.error?[]:(depsRes.data||[]);const pending=deadlineRes.error?[]:(deadlineRes.data||[]);const recurring=recurringRes.error?[]:(recurringRes.data||[]);
  const depMap=new Map<string,string[]>();for(const d of deps as any[]){const list=depMap.get(d.task_id)||[];list.push(d.depends_on_task_id);depMap.set(d.task_id,list);}
  const checkMap=new Map<string,any[]>();for(const c of (checklistRes.error?[]:checklistRes.data||[]) as any[]){const list=checkMap.get(c.task_id)||[];list.push(c);checkMap.set(c.task_id,list);}
  const commentMap=new Map<string,any[]>();for(const c of (commentsRes.error?[]:commentsRes.data||[]) as any[]){const list=commentMap.get(c.task_id)||[];if(list.length<5)list.push(c);commentMap.set(c.task_id,list);}
  const histMap=new Map<string,any[]>();for(const h of (taskHistoryRes.error?[]:taskHistoryRes.data||[]) as any[]){const list=histMap.get(h.task_id)||[];if(list.length<5){const before=h.old_value||{},after=h.new_value||{};const changed=Object.keys(after).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])&&!['updated_at','completed_at'].includes(k));list.push({actor_id:h.user_id,actor:ctx.allStaff.find(p=>p.id===h.user_id)?.full_name||"Система",action:h.action,changed,created_at:h.created_at});}histMap.set(h.task_id,list);}
  const taskMap=new Map(ctx.visibleTasks.map(t=>[t.id,t]));const staffMap=new Map(ctx.allStaff.map(p=>[p.id,p.full_name]));const projectMap=new Map(ctx.allProjects.map(p=>[p.id,p.name]));
  const taskPayload=selected.map(t=>({id:t.id,title:t.title,description:(t.description||"").slice(0,450),expected_result:t.expected_result.slice(0,450),assignee_id:t.assignee_id,assignee:staffMap.get(t.assignee_id)||"Сотрудник",project_id:t.project_id,project:projectMap.get(t.project_id||"")||"Без проекта",priority:t.priority,status:t.status,deadline:t.deadline,started_at:t.started_at,completed_at:t.completed_at,waiting_for:t.waiting_for,risk_reason:t.risk_reason,deadline_changes:t.deadline_changes,updated_at:t.updated_at,blocked_by:(depMap.get(t.id)||[]).map(id=>{const b=taskMap.get(id);return b?{id,title:b.title,status:b.status,deadline:b.deadline}:null;}).filter(Boolean),checklist:(checkMap.get(t.id)||[]).sort((a,b)=>a.item_index-b.item_index),recent_comments:(commentMap.get(t.id)||[]).map(c=>({author:staffMap.get(c.author_id)||"Сотрудник",body:String(c.body).slice(0,350),created_at:c.created_at})),recent_history:histMap.get(t.id)||[]}));
  const recurringIds=new Set((recurring as any[]).map(r=>r.id));const requestIds=new Set((pending as any[]).map(r=>r.id));
  const workloads=workloadSummary(ctx.visibleTasks,ctx.allStaff);const projectsHealth=projectSummary(ctx.visibleTasks,ctx.allProjects,deps as any[]);

  const schema={type:"object",additionalProperties:false,properties:{mode:{type:"string",enum:["reply","action"]},reply:{anyOf:[{type:"string"},{type:"null"}]},actions:{type:"array",items:operationSchema,maxItems:16}},required:["mode","reply","actions"]};
  const permissions=ctx.me.role==="owner"
    ?"Владелец: можешь создавать, менять и явно удалять задачи; управлять проектами и регулярными правилами; менять роли/активность сотрудников и приглашать новых; согласовывать переносы. Удаление задачи разрешено только если человек явно просит удалить её, никогда не трактуй «убери/не показывай» как удаление."
    :ctx.me.role==="manager"
      ?"Управляющий: можешь создавать и полноценно менять задачи разрешённых исполнителей, комментарии, зависимости, чек-листы, сроки и статусы. Нельзя управлять командой, проектами и регулярными правилами."
      :"Исполнитель: можешь менять статус только своих задач, добавлять комментарии, отмечать чек-лист и запрашивать перенос своего дедлайна. Не меняй содержание, приоритет, исполнителя и проект.";

  const system=`Ты Jarvis v3, полноценный рабочий AI-ассистент NU TEAM сети «Не Усложняй». Разговаривай естественно по-русски. Не требуй командного синтаксиса. Не используй Markdown-звёздочки: Telegram должен получать чистый читаемый текст.\n\nСейчас ${new Date().toISOString()}, рабочая таймзона ${TZ} (UTC+5).\n${permissions}\n\nПравила:\n- Для чтения и анализа отвечай сразу по фактам. Умеешь анализировать загрузку, риски, историю изменений, блокеры, проекты и просрочки.\n- Для любого изменения верни mode=action и все связанные действия одним пакетом. Система покажет подтверждение.\n- Понимай «эта задача», «её», «у него» по истории диалога и контексту ответа на сообщение.\n- Если информации действительно недостаточно, задай ровно один конкретный вопрос. Не переспрашивай то, что можно разумно вывести из контекста.\n- Для create_task сам формулируй короткое название и измеримый expected_result.\n- update_task умеет менять название, описание, результат, приоритет, статус, исполнителя, проект, waiting_for, risk_reason и дедлайн. Для переноса дедлайна reason обязателен; если причины нет и её нельзя вывести, спроси.\n- Если владелец/управляющий просит «закрой/заверши» задачу не на проверке, верни завершение; система сама проведёт обязательный переход через review.\n- delete_task только по явной просьбе удалить конкретную задачу. Это необратимо и отдельно подсвечивается перед подтверждением.\n- add_comment, add_dependency/remove_dependency, set_checklist_item, resolve_deadline_request.\n- owner: create_project/update_project, create_recurring_rule/update_recurring_rule, update_member, invite_member. invite_member всегда отдельным пакетом без других действий.\n- Для «завтра/пятница/вечером» верни точный ISO срок в Екатеринбурге. Если время задачи не названо, используй 23:59; «вечером» без времени = 19:00.\n- Никогда не выдумывай UUID и не показывай UUID пользователю. Используй только id из данных.\n\nПользователь: ${JSON.stringify(ctx.me)}\nКоманда: ${JSON.stringify(ctx.allStaff.map(p=>({id:p.id,name:p.full_name,role:p.role,is_active:p.is_active})))}\nРазрешённые исполнители: ${JSON.stringify(ctx.assignable.map(p=>({id:p.id,name:p.full_name,role:p.role})))}\nПроекты: ${JSON.stringify(ctx.allProjects.map(p=>({id:p.id,name:p.name,is_active:p.is_active})))}\nСводка нагрузки: ${JSON.stringify(workloads)}\nЗдоровье проектов: ${JSON.stringify(projectsHealth)}\nПодробные задачи: ${JSON.stringify(taskPayload)}\nОжидающие переносы: ${JSON.stringify(pending)}\nРегулярные правила: ${JSON.stringify(recurring)}${replyContext?`\nКонтекст сообщения, на которое отвечает пользователь: ${JSON.stringify(replyContext.slice(0,2500))}`:""}`;
  const input=[{role:"system",content:system},...history.map(m=>({role:m.role,content:m.body.slice(0,3000)})),{role:"user",content:text}];
  try{
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-6-luna",reasoning:{effort:"low"},input,text:{format:{type:"json_schema",name:"jarvis_v3",strict:true,schema}},max_output_tokens:3600,store:false}),signal:AbortSignal.timeout(45000),cache:"no-store"});
    if(!response.ok){console.error("Jarvis v3 request failed",{status:response.status});return null;}
    const raw=responseText(await response.json());if(!raw)return null;const parsed=JSON.parse(raw) as JarvisV3Result;
    if(parsed.mode==="reply")return {mode:"reply",reply:(parsed.reply||"Не смог сформулировать ответ.").replace(/\*\*/g,"").trim().slice(0,3900),actions:[]};
    const actions=prepareActions(ctx,parsed.actions||[],recurringIds,requestIds);
    if(!actions.length)return {mode:"reply",reply:"Не хочу менять не ту запись. Уточни, какой именно объект ты имеешь в виду.",actions:[]};
    if(actions.some(a=>a.type==="invite_member")&&actions.length>1)return {mode:"reply",reply:"Приглашение нового сотрудника отправляется отдельно от изменений задач. Подтверди приглашение отдельной просьбой, чтобы внешнее письмо не смешивалось с транзакцией NU OS.",actions:[]};
    return {mode:"action",reply:null,actions};
  }catch(error){console.error("Jarvis v3 unavailable",{name:error instanceof Error?error.name:"UnknownError"});return null;}
}

function taskName(ctx:V3Context,id:string|null){return ctx.visibleTasks.find(t=>t.id===id)?.title||"задача";}
function staffName(ctx:V3Context,id:string|null){return ctx.staff.find(p=>p.id===id)?.full_name||"сотрудник";}
function projectName(ctx:V3Context,id:string|null){return ctx.projects.find(p=>p.id===id)?.name||"Без проекта";}
export function renderV3Proposal(ctx:V3Context,actions:JarvisV3Action[]){
  const blocks=actions.map((a,i)=>{const n=actions.length>1?`${i+1}. `:"";
    if(a.type==="create_task")return `${n}Создать задачу «${a.title}»\nИсполнитель: ${staffName(ctx,a.assignee_id)}\nПроект: ${projectName(ctx,a.project_id)}\nДедлайн: ${fmtDate(a.deadline!)}\nПриоритет: ${RU_PRIORITY[a.priority||"normal"]}\nРезультат: ${a.expected_result}`;
    if(a.type==="update_task"){const c:string[]=[];if(a.priority)c.push(`приоритет → ${RU_PRIORITY[a.priority]}`);if(a.status)c.push(`статус → ${RU_STATUS[a.status]}`);if(a.deadline)c.push(`дедлайн → ${fmtDate(a.deadline)}`);if(a.assignee_id)c.push(`исполнитель → ${staffName(ctx,a.assignee_id)}`);if(a.project_id)c.push(`проект → ${projectName(ctx,a.project_id)}`);if(a.clear_project)c.push("убрать проект");if(a.title)c.push(`название → ${a.title}`);if(a.description)c.push("обновить описание");if(a.expected_result)c.push(`результат → ${a.expected_result}`);if(a.waiting_for)c.push(`ожидание → ${a.waiting_for}`);if(a.risk_reason)c.push(`риск → ${a.risk_reason}`);return `${n}Изменить «${taskName(ctx,a.task_id)}»\n${c.map(x=>`• ${x}`).join("\n")||"• обновить задачу"}`;}
    if(a.type==="delete_task")return `${n}⚠️ УДАЛИТЬ БЕЗ ВОЗМОЖНОСТИ ВОССТАНОВЛЕНИЯ\n«${taskName(ctx,a.task_id)}»`;
    if(a.type==="add_comment")return `${n}Добавить комментарий к «${taskName(ctx,a.task_id)}»\n${a.body}`;
    if(a.type==="add_dependency")return `${n}Добавить зависимость: «${taskName(ctx,a.task_id)}» ждёт «${taskName(ctx,a.depends_on_task_id)}»`;
    if(a.type==="remove_dependency")return `${n}Убрать зависимость «${taskName(ctx,a.task_id)}» от «${taskName(ctx,a.depends_on_task_id)}»`;
    if(a.type==="set_checklist_item")return `${n}${a.done?"Отметить выполненным":"Вернуть в работу"} пункт «${a.label}» в «${taskName(ctx,a.task_id)}»`;
    if(a.type==="resolve_deadline_request")return `${n}${a.decision==="approved"?"Согласовать":"Отклонить"} запрос переноса срока`;
    if(a.type==="create_project")return `${n}Создать проект «${a.project_name}»`;
    if(a.type==="update_project")return `${n}Изменить проект «${projectName(ctx,a.project_id)}»`;
    if(a.type==="create_recurring_rule")return `${n}Создать регулярное правило «${a.title}» для ${staffName(ctx,a.assignee_id)}`;
    if(a.type==="update_recurring_rule")return `${n}Изменить регулярное правило`;
    if(a.type==="update_member")return `${n}Изменить сотрудника ${staffName(ctx,a.member_id)}${a.member_role?`\n• роль → ${a.member_role}`:""}${typeof a.member_is_active==="boolean"?`\n• доступ → ${a.member_is_active?"включить":"отключить"}`:""}${a.full_name?`\n• имя → ${a.full_name}`:""}`;
    if(a.type==="invite_member")return `${n}Пригласить сотрудника\nИмя: ${a.full_name}\nEmail: ${a.email}\nРоль: ${a.member_role}`;
    return `${n}Выполнить действие`;});
  return [actions.length>1?`Подтвердить пакет из ${actions.length} действий?`:"Подтвердить действие?","",...blocks].join("\n\n").slice(0,3900);
}
export function renderV3Result(ctx:V3Context,actions:JarvisV3Action[]){
  if(actions.length===1){const a=actions[0];if(a.type==="create_task")return `Задача создана: ${a.title}`;if(a.type==="update_task")return `Готово. Задача «${taskName(ctx,a.task_id)}» обновлена.`;if(a.type==="delete_task")return "Задача удалена.";if(a.type==="add_comment")return `Комментарий добавлен к «${taskName(ctx,a.task_id)}».`;if(a.type==="update_member")return "Данные сотрудника обновлены.";if(a.type==="invite_member")return `Приглашение отправлено: ${a.full_name}.`;if(a.type==="create_project")return `Проект создан: ${a.project_name}`;if(a.type==="update_project")return "Проект обновлён.";if(a.type==="create_recurring_rule")return `Регулярное правило создано: ${a.title}`;if(a.type==="update_recurring_rule")return "Регулярное правило обновлено.";}
  return `Готово. Выполнено действий: ${actions.length}.`;
}
export async function executeInviteMember(ctx:V3Context,a:JarvisV3Action,redirectTo:string){
  if(ctx.me.role!=="owner"||a.type!=="invite_member"||!a.email||!a.full_name||!a.member_role)throw new Error("Invite denied");
  const email=a.email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Invalid email");
  const invited=await ctx.admin.auth.admin.inviteUserByEmail(email,{data:{full_name:a.full_name.trim()},redirectTo});
  if(invited.error||!invited.data.user)throw invited.error||new Error("Invite failed");
  const saved=await ctx.admin.from("profiles").upsert({id:invited.data.user.id,full_name:a.full_name.trim().slice(0,100),role:a.member_role,is_active:true});
  if(saved.error)throw saved.error;
}
