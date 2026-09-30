-- Run separately after enabling Supabase Cron under Integrations → Cron.
-- 02:00 UTC = 07:00 in Yekaterinburg. Create this and next month's tasks.
select cron.schedule('nu-recurring-monthly-tasks', '0 2 * * *', $$
  select public.nu_generate_recurring(date_trunc('month', now() at time zone 'Asia/Yekaterinburg')::date);
  select public.nu_generate_recurring((date_trunc('month', now() at time zone 'Asia/Yekaterinburg') + interval '1 month')::date);
$$);
