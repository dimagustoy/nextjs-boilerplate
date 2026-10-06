-- Let the Timeweb dispatch endpoint validate the cron bearer token against
-- the single source of truth in Supabase Vault. This removes the need to keep
-- a duplicate TELEGRAM_DISPATCH_SECRET synchronized across hosts.
begin;

create or replace function public.nu_telegram_dispatch_authorize(p_secret text) returns boolean
language sql stable security definer set search_path = public, vault
as $$
  select coalesce(
    p_secret is not null
    and length(p_secret) >= 32
    and p_secret = (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'nu_telegram_dispatch_secret'
      limit 1
    ),
    false
  )
$$;

revoke all on function public.nu_telegram_dispatch_authorize(text) from public, anon, authenticated;
grant execute on function public.nu_telegram_dispatch_authorize(text) to service_role;

commit;
