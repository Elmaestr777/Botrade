-- 0009_realtime_live_events.sql
-- Enable Postgres logical replication for live tables so Supabase Realtime can stream changes

-- Add tables to the supabase_realtime publication (if not already added)
alter publication supabase_realtime add table if not exists public.live_events;
alter publication supabase_realtime add table if not exists public.live_sessions;