-- 0004_heaven_strategies.sql
-- Heaven strategies persistence (public and per-user)

create table if not exists public.heaven_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  symbol text not null,
  tf text not null,
  name text,
  params jsonb not null,
  metrics jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists heaven_strategies_lookup
  on public.heaven_strategies(user_id, symbol, tf, created_at desc);

-- RLS
alter table public.heaven_strategies enable row level security;

-- Owner policies
create policy heaven_strategies_select
  on public.heaven_strategies for select
  using (user_id is not null and auth.uid() = user_id);
create policy heaven_strategies_insert
  on public.heaven_strategies for insert
  with check (user_id is not null and auth.uid() = user_id);
create policy heaven_strategies_update
  on public.heaven_strategies for update
  using (user_id is not null and auth.uid() = user_id)
  with check (user_id is not null and auth.uid() = user_id);
create policy heaven_strategies_delete
  on public.heaven_strategies for delete
  using (user_id is not null and auth.uid() = user_id);

-- Public (no-auth) policies for rows with user_id IS NULL
create policy heaven_strategies_public_select
  on public.heaven_strategies for select
  using (user_id is null);
create policy heaven_strategies_public_insert
  on public.heaven_strategies for insert
  with check (user_id is null);
create policy heaven_strategies_public_update
  on public.heaven_strategies for update
  using (user_id is null)
  with check (user_id is null);
create policy heaven_strategies_public_delete
  on public.heaven_strategies for delete
  using (user_id is null);

-- Ensure upsert works for public rows (unique by symbol+tf+name when user_id is null)
create unique index if not exists heaven_strategies_public_unique
  on public.heaven_strategies(symbol, tf, name)
  where user_id is null;