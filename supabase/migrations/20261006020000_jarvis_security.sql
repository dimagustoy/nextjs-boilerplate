begin;

-- Internal helpers are called only by trusted SECURITY DEFINER guards/RPCs.
-- They must not be exposed as callable Data API endpoints.
revoke all on function public.nu_actor_role(uuid) from public, anon, authenticated;
revoke all on function public.nu_actor_can_assign(uuid, uuid) from public, anon, authenticated;
revoke all on function public.nu_actor_can_view_task(uuid, public.tasks) from public, anon, authenticated;

-- Trigger functions are invoked by Postgres, not directly by API clients.
revoke all on function public.nu_task_guard() from public, anon, authenticated;
revoke all on function public.nu_task_audit() from public, anon, authenticated;
revoke all on function public.nu_deadline_guard() from public, anon, authenticated;
revoke all on function public.nu_deadline_audit() from public, anon, authenticated;

commit;
