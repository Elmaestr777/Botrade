-- 0005_palmares_best_view.sql
-- Index + view to serve global best palmarès by pair/TF from public selected strategies

-- Speed up queries for selected=true ordered by score (public rows)
create index if not exists strategy_evaluations_public_selected_score_idx
  on public.strategy_evaluations(symbol, tf, score desc, created_at desc)
  where user_id is null and selected = true;

-- Global best (top 25) by (symbol, tf, profile_id) across all runs (public)
create or replace view public.v_palmares_best as
select symbol, tf, profile_id, params, metrics, score, created_at from (
  select se.*,
         row_number() over (
           partition by se.symbol, se.tf, coalesce(se.profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
           order by se.score desc, se.created_at desc
         ) as rn
  from public.strategy_evaluations se
  where se.user_id is null and se.selected = true
) t
where rn <= 25;
