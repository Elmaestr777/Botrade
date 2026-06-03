-- 0011_runs_campaigns_immutability.sql
-- Canonical run identifiers + structured run metadata + immutability support.

alter table public.strategy_evaluations
  add column if not exists run_id uuid,
  add column if not exists campaign_id text,
  add column if not exists run_type text,
  add column if not exists profile text;
alter table public.palmares_sets
  add column if not exists run_id uuid,
  add column if not exists campaign_id text,
  add column if not exists run_type text,
  add column if not exists profile text;
alter table public.palmares_entries
  add column if not exists run_id uuid,
  add column if not exists campaign_id text,
  add column if not exists run_type text,
  add column if not exists profile text;
create index if not exists strategy_evaluations_run_idx
  on public.strategy_evaluations(symbol, tf, profile_id, run_id, created_at desc);
create index if not exists palmares_sets_run_idx
  on public.palmares_sets(symbol, tf, profile_id, run_id, created_at desc);
create index if not exists palmares_entries_run_idx
  on public.palmares_entries(set_id, run_id, rank);
-- Optional immutability-oriented uniqueness per run.
create unique index if not exists strategy_evaluations_private_per_run_unique
  on public.strategy_evaluations(user_id, symbol, tf, profile_id, params, run_id)
  where user_id is not null and run_id is not null;
create unique index if not exists strategy_evaluations_public_per_run_unique
  on public.strategy_evaluations(symbol, tf, profile_id, params, run_id)
  where user_id is null and run_id is not null;
-- Soft validation for run_type semantics.
alter table public.strategy_evaluations drop constraint if exists strategy_evaluations_run_type_ck;
alter table public.strategy_evaluations
  add constraint strategy_evaluations_run_type_ck
  check (run_type is null or run_type in ('NEW','LAB'));
alter table public.palmares_sets drop constraint if exists palmares_sets_run_type_ck;
alter table public.palmares_sets
  add constraint palmares_sets_run_type_ck
  check (run_type is null or run_type in ('NEW','LAB'));
alter table public.palmares_entries drop constraint if exists palmares_entries_run_type_ck;
alter table public.palmares_entries
  add constraint palmares_entries_run_type_ck
  check (run_type is null or run_type in ('NEW','LAB'));
