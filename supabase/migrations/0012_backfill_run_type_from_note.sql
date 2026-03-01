-- Backfill run_type on historical palmares_sets rows after metadata columns were restored.
-- Safe/idempotent: updates only rows where run_type is null.

update public.palmares_sets
set run_type = case
  when lower(coalesce(note, '')) like '%lab%' then 'LAB'
  else 'NEW'
end
where run_type is null;
