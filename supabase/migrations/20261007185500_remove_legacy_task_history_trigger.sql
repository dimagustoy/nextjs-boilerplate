begin;
-- NU OS now uses nu_task_audit_trigger as the single task audit source.
-- The legacy task_history_trigger duplicated every insert/update and, for
-- service-role Jarvis writes, recorded a null actor which caused self-notifications.
drop trigger if exists task_history_trigger on public.tasks;
commit;
