import type { JarvisV3Action, V3Context } from "./jarvis-agent-v3";

const TZ="Asia/Yekaterinburg";
const PRIORITY:Record<string,string>={low:"низкий",normal:"обычный",high:"высокий",critical:"критичный"};
const STATUS:Record<string,string>={new:"Новая",accepted:"Принята",in_progress:"В работе",waiting:"Ожидание",at_risk:"Под угрозой",review:"На проверке",completed:"Завершена"};
const FREQ:Record<string,string>={daily:"ежедневно",weekly:"еженедельно",monthly:"ежемесячно"};
function date(v:string){return new Intl.DateTimeFormat("ru-RU",{timeZone:TZ,dateStyle:"medium",timeStyle:"short"}).format(new Date(v));}
function task(ctx:V3Context,id:string|null){return ctx.visibleTasks.find(t=>t.id===id)?.title||"задача";}
function person(ctx:V3Context,id:string|null){return ctx.staff.find(p=>p.id===id)?.full_name||"сотрудник";}
function project(ctx:V3Context,id:string|null){return ctx.projects.find(p=>p.id===id)?.name||"Без проекта";}
function yesNo(v:boolean){return v?"да":"нет";}

export function renderV3ProposalDetailed(ctx:V3Context,actions:JarvisV3Action[]){
  const blocks=actions.map((a,i)=>{
    const n=actions.length>1?`${i+1}. `:"";
    if(a.type==="create_task")return `${n}Создать задачу «${a.title}»\n• исполнитель → ${person(ctx,a.assignee_id)}\n• проект → ${project(ctx,a.project_id)}\n• дедлайн → ${date(a.deadline!)}\n• приоритет → ${PRIORITY[a.priority||"normal"]}\n• результат → ${a.expected_result}${a.description?`\n• описание → ${a.description}`:""}`;
    if(a.type==="update_task"){
      const c:string[]=[];
      if(a.priority)c.push(`приоритет → ${PRIORITY[a.priority]}`);
      if(a.status)c.push(`статус → ${STATUS[a.status]}`);
      if(a.deadline)c.push(`дедлайн → ${date(a.deadline)}${a.reason?`\n  причина → ${a.reason}`:""}`);
      if(a.assignee_id)c.push(`исполнитель → ${person(ctx,a.assignee_id)}`);
      if(a.project_id)c.push(`проект → ${project(ctx,a.project_id)}`);
      if(a.clear_project)c.push("проект → убрать");
      if(a.title)c.push(`название → ${a.title}`);
      if(a.description)c.push(`описание → ${a.description}`);
      if(a.clear_description)c.push("описание → очистить");
      if(a.expected_result)c.push(`ожидаемый результат → ${a.expected_result}`);
      if(a.waiting_for)c.push(`ожидаем → ${a.waiting_for}`);
      if(a.clear_waiting_for)c.push("ожидание → очистить");
      if(a.risk_reason)c.push(`причина риска → ${a.risk_reason}`);
      if(a.clear_risk_reason)c.push("причина риска → очистить");
      return `${n}Изменить «${task(ctx,a.task_id)}»\n${c.map(x=>`• ${x}`).join("\n")||"• обновить задачу"}`;
    }
    if(a.type==="delete_task")return `${n}⚠️ УДАЛИТЬ ЗАДАЧУ БЕЗ ВОЗМОЖНОСТИ ВОССТАНОВЛЕНИЯ\n«${task(ctx,a.task_id)}»`;
    if(a.type==="add_comment")return `${n}Добавить комментарий к «${task(ctx,a.task_id)}»\n${a.body}`;
    if(a.type==="add_dependency")return `${n}Добавить зависимость\n«${task(ctx,a.task_id)}» ждёт «${task(ctx,a.depends_on_task_id)}»`;
    if(a.type==="remove_dependency")return `${n}Убрать зависимость\n«${task(ctx,a.task_id)}» больше не ждёт «${task(ctx,a.depends_on_task_id)}»`;
    if(a.type==="set_checklist_item")return `${n}${a.done?"Выполнить":"Вернуть в работу"} пункт «${a.label}»\nЗадача: «${task(ctx,a.task_id)}»`;
    if(a.type==="resolve_deadline_request")return `${n}${a.decision==="approved"?"Согласовать":"Отклонить"} запрос переноса срока${a.reason?`\nПричина: ${a.reason}`:""}`;
    if(a.type==="create_project")return `${n}Создать проект «${a.project_name}»${a.project_description?`\n• описание → ${a.project_description}`:""}${typeof a.project_is_active==="boolean"?`\n• активен → ${yesNo(a.project_is_active)}`:""}`;
    if(a.type==="update_project"){
      const c:string[]=[];if(a.project_name)c.push(`название → ${a.project_name}`);if(a.project_description)c.push(`описание → ${a.project_description}`);if(a.clear_description)c.push("описание → очистить");if(typeof a.project_is_active==="boolean")c.push(`активен → ${yesNo(a.project_is_active)}`);return `${n}Изменить проект «${project(ctx,a.project_id)}»\n${c.map(x=>`• ${x}`).join("\n")||"• обновить проект"}`;
    }
    if(a.type==="create_recurring_rule"||a.type==="update_recurring_rule"){
      const c:string[]=[];if(a.title)c.push(`название → ${a.title}`);if(a.assignee_id)c.push(`исполнитель → ${person(ctx,a.assignee_id)}`);if(a.project_id)c.push(`проект → ${project(ctx,a.project_id)}`);if(a.priority)c.push(`приоритет → ${PRIORITY[a.priority]}`);if(a.frequency)c.push(`повтор → ${FREQ[a.frequency]||a.frequency}`);if(a.due_time)c.push(`время → ${a.due_time}`);if(a.due_day)c.push(`день месяца → ${a.due_day}`);if(a.due_weekday)c.push(`день недели → ${a.due_weekday}`);if(a.reminder_days)c.push(`напоминания за → ${a.reminder_days.join(", ")} дн.`);if(a.starts_on)c.push(`начать → ${a.starts_on}`);if(typeof a.is_active==="boolean")c.push(`активно → ${yesNo(a.is_active)}`);if(a.expected_result)c.push(`результат → ${a.expected_result}`);return `${n}${a.type==="create_recurring_rule"?"Создать":"Изменить"} регулярное правило${a.title?` «${a.title}»`:""}\n${c.map(x=>`• ${x}`).join("\n")}`;
    }
    if(a.type==="update_member")return `${n}Изменить сотрудника ${person(ctx,a.member_id)}${a.full_name?`\n• имя → ${a.full_name}`:""}${a.member_role?`\n• роль → ${a.member_role}`:""}${typeof a.member_is_active==="boolean"?`\n• доступ → ${a.member_is_active?"включить":"отключить"}`:""}`;
    if(a.type==="invite_member")return `${n}Пригласить сотрудника\n• имя → ${a.full_name}\n• email → ${a.email}\n• роль → ${a.member_role}`;
    return `${n}Выполнить действие`;
  });
  return [actions.some(a=>a.type==="delete_task")?"⚠️ Подтвердить необратимое действие?":actions.length>1?`Подтвердить пакет из ${actions.length} действий?`:"Подтвердить действие?","",...blocks].join("\n\n").slice(0,3900);
}

export function renderV3ResultDetailed(ctx:V3Context,actions:JarvisV3Action[]){
  if(actions.length===1){const a=actions[0];if(a.type==="create_task")return `Задача создана: ${a.title}`;if(a.type==="update_task")return `Готово. Задача «${task(ctx,a.task_id)}» обновлена.`;if(a.type==="delete_task")return "Задача удалена.";if(a.type==="add_comment")return `Комментарий добавлен к «${task(ctx,a.task_id)}».`;if(a.type==="update_member")return "Данные сотрудника обновлены.";if(a.type==="invite_member")return `Приглашение отправлено: ${a.full_name}.`;if(a.type==="create_project")return `Проект создан: ${a.project_name}`;if(a.type==="update_project")return "Проект обновлён.";if(a.type==="create_recurring_rule")return `Регулярное правило создано: ${a.title}`;if(a.type==="update_recurring_rule")return "Регулярное правило обновлено.";if(a.type==="resolve_deadline_request")return a.decision==="approved"?"Перенос срока согласован.":"Перенос срока отклонён.";}
  return `Готово. Выполнено действий: ${actions.length}.`;
}
