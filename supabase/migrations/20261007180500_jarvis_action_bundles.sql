begin;
create table if not exists public.jarvis_action_bundles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id bigint not null,
  actions jsonb not null check (jsonb_typeof(actions) = 'array'),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  created_at timestamptz not null default now()
);
alter table public.jarvis_action_bundles enable row level security;
revoke all on public.jarvis_action_bundles from public, anon, authenticated;
grant select, insert, delete on public.jarvis_action_bundles to service_role;
create index if not exists jarvis_action_bundles_user_created_idx on public.jarvis_action_bundles(user_id, created_at desc);
commit;
