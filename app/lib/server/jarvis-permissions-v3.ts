import type { JarvisV3Action, V3Context } from "./jarvis-agent-v3";

const EMPLOYEE_STATUSES=new Set(["accepted","in_progress","waiting","at_risk","review"]);
const emptyManagedFields=(a:JarvisV3Action):JarvisV3Action=>({
  ...a,
  assignee_id:null,project_id:null,title:null,description:null,expected_result:null,priority:null,
  waiting_for:null,risk_reason:null,clear_description:null,clear_project:null,clear_waiting_for:null,clear_risk_reason:null,
});

export function sanitizeV3Actions(ctx:V3Context,actions:JarvisV3Action[]){
  if(ctx.me.role==="owner")return actions;
  const assignable=new Set(ctx.assignable.map(p=>p.id));
  const tasks=new Map(ctx.visibleTasks.map(t=>[t.id,t]));
  const result:JarvisV3Action[]=[];

  for(const original of actions){
    let a={...original};
    const task=a.task_id?tasks.get(a.task_id):undefined;

    if(ctx.me.role==="manager"){
      if(a.type==="create_task"){
        if(a.assignee_id&&assignable.has(a.assignee_id))result.push(a);
        continue;
      }
      if(a.type==="update_task"){
        if(!task)continue;
        if(assignable.has(task.assignee_id)){result.push(a);continue;}
        if(task.assignee_id!==ctx.me.id)continue;
        a=emptyManagedFields(a);
        if(a.status==="completed")a.status="review";
        if(a.status&&!EMPLOYEE_STATUSES.has(a.status))a.status=null;
        if(a.status||a.deadline)result.push(a);
        continue;
      }
      if(a.type==="add_comment"){if(task)result.push(a);continue;}
      if(a.type==="set_checklist_item"){if(task&&(task.assignee_id===ctx.me.id||assignable.has(task.assignee_id)))result.push(a);continue;}
      if(a.type==="add_dependency"||a.type==="remove_dependency"){if(task&&assignable.has(task.assignee_id))result.push(a);continue;}
      if(a.type==="resolve_deadline_request"){result.push(a);continue;}
      continue;
    }

    // SMM and senior master: their own execution flow only.
    if(a.type==="update_task"){
      if(!task||task.assignee_id!==ctx.me.id)continue;
      a=emptyManagedFields(a);
      if(a.status==="completed")a.status="review";
      if(a.status&&!EMPLOYEE_STATUSES.has(a.status))a.status=null;
      if(a.status||a.deadline)result.push(a);
      continue;
    }
    if(a.type==="add_comment"){if(task)result.push(a);continue;}
    if(a.type==="set_checklist_item"){if(task?.assignee_id===ctx.me.id)result.push(a);continue;}
  }
  return result;
}
