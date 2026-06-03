-- expose_heaven_data_api_grants.sql
-- Supabase now recommends explicit Data API grants instead of relying on project defaults.
-- RLS policies in the previous migrations still control which rows are visible/mutable.

-- Existing nullable UNIQUE constraints and partial public indexes do not provide a single
-- conflict target for public and private upserts. Clean duplicates within each run, then use
-- NULLS NOT DISTINCT identity indexes so PostgREST on_conflict works consistently when nullable
-- identity fields are null without collapsing the same strategy across distinct runs.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, symbol, tf, profile_id, params, run_id
           order by selected desc, score desc nulls last, created_at desc, id desc
         ) as rn
  from public.strategy_evaluations
)
delete from public.strategy_evaluations se
using ranked r
where se.id = r.id and r.rn > 1;

with ranked as (
  select id,
         row_number() over (
           partition by user_id, symbol, tf, name
           order by updated_at desc, created_at desc, id desc
         ) as rn
  from public.heaven_strategies
)
delete from public.heaven_strategies hs
using ranked r
where hs.id = r.id and r.rn > 1;

with ranked as (
  select id,
         row_number() over (
           partition by user_id, name, exchange
           order by updated_at desc, created_at desc, id desc
         ) as rn
  from public.wallets
)
delete from public.wallets w
using ranked r
where w.id = r.id and r.rn > 1;

drop index if exists public.strategy_evaluations_public_unique;
drop index if exists public.strategy_evaluations_private_per_run_unique;
drop index if exists public.strategy_evaluations_public_per_run_unique;
drop index if exists public.heaven_strategies_public_unique;
drop index if exists public.wallets_public_unique;

alter table public.strategy_evaluations
  drop constraint if exists strategy_evaluations_user_id_symbol_tf_profile_id_params_key;
alter table public.wallets
  drop constraint if exists wallets_user_id_name_key;

create unique index if not exists strategy_evaluations_run_identity_unique
  on public.strategy_evaluations(user_id, symbol, tf, profile_id, params, run_id) nulls not distinct;
create unique index if not exists heaven_strategies_identity_unique
  on public.heaven_strategies(user_id, symbol, tf, name) nulls not distinct;
create unique index if not exists wallets_identity_unique
  on public.wallets(user_id, name, exchange) nulls not distinct;

grant usage on schema public to anon, authenticated, service_role;

-- Anonymous access is limited to the operations used by the public pooled UI/runner.
grant select, insert, update on table public.lab_profiles to anon;
grant select, insert, update on table public.strategy_evaluations to anon;
grant select, insert on table public.palmares_sets to anon;
grant select, insert on table public.palmares_entries to anon;
grant select, insert, update, delete on table public.heaven_strategies to anon;
grant select, insert, update, delete on table public.wallets to anon;
grant select, insert, update on table public.live_sessions to anon;
grant select, insert on table public.live_events to anon;

grant select, insert, update, delete on table public.lab_profiles to authenticated, service_role;
grant select, insert, update, delete on table public.strategy_evaluations to authenticated, service_role;
grant select, insert, update, delete on table public.palmares_sets to authenticated, service_role;
grant select, insert, update, delete on table public.palmares_entries to authenticated, service_role;
grant select, insert, update, delete on table public.heaven_strategies to authenticated, service_role;
grant select, insert, update, delete on table public.wallets to authenticated, service_role;
grant select, insert, update, delete on table public.live_sessions to authenticated, service_role;
grant select, insert, update, delete on table public.live_events to authenticated, service_role;

-- Keep one best row per strategy across immutable runs so repeated evaluations do not crowd out
-- other strategies in the global top 25.
create or replace view public.v_palmares_best
with (security_invoker = true) as
with best_per_strategy as (
  select distinct on (symbol, tf, profile_id, params)
         symbol, tf, profile_id, params, metrics, score, created_at
  from public.strategy_evaluations
  where user_id is null and selected = true
  order by symbol, tf, profile_id, params, score desc nulls last, created_at desc
)
select symbol, tf, profile_id, params, metrics, score, created_at
from (
  select best_per_strategy.*,
         row_number() over (
           partition by symbol, tf, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
           order by score desc nulls last, created_at desc
         ) as rn
  from best_per_strategy
) ranked
where rn <= 25;

grant select on table public.v_palmares_best to anon, authenticated, service_role;
