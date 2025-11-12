-- 0007_wallets_public_and_settings.sql
-- Add JSON settings for wallets and enable public (no-auth) policies + partial unique index

-- Add settings jsonb to store UI-specific fields (startCap, fee, etc.)
alter table if exists public.wallets
  add column if not exists settings jsonb;

-- Public policies (rows with user_id IS NULL)
create policy if not exists wallets_public_select
  on public.wallets for select
  using (user_id is null);

create policy if not exists wallets_public_insert
  on public.wallets for insert
  with check (user_id is null);

create policy if not exists wallets_public_update
  on public.wallets for update
  using (user_id is null)
  with check (user_id is null);

create policy if not exists wallets_public_delete
  on public.wallets for delete
  using (user_id is null);

-- Partial unique index to support upsert for public rows (by name+exchange)
create unique index if not exists wallets_public_unique
  on public.wallets(name, exchange)
  where user_id is null;