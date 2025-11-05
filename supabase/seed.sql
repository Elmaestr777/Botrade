-- seed.sql
-- Inserts a default public scoring profile matching the UI's "balancee" weights.
insert into public.lab_profiles (user_id, name, description, weights, is_public)
values (
  null,
  'balancee',
  'Profil de pondération par défaut pour le palmarès (PF/WR/RR/PNL/EQ/TR/DD).',
  '{"pf":25, "wr":20, "rr":15, "pnl":15, "eq":10, "trades":5, "dd":10}'::jsonb,
  true
)
on conflict do nothing;
