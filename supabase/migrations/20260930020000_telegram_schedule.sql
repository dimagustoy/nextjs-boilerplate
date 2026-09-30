-- Run separately AFTER deploying the bot and configuring Vercel and Vault.
-- Enable pg_net under Database → Extensions. Cron is already enabled.
-- Create Vault secret named nu_telegram_dispatch_secret, identical to the
-- server-only TELEGRAM_DISPATCH_SECRET in Vercel. Never commit its value.
begin;
create or replace function public.nu_telegram_dispatch_tick() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_secret text; v_request bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='nu_telegram_dispatch_secret';
  if v_secret is null or length(v_secret)<32 then raise exception 'Telegram dispatch secret is not configured'; end if;
  select net.http_post(
    url := 'https://nextjs-boilerplate-nu-team2.vercel.app/api/telegram/dispatch',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request;
  return v_request;
end $$;
revoke all on function public.nu_telegram_dispatch_tick() from public,anon,authenticated;
select cron.schedule('nu-telegram-dispatch','* * * * *', 'select public.nu_telegram_dispatch_tick();');
commit;
