-- Run separately after enabling Supabase Cron under Integrations → Cron.
-- 03:00 UTC = 08:00 in Yekaterinburg. Create this and next month's tasks.
select cron.schedule('nu-recurring-monthly-tasks', '0 3 * * *', $$
  select public.nu_generate_recurring(date_trunc('month', now() at time zone 'Asia/Yekaterinburg')::date);
  select public.nu_generate_recurring((date_trunc('month', now() at time zone 'Asia/Yekaterinburg') + interval '1 month')::date);
$$);
