ALTER TABLE public.site_locations
  ADD COLUMN IF NOT EXISTS phone_secondary text,
  ADD COLUMN IF NOT EXISTS booking_telegram_secondary_url text;
