"use client";
import { useState } from "react";
import { Avatar, Icon } from "./ui";
import { monthAt, occurrences, type Schedule } from "../lib/recurring";
type Task={id:string;title:string;assignee_id:string;status:string;deadline:string;completed_at:string|null;priority?:string};
type Person={id:string;full_name:string;role:string;is_active:boolean};
export type Rule=Schedule&{id:string;title:string;assignee_id:string;is_active:boolean};
export type Occurrence={template_id:string;period:string;task_id:string|null};
export type Pending={id:string;task_id:string;requested_deadline:string};
const statusName:Record<string,string>={new:"Новая",accepted:"Принята",in_progress:"В работе",waiting:"Ожидание",at_risk:"Под угрозой",review:"На проверке",completed:"Завершена"};
const date=(d:string)=>new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",day:"numeric",month:"short"}).format(new Date(d));
const fullDate=(d:string)=>new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(d));
const localDay=(n:number)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yekaterinburg",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(n));
export default function Overview({tasks,staff,requests,rules,instances,me,clock,open,showTasks,showCalendar,showTeam}:{tasks:Task[];staff:Person[];requests:Pending[];rules:Rule[];instances:Occurrence[];me:Person;clock:number;open:(id:string)=>void;showTasks:(filter:string)=>void;showCalendar:()=>void;showTeam:()=>void}) {
 const [period,setPeriod]=useState("today"); const [employee,setEmployee]=useState("");
 const late=(t:Task)=>t.status!=="completed"&&Date.parse(t.deadline)<clock;
 const active=tasks.filter(t=>t.status!=="completed"); const delayed=tasks.filter(late); const review=tasks.filter(t=>t.status==="review");
 const done=tasks.filter(t=>t.status==="completed"&&t.completed_at&&Date.parse(t.completed_at)>=clock-7*86400000&&Date.parse(t.completed_at)<=clock);
 const canManage=(t:Task)=>me.role==="owner"||me.role==="manager"&&["smm","senior_master"].includes(staff.find(p=>p.id===t.assignee_id)?.role||"");
 const decisions=requests.filter(r=>{const t=tasks.find(t=>t.id===r.task_id);return t&&canManage(t);});
 const risk=(t:Task)=>{
   const ms=Date.parse(t.deadline)-clock;
   const hours=ms/3600000;
   const priority=t.priority||"normal";
   if(late(t)) return {level:"critical" as const,label:"🔴 Критично",reason:"Дедлайн уже нарушен",rank:3};
   if(t.status==="at_risk"&&hours<=48) return {level:"critical" as const,label:"🔴 Критично",reason:"Задача под угрозой, до дедлайна меньше 48 часов",rank:3};
   if(t.status==="at_risk") return {level:"risk" as const,label:"🟡 Риск",reason:"Исполнитель отметил задачу как проблемную",rank:2};
   if(hours<=24) return {level:"risk" as const,label:"🟡 Риск",reason:"До дедлайна меньше суток",rank:2};
   if(hours<=48) return {level:"risk" as const,label:"🟡 Риск",reason:"До дедлайна меньше 48 часов",rank:2};
   if((priority==="high"||priority==="critical")&&hours<=72) return {level:"risk" as const,label:"🟡 Риск",reason:"Высокий приоритет и близкий дедлайн",rank:2};
   return {level:"normal" as const,label:"🟢 Норма",reason:"По срокам всё спокойно",rank:1};
 };
 const decisionFor=(t:Task)=>decisions.find(r=>r.task_id===t.id);
 const ownerDecision=(t:Task)=>{
   const request=decisionFor(t);
   if(request) return {label:"Согласовать срок",kind:"decision" as const,rank:5,reason:`Запрошен новый срок: ${fullDate(request.requested_deadline)}`};
   if(t.status==="review"&&canManage(t)) return {label:"Проверить",kind:"review" as const,rank:4,reason:"Исполнитель ждёт проверки результата"};
   const r=risk(t);
   if(r.level==="critical") return {label:"Вмешаться",kind:"critical" as const,rank:3,reason:r.reason};
   if(r.level==="risk") return {label:"Проверить риск",kind:"risk" as const,rank:2,reason:r.reason};
   return null;
 };
 const attention=active.map(t=>({task:t,decision:ownerDecision(t)})).filter(x=>x.decision).sort((a,b)=>(b.decision?.rank||0)-(a.decision?.rank||0)||risk(b.task).rank-risk(a.task).rank||Date.parse(a.task.deadline)-Date.parse(b.task.deadline));
 const directDecisionCount=active.filter(t=>Boolean(decisionFor(t))||(t.status==="review"&&canManage(t))).length;
 const criticalCount=active.filter(t=>risk(t).level==="critical").length;
 const paymentPattern=/(аренд|\bку\b|коммунал|электро|оплат|плат[её]ж)/iu;
 // JS word boundaries do not include Cyrillic; match the standalone abbreviation explicitly.
 const isPayment=(title:string)=>paymentPattern.test(title)||/(^|[^а-яё])ку([^а-яё]|$)/iu.test(title);
 const payments=active.filter(t=>isPayment(t.title)).map(t=>({key:t.id,title:t.title,deadline:t.deadline,taskId:t.id,planned:false}));
 for(const r of rules.filter(r=>r.is_active&&isPayment(r.title))) for(const offset of [0,1]) {
   const monthlyInstances=instances.filter(i=>i.template_id===r.id&&i.period.slice(0,7)===monthAt(offset).slice(0,7));
   for(const o of occurrences(r,monthAt(offset))) {
     if(monthlyInstances.some(i=>i.period===o.due||r.frequency==="monthly"))continue;
     const deadline=`${o.due}T${r.due_time.slice(0,5)}:00+05:00`;
     if(Date.parse(deadline)<clock)continue;
     payments.push({key:`${r.id}:${o.due}`,title:r.title,deadline,taskId:"",planned:true});
   }
 }
 payments.sort((a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline));
 const teamTasks=tasks.filter(t=>(!employee||t.assignee_id===employee)&&(period==="today"?localDay(Date.parse(t.deadline))===localDay(clock):Date.parse(t.deadline)>=clock&&Date.parse(t.deadline)<clock+7*86400000));
 const people=staff.filter(p=>p.is_active&&p.role!=="owner");
 const workload=(p:Person)=>active.filter(t=>t.assignee_id===p.id).reduce((sum,t)=>{
   const priorityWeight:Record<string,number>={low:.7,normal:1,high:1.6,critical:2.4};
   const hours=(Date.parse(t.deadline)-clock)/3600000;
   let urgency=0;
   if(hours<0) urgency=2.2;
   else if(hours<=24) urgency=1.5;
   else if(hours<=72) urgency=.8;
   else if(hours<=168) urgency=.3;
   const state=t.status==="at_risk"?1.5:t.status==="waiting"?.4:0;
   return sum+(priorityWeight[t.priority||"normal"]||1)+urgency+state;
 },0);
 const loads=people.map(p=>({p,score:workload(p)})); const maxLoad=Math.max(1,...loads.map(x=>x.score));
 return <div className="nu-overview">
  <div className="nu-stats">{([{label:"Активные задачи",value:active.length,icon:"tasks",tone:"plain",filter:"active"},{label:"Требуют решения",value:directDecisionCount,icon:"clock",tone:"orange",filter:"attention"},{label:"Критический риск",value:criticalCount,icon:"alert",tone:"danger",filter:"attention"},{label:"Завершено за 7 дней",value:done.length,icon:"check",tone:"success",filter:"done-week"}] as const).map(s=><button key={s.label} className={`nu-stat nu-stat-${s.tone}`} onClick={()=>showTasks(s.filter)}><span className="nu-stat-icon"><Icon name={s.icon} size={22}/></span><span><span className="nu-stat-label">{s.label}</span><strong>{s.value}</strong></span><span className="nu-stat-arrow"><Icon name="arrow" size={16}/></span></button>)}</div>
  <div className="nu-overview-grid">
   <section className="nu-card"><div className="nu-section-heading"><div><h2>Центр решений</h2><p>Ваши решения: {directDecisionCount} · Критический риск: {criticalCount}</p></div><span className="nu-count">{attention.length}</span></div>
    <div className="nu-attention">{attention.slice(0,5).map(({task:t,decision})=>{const person=staff.find(p=>p.id===t.assignee_id);const r=risk(t);return <button className="nu-attention-row" key={t.id} onClick={()=>open(t.id)}><span className={`nu-task-icon ${r.level==="critical"?"is-late":""}`}><Icon name={r.level==="critical"?"alert":"tasks"}/></span><span className="nu-attention-body"><strong>{t.title}</strong><small>{decision?.reason} · Дедлайн: {fullDate(t.deadline)}</small></span><span className={`nu-badge ${r.level==="critical"?"nu-badge-danger":decision?.kind==="decision"||decision?.kind==="review"?"nu-badge-orange":"nu-badge-muted"}`}>{decision?.label}</span><span className="nu-attention-person"><Avatar name={person?.full_name||"Сотрудник"} small/></span><span className="nu-action-label">Открыть<Icon name="arrow" size={14}/></span></button>;})}
    {!attention.length&&<div className="nu-empty"><span className="nu-empty-icon"><Icon name="check" size={26}/></span><h3>Всё спокойно</h3><p>Нет задач, где прямо сейчас требуется ваше решение или вмешательство.</p></div>}
    {attention.length>5&&<button className="nu-link" onClick={()=>showTasks("attention")}>Все решения и риски <Icon name="arrow" size={15}/></button>}</div>
   </section>
   <section className="nu-card"><div className="nu-section-heading"><h2>Ближайшие платежи</h2><Icon name="wallet"/></div><div className="nu-payments">{payments.slice(0,4).map(p=><button key={p.key} className="nu-payment" onClick={()=>p.taskId?open(p.taskId):showCalendar()}><span className="nu-date-tile"><b>{new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",day:"2-digit"}).format(new Date(p.deadline))}</b><small>{new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",month:"short"}).format(new Date(p.deadline)).replace(".","")}</small></span><span><strong>{p.title}</strong><small>{Date.parse(p.deadline)<clock?"Срок прошёл":p.planned?"По расписанию":"Задача создана"}</small></span><Icon name="arrow" size={16}/></button>)}{!payments.length&&<p className="nu-muted py-6 text-sm">Ближайших платежей пока нет. Добавьте правило в разделе «Регулярные».</p>}</div><button className="nu-link" onClick={showCalendar}>Открыть календарь <Icon name="arrow" size={15}/></button></section>
   <section className="nu-card"><div className="nu-section-heading nu-heading-wrap"><h2>Задачи команды</h2><div className="nu-segment"><button className={period==="today"?"active":""} onClick={()=>setPeriod("today")}>Сегодня</button><button className={period==="week"?"active":""} onClick={()=>setPeriod("week")}>7 дней</button></div><select aria-label="Сотрудник в обзоре" className="nu-compact-select" value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">Все сотрудники</option>{staff.filter(p=>p.is_active).map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
    <div className="nu-team-table"><div className="nu-table-head"><span>Задача</span><span>Сотрудник</span><span>Риск</span><span>Срок</span></div>{teamTasks.slice(0,6).map(t=>{const r=risk(t);return <button key={t.id} className="nu-team-row" onClick={()=>open(t.id)}><strong>{t.title}</strong><span className="nu-person-inline"><Avatar name={staff.find(p=>p.id===t.assignee_id)?.full_name||"Сотрудник"} small/><span>{staff.find(p=>p.id===t.assignee_id)?.full_name}</span></span><span className={`nu-status-text status-${r.level==="critical"?"at_risk":t.status}`}>{r.label}</span><time className={r.level==="critical"?"nu-danger":""}>{date(t.deadline)}, {new Intl.DateTimeFormat("ru-RU",{timeZone:"Asia/Yekaterinburg",hour:"2-digit",minute:"2-digit"}).format(new Date(t.deadline))}</time></button>})}{!teamTasks.length&&<div className="nu-empty-small">На этот период задач нет</div>}</div><button className="nu-link" onClick={()=>showTasks(period)}>Все задачи <Icon name="arrow" size={15}/></button>
   </section>
   <section className="nu-card"><div className="nu-section-heading"><h2>Загрузка команды</h2><button className="nu-icon-button" aria-label="Открыть команду" onClick={showTeam}><Icon name="arrow" size={17}/></button></div><p className="nu-muted mb-5 text-xs">Взвешенная нагрузка: приоритет + близость дедлайна + просрочки + риск</p><div className="nu-workload">{loads.slice().sort((a,b)=>b.score-a.score).slice(0,5).map(({p,score})=>{const count=active.filter(t=>t.assignee_id===p.id).length;const lateCount=delayed.filter(t=>t.assignee_id===p.id).length;const risky=active.filter(t=>t.assignee_id===p.id&&risk(t).level!=="normal").length;return <div key={p.id}><div className="nu-workload-label"><span>{p.full_name}</span><b>{score.toFixed(1)}</b></div><div className="nu-progress"><span style={{width:`${score/maxLoad*100}%`}}/></div><small className={lateCount?"nu-danger":"nu-muted"}>{count} активных · {risky} в риске{lateCount?` · просрочено: ${lateCount}`:""}</small></div>;})}{!people.length&&<p className="nu-muted text-sm">Добавьте сотрудников в команду.</p>}</div></section>
  </div>
 </div>;
}
