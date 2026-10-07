export const prioritySchema = { type: "string", enum: ["low", "normal", "high", "critical"] };
export const statusSchema = { type: "string", enum: ["new", "accepted", "in_progress", "waiting", "at_risk", "review", "completed"] };

function nullable(type: Record<string, unknown>) { return { anyOf: [type, { type: "null" }] }; }
function strictAction(type: string, properties: Record<string, unknown>) {
  const all = { type: { type: "string", enum: [type] }, ...properties };
  return { type: "object", additionalProperties: false, properties: all, required: Object.keys(all) };
}

export const compactOperationSchema = {
  anyOf: [
    strictAction("create_task", { assignee_id: { type: "string" }, project_id: nullable({ type: "string" }), title: { type: "string" }, description: nullable({ type: "string" }), expected_result: { type: "string" }, priority: prioritySchema, deadline: { type: "string" } }),
    strictAction("update_task", { task_id: { type: "string" }, priority: nullable(prioritySchema), status: nullable(statusSchema), assignee_id: nullable({ type: "string" }), project_id: nullable({ type: "string" }), title: nullable({ type: "string" }), description: nullable({ type: "string" }), expected_result: nullable({ type: "string" }), deadline: nullable({ type: "string" }), reason: nullable({ type: "string" }), waiting_for: nullable({ type: "string" }), risk_reason: nullable({ type: "string" }), clear_description: { type: "boolean" }, clear_project: { type: "boolean" }, clear_waiting_for: { type: "boolean" }, clear_risk_reason: { type: "boolean" } }),
    strictAction("add_comment", { task_id: { type: "string" }, body: { type: "string" } }),
    strictAction("add_dependency", { task_id: { type: "string" }, depends_on_task_id: { type: "string" } }),
    strictAction("remove_dependency", { task_id: { type: "string" }, depends_on_task_id: { type: "string" } }),
    strictAction("set_checklist_item", { task_id: { type: "string" }, item_index: { type: "integer" }, label: { type: "string" }, done: { type: "boolean" } }),
    strictAction("resolve_deadline_request", { request_id: { type: "string" }, decision: { type: "string", enum: ["approved", "rejected"] }, reason: nullable({ type: "string" }) }),
    strictAction("create_project", { project_name: { type: "string" }, project_description: nullable({ type: "string" }) }),
    strictAction("update_project", { project_id: { type: "string" }, project_name: nullable({ type: "string" }), project_description: nullable({ type: "string" }), clear_description: { type: "boolean" }, project_is_active: nullable({ type: "boolean" }) }),
    strictAction("create_recurring_rule", { title: { type: "string" }, expected_result: { type: "string" }, description: nullable({ type: "string" }), assignee_id: { type: "string" }, project_id: nullable({ type: "string" }), priority: prioritySchema, frequency: { type: "string", enum: ["daily", "weekly", "monthly"] }, month_pattern: { type: "string", enum: ["all", "odd", "even"] }, due_kind: { type: "string", enum: ["day", "last_day", "last_weekday"] }, due_day: nullable({ type: "integer" }), due_weekday: nullable({ type: "integer" }), due_time: { type: "string" }, reminder_mode: nullable({ type: "string", enum: ["offsets", "month_day"] }), reminder_day: nullable({ type: "integer" }), reminder_days: nullable({ type: "array", items: { type: "integer" } }), starts_on: { type: "string" }, is_active: { type: "boolean" } }),
    strictAction("update_recurring_rule", { recurring_id: { type: "string" }, title: nullable({ type: "string" }), expected_result: nullable({ type: "string" }), description: nullable({ type: "string" }), assignee_id: nullable({ type: "string" }), project_id: nullable({ type: "string" }), priority: nullable(prioritySchema), frequency: nullable({ type: "string", enum: ["daily", "weekly", "monthly"] }), month_pattern: nullable({ type: "string", enum: ["all", "odd", "even"] }), due_kind: nullable({ type: "string", enum: ["day", "last_day", "last_weekday"] }), due_day: nullable({ type: "integer" }), due_weekday: nullable({ type: "integer" }), due_time: nullable({ type: "string" }), reminder_mode: nullable({ type: "string", enum: ["offsets", "month_day"] }), reminder_day: nullable({ type: "integer" }), reminder_days: nullable({ type: "array", items: { type: "integer" } }), starts_on: nullable({ type: "string" }), is_active: nullable({ type: "boolean" }) }),
    strictAction("create_reminder", { task_id: nullable({ type: "string" }), body: { type: "string" }, remind_at: { type: "string" } }),
    strictAction("cancel_reminder", { reminder_id: { type: "string" } })
  ]
};

export const jarvisResponseSchema = { type: "object", additionalProperties: false, properties: { mode: { type: "string", enum: ["reply", "action"] }, reply: { anyOf: [{ type: "string" }, { type: "null" }] }, actions: { type: "array", items: compactOperationSchema, maxItems: 20 } }, required: ["mode", "reply", "actions"] };
