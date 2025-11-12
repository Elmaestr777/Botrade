-- 0009_realtime_live_events.sql
-- Enable Postgres logical replication for live tables so Supabase Realtime can stream changes

-- Add tables to the supabase_realtime publication (guard duplicate_object)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.live_events;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
