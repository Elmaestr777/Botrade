-- 0001_init_heaven.sql
-- Initial schema for palmarès, strategy evaluations, wallets, and API credentials (Supabase/Postgres)

-- Extensions
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- Profiles for Lab scoring (per-user or public)
create table if not exists public.lab_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  description text,
  weights jsonb not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
-- Ensure public profiles have unique names across all users
create unique index if not exists lab_profiles_public_name_unique
  on public.lab_profiles(name) where is_public;

-- Palmarès set (one per symbol + timeframe + profile + run)
create table if not exists public.palmares_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  symbol text not null,
  tf text not null,
  profile_id uuid references public.lab_profiles(id) on delete set null,
  top_n integer not null default 20,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists palmares_sets_lookup
  on public.palmares_sets(user_id, symbol, tf, profile_id, created_at desc);

-- Palmarès entries (top-N rows within a set)
create table if not exists public.palmares_entries (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.palmares_sets(id) on delete cascade,
  rank integer not null,
  name text,
  params jsonb not null,
  metrics jsonb not null,
  score double precision not null,
  provenance text,
  generation integer,
  created_at timestamptz not null default now(),
  unique (set_id, rank)
);
create index if not exists palmares_entries_by_set
  on public.palmares_entries(set_id, rank asc);
create index if not exists palmares_entries_score_desc
  on public.palmares_entries(set_id, score desc);

-- Strategy evaluations (tested strategies, including non-selected)
create table if not exists public.strategy_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  symbol text not null,
  tf text not null,
  profile_id uuid references public.lab_profiles(id) on delete set null,
  params jsonb not null,
  metrics jsonb,
  score double precision,
  selected boolean not null default false,
  palmares_set_id uuid references public.palmares_sets(id) on delete set null,
  provenance text,
  run_context jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, symbol, tf, profile_id, params)
);
create index if not exists strategy_evaluations_lookup
  on public.strategy_evaluations(user_id, symbol, tf, profile_id, created_at desc);
create index if not exists strategy_evaluations_score_desc
  on public.strategy_evaluations(user_id, symbol, tf, profile_id, score desc);

-- API credentials reference (store reference to Supabase Vault secret or external secret manager)
create table if not exists public.api_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  exchange text not null,
  label text not null,
  vault_ref text not null, -- reference to a secret in Supabase Vault (do not store raw keys here)
  scopes text[] default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exchange, label)
);
create index if not exists api_credentials_user_idx
  on public.api_credentials(user_id, exchange);

-- Live wallets
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  exchange text not null,
  base_currency text not null default 'USDC',
  paper boolean not null default true,
  leverage numeric(10,2) default 1,
  account_id uuid references public.api_credentials(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists wallets_user_idx
  on public.wallets(user_id, exchange);

-- RLS: enable and policies
alter table public.lab_profiles enable row level security;
alter table public.palmares_sets enable row level security;
alter table public.palmares_entries enable row level security;
alter table public.strategy_evaluations enable row level security;
alter table public.api_credentials enable row level security;
alter table public.wallets enable row level security;

-- lab_profiles policies
create policy lab_profiles_select
  on public.lab_profiles for select
  using (is_public or (user_id is not null and auth.uid() = user_id));
create policy lab_profiles_insert
  on public.lab_profiles for insert
  with check (user_id is not null and auth.uid() = user_id);
create policy lab_profiles_modify
  on public.lab_profiles for update
  using (user_id is not null and auth.uid() = user_id)
  with check (user_id is not null and auth.uid() = user_id);
create policy lab_profiles_delete
  on public.lab_profiles for delete
  using (user_id is not null and auth.uid() = user_id);

-- palmares_sets policies
create policy palmares_sets_select
  on public.palmares_sets for select
  using (user_id is not null and auth.uid() = user_id);
create policy palmares_sets_insert
  on public.palmares_sets for insert
  with check (user_id is not null and auth.uid() = user_id);
create policy palmares_sets_modify
  on public.palmares_sets for update
  using (user_id is not null and auth.uid() = user_id)
  with check (user_id is not null and auth.uid() = user_id);
create policy palmares_sets_delete
  on public.palmares_sets for delete
  using (user_id is not null and auth.uid() = user_id);

-- palmares_entries policies (auth via parent set)
create policy palmares_entries_select
  on public.palmares_entries for select
  using (exists (select 1 from public.palmares_sets s where s.id = set_id and s.user_id is not null and s.user_id = auth.uid()));
create policy palmares_entries_insert
  on public.palmares_entries for insert
  with check (exists (select 1 from public.palmares_sets s where s.id = set_id and s.user_id is not null and s.user_id = auth.uid()));
create policy palmares_entries_modify
  on public.palmares_entries for update
  using (exists (select 1 from public.palmares_sets s where s.id = set_id and s.user_id is not null and s.user_id = auth.uid()))
  with check (exists (select 1 from public.palmares_sets s where s.id = set_id and s.user_id is not null and s.user_id = auth.uid()));
create policy palmares_entries_delete
  on public.palmares_entries for delete
  using (exists (select 1 from public.palmares_sets s where s.id = set_id and s.user_id is not null and s.user_id = auth.uid()));

-- strategy_evaluations policies
create policy strategy_evaluations_select
  on public.strategy_evaluations for select
  using (user_id is not null and auth.uid() = user_id);
create policy strategy_evaluations_insert
  on public.strategy_evaluations for insert
  with check (user_id is not null and auth.uid() = user_id);
create policy strategy_evaluations_modify
  on public.strategy_evaluations for update
  using (user_id is not null and auth.uid() = user_id)
  with check (user_id is not null and auth.uid() = user_id);
create policy strategy_evaluations_delete
  on public.strategy_evaluations for delete
  using (user_id is not null and auth.uid() = user_id);

-- api_credentials policies (owner-only)
create policy api_credentials_select
  on public.api_credentials for select
  using (user_id is not null and auth.uid() = user_id);
create policy api_credentials_insert
  on public.api_credentials for insert
  with check (user_id is not null and auth.uid() = user_id);
create policy api_credentials_modify
  on public.api_credentials for update
  using (user_id is not null and auth.uid() = user_id)
  with check (user_id is not null and auth.uid() = user_id);
create policy api_credentials_delete
  on public.api_credentials for delete
  using (user_id is not null and auth.uid() = user_id);

-- wallets policies (owner-only)
create policy wallets_select
  on public.wallets for select
  using (user_id is not null and auth.uid() = user_id);
create policy wallets_insert
  on public.wallets for insert
  with check (user_id is not null and auth.uid() = user_id);
create policy wallets_modify
  on public.wallets for update
  using (user_id is not null and auth.uid() = user_id)
  with check (user_id is not null and auth.uid() = user_id);
create policy wallets_delete
  on public.wallets for delete
  using (user_id is not null and auth.uid() = user_id);
