-- 0003_public_policies.sql
-- Enable pooled, public (no-auth) writes/reads by allowing rows with user_id IS NULL
-- and add a partial unique index to support upserts without user_id

-- Strategy evaluations: public policies
create policy strategy_evaluations_public_select
  on public.strategy_evaluations for select
  using (user_id is null);

create policy strategy_evaluations_public_insert
  on public.strategy_evaluations for insert
  with check (user_id is null);

create policy strategy_evaluations_public_update
  on public.strategy_evaluations for update
  using (user_id is null)
  with check (user_id is null);

-- Partial unique index for public rows (enables ON CONFLICT on (symbol, tf, profile_id, params))
create unique index if not exists strategy_evaluations_public_unique
  on public.strategy_evaluations(symbol, tf, profile_id, params)
  where user_id is null;

-- Palmarès sets: public policies
create policy palmares_sets_public_select
  on public.palmares_sets for select
  using (user_id is null);

create policy palmares_sets_public_insert
  on public.palmares_sets for insert
  with check (user_id is null);

create policy palmares_sets_public_update
  on public.palmares_sets for update
  using (user_id is null)
  with check (user_id is null);

-- Palmarès entries: public policies (auth via parent set with user_id is null)
create policy palmares_entries_public_select
  on public.palmares_entries for select
  using (exists (
    select 1 from public.palmares_sets s
    where s.id = set_id and s.user_id is null
  ));

create policy palmares_entries_public_insert
  on public.palmares_entries for insert
  with check (exists (
    select 1 from public.palmares_sets s
    where s.id = set_id and s.user_id is null
  ));

create policy palmares_entries_public_update
  on public.palmares_entries for update
  using (exists (
    select 1 from public.palmares_sets s
    where s.id = set_id and s.user_id is null
  ))
  with check (exists (
    select 1 from public.palmares_sets s
    where s.id = set_id and s.user_id is null
  ));
