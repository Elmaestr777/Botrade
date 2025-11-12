# Botrade Headless Runner (WS)

A long-running Node service that listens to Binance kline websockets per symbol/TF and executes live sessions stored in Supabase in real-time (per-second updates). It writes events to `public.live_events` and updates `public.live_sessions` continuously.

## Env
Create `.env.runner` at repo root (or export envs) with:

SUPABASE_URL=...  
SUPABASE_SERVICE_KEY=...   # service role key recommended
BINANCE_WS=wss://stream.binance.com:9443/ws

## Run locally

npm i --prefix . -w botrade-runner || npm i --prefix .
node runner/index.js

## Deploy
- Use a container platform (Railway/Render/Fly/Cloud Run). Provide envs and run `node runner/index.js`.
- Ensure `supabase/migrations/0008` and `0009` are applied, and Realtime enabled.

## Notes
- Groups sessions by (symbol, tf) and shares one stream per group.
- Reconnects on error; backoff jitter.
- Uses a simplified copy of the engine (Line Break + TP/SL/BE).