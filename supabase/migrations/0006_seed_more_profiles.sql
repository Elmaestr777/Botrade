-- 0006_seed_more_profiles.sql
-- Seed additional public Lab profiles: 'sure' and 'agressive'

insert into public.lab_profiles (user_id, name, description, weights, is_public)
values
  (null, 'sure', 'Profil prudent: davantage de poids sur DD/WR', '{"pf":15, "wr":30, "rr":10, "pnl":10, "eq":10, "trades":5, "dd":20}'::jsonb, true),
  (null, 'agressive', 'Profil agressif: poids élevé sur PNL/RR/PF', '{"pf":30, "wr":10, "rr":25, "pnl":20, "eq":5, "trades":5, "dd":5}'::jsonb, true)
on conflict do nothing;
