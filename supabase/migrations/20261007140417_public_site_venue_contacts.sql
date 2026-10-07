-- Public venue information; existing owner/manager write policies remain unchanged.
alter table public.site_locations
  add column if not exists telegram_channel_url text,
  add column if not exists vk_group_url text,
  add column if not exists booking_telegram_url text,
  add column if not exists booking_max_url text,
  add column if not exists booking_whatsapp_url text,
  add column if not exists has_kitchen boolean,
  add column if not exists has_spirits boolean,
  add column if not exists has_beer boolean,
  add column if not exists has_console boolean;

-- Owner-confirmed amenities. Beer remains unknown until confirmed separately.
update public.site_locations
set has_console = true,
    has_kitchen = city in ('Иваново', 'Кострома'),
    has_spirits = city in ('Иваново', 'Кострома'),
    updated_at = now()
where is_published = true;

-- Keep copy consistent with the owner-confirmed kitchen availability.
update public.site_locations
set short_description = replace(short_description, 'характером, кухней и пространством', 'характером и пространством')
where slug = 'ekb-beloglazova-2g';
