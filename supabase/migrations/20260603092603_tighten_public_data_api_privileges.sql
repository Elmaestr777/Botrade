-- Remove broad default grants and restore only the Data API operations used by Botrade.
-- RLS remains the row-level authorization layer for every exposed table.

revoke all privileges on table
  public.lab_profiles,
  public.strategy_evaluations,
  public.palmares_sets,
  public.palmares_entries,
  public.heaven_strategies,
  public.wallets,
  public.live_sessions,
  public.live_events,
  public.api_credentials,
  public.v_palmares_best
from public, anon, authenticated;

-- Remove manually-created pool policies that bypass the stricter user_id/parent-set checks
-- already defined by the versioned migrations.
drop policy if exists pe_public_insert_pool on public.palmares_entries;
drop policy if exists se_public_insert on public.strategy_evaluations;
drop policy if exists se_public_update on public.strategy_evaluations;

drop policy if exists palmares_entries_public_insert on public.palmares_entries;
create policy palmares_entries_public_insert
  on public.palmares_entries for insert
  to anon, authenticated
  with check (exists (
    select 1
    from public.palmares_sets s
    where s.id = set_id and s.user_id is null
  ));

drop policy if exists strategy_evaluations_public_insert on public.strategy_evaluations;
create policy strategy_evaluations_public_insert
  on public.strategy_evaluations for insert
  to anon, authenticated
  with check (user_id is null);

drop policy if exists strategy_evaluations_public_update on public.strategy_evaluations;
create policy strategy_evaluations_public_update
  on public.strategy_evaluations for update
  to anon, authenticated
  using (user_id is null)
  with check (user_id is null);

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update on table public.lab_profiles to anon;
grant select, insert, update on table public.strategy_evaluations to anon;
grant select, insert on table public.palmares_sets to anon;
grant select, insert on table public.palmares_entries to anon;
grant select, insert, update, delete on table public.heaven_strategies to anon;
grant select, insert, update, delete on table public.wallets to anon;
grant select, insert, update on table public.live_sessions to anon;
grant select, insert on table public.live_events to anon;
grant select on table public.v_palmares_best to anon;

grant select, insert, update, delete on table public.lab_profiles to authenticated, service_role;
grant select, insert, update, delete on table public.strategy_evaluations to authenticated, service_role;
grant select, insert, update, delete on table public.palmares_sets to authenticated, service_role;
grant select, insert, update, delete on table public.palmares_entries to authenticated, service_role;
grant select, insert, update, delete on table public.heaven_strategies to authenticated, service_role;
grant select, insert, update, delete on table public.wallets to authenticated, service_role;
grant select, insert, update, delete on table public.live_sessions to authenticated, service_role;
grant select, insert, update, delete on table public.live_events to authenticated, service_role;
grant select, insert, update, delete on table public.api_credentials to authenticated, service_role;
grant select on table public.v_palmares_best to authenticated, service_role;
