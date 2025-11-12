-- 0008_live_sessions.sql
-- Headless live trading sessions persisted in Supabase

-- Sessions table (public by default: user_id IS NULL)
create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  wallet_id uuid references public.wallets(id) on delete set null,
  name text not null,
  symbol text not null,
  tf text not null,
  active boolean not null default true,
  strategy_params jsonb not null, -- UI schema (nol, prd, slInitPct, be..., emaLen, tp, sl, etc.)
  equity numeric(18,6),
  start_cap numeric(18,6),
  fee numeric(10,4),
  lev numeric(10,4),
  last_bar_time bigint, -- unix seconds of last processed candle
  pos jsonb, -- engine state for continuity (dir, entry, sl, qty, etc.)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create unique index if not exists live_sessions_public_unique
  on public.live_sessions(name)
  where user_id is null;

create index if not exists live_sessions_lookup
  on public.live_sessions(active, symbol, tf, updated_at desc);

-- Events table (per-session trade/log events)
create table if not exists public.live_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  kind text not null check (kind in ('entry','tp','sl','flip','be','info')),
  at_time timestamptz not null default now(),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists live_events_by_session
  on public.live_events(session_id, at_time desc);

-- RLS
alter table public.live_sessions enable row level security;
alter table public.live_events enable row level security;

-- Owner policies
create policy if not exists live_sessions_select
  on public.live_sessions for select
  using (user_id is not null and auth.uid() = user_id);
create policy if not exists live_sessions_insert
  on public.live_sessions for insert
  with check (user_id is not null and auth.uid() = user_id);
create policy if not exists live_sessions_update
  on public.live_sessions for update
  using (user_id is not null and auth.uid() = user_id)
  with check (user_id is not null and auth.uid() = user_id);
create policy if not exists live_sessions_delete
  on public.live_sessions for delete
  using (user_id is not null and auth.uid() = user_id);

create policy if not exists live_events_select
  on public.live_events for select
  using (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is not null and s.user_id = auth.uid()));
create policy if not exists live_events_insert
  on public.live_events for insert
  with check (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is not null and s.user_id = auth.uid()));
create policy if not exists live_events_update
  on public.live_events for update
  using (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is not null and s.user_id = auth.uid()))
  with check (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is not null and s.user_id = auth.uid()));
create policy if not exists live_events_delete
  on public.live_events for delete
  using (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is not null and s.user_id = auth.uid()));

-- Public (no-auth) policies: allow pooled operation for rows with user_id IS NULL
create policy if not exists live_sessions_public_select
  on public.live_sessions for select
  using (user_id is null);
create policy if not exists live_sessions_public_insert
  on public.live_sessions for insert
  with check (user_id is null);
create policy if not exists live_sessions_public_update
  on public.live_sessions for update
  using (user_id is null)
  with check (user_id is null);
create policy if not exists live_sessions_public_delete
  on public.live_sessions for delete
  using (user_id is null);

create policy if not exists live_events_public_select
  on public.live_events for select
  using (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is null));
create policy if not exists live_events_public_insert
  on public.live_events for insert
  with check (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is null));
create policy if not exists live_events_public_update
  on public.live_events for update
  using (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is null))
  with check (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is null));
create policy if not exists live_events_public_delete
  on public.live_events for delete
  using (exists (select 1 from public.live_sessions s where s.id = session_id and s.user_id is null));
