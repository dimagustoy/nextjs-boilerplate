create or replace function public.nu_effective_actor() returns uuid
language plpgsql stable security invoker set search_path = public
as $$
declare v text;
begin
  v := nullif(current_setting('nu.jarvis_actor', true), '');
  if v is not null then return v::uuid; end if;
  return auth.uid();
end $$;
