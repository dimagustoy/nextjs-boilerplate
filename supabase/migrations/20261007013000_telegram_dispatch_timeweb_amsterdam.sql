-- Move Telegram notification dispatch from the legacy Vercel endpoint to
-- the Amsterdam Timeweb App Platform production instance.
begin;

create or replace function public.nu_telegram_dispatch_tick() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_secret text; v_request bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'nu_telegram_dispatch_secret';

  if v_secret is null or length(v_secret) < 32 then
    raise exception 'Telegram dispatch secret is not configured';
  end if;

  select net.http_post(
    url := 'https://dimagustoy-nextjs-boilerplate-313b.twc1.net/api/telegram/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request;

  return v_request;
end $$;

revoke all on function public.nu_telegram_dispatch_tick() from public, anon, authenticated;

commit;
