-- 0010_lab_profiles_public.sql
-- Enable public (no-auth) access for Lab profiles with user_id IS NULL and is_public = true
-- so that the UI can upsert shared profiles (e.g. 'balancee', 'sure', 'agressive') without auth.

-- Public (no-auth) policies for lab_profiles
drop policy if exists lab_profiles_public_select on public.lab_profiles;
create policy lab_profiles_public_select
  on public.lab_profiles for select
  using (user_id is null and is_public);

drop policy if exists lab_profiles_public_insert on public.lab_profiles;
create policy lab_profiles_public_insert
  on public.lab_profiles for insert
  with check (user_id is null and is_public);

drop policy if exists lab_profiles_public_update on public.lab_profiles;
create policy lab_profiles_public_update
  on public.lab_profiles for update
  using (user_id is null and is_public)
  with check (user_id is null and is_public);

drop policy if exists lab_profiles_public_delete on public.lab_profiles;
create policy lab_profiles_public_delete
  on public.lab_profiles for delete
  using (user_id is null and is_public);
