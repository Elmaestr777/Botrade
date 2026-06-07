# Botrade Headless Runner (WS)

A long-running Node service that listens to Binance kline websockets per symbol/TF and executes live sessions stored in Supabase in real-time (per-second updates). It writes events to `public.live_events` and updates `public.live_sessions` continuously.

## Env
Create `.env.runner` at repo root (or export envs) with:

SUPABASE_URL=...  
SUPABASE_SERVICE_KEY=...   # service role key recommended
BINANCE_WS=wss://stream.binance.com:9443/ws

## Run locally

Requires Node.js 20 or newer.

npm install --prefix runner
node runner/index.js

## Validate Paper Before Live

Use the Supabase-only paper validator before preparing any live run:

```bash
python validate_paper_session.py --session-name paper-btcusdc-4h --record-event --strict-exit
```

Python Supabase tools load the repository-root `.env.runner` first if shell env vars are not already set.

Default live-ready gates require 7 observed days, 20 trade exits, profit factor >= 1.10, positive return, drawdown <= 10%, no history gap, no open position, and a paper wallet.

## Controlled Live Preparation

Generate a Supabase audit plan before any live activation:

```bash
python prepare_live_candidate.py --session-name paper-btcusdc-4h --strategy-id <heaven_strategies.id> --target-session-name live-btcusdc-4h --record-event --strict-exit
```

This is audit-only: it checks the validated paper gates, the selected Supabase strategy analysis metrics, supported headless entry mode, risk cap, leverage cap, and target naming. It does not create live sessions or place orders.

## Deploy
- Use a container platform (Railway/Render/Fly/Cloud Run). Provide envs and run `node runner/index.js`.
- Ensure `supabase/migrations/0008` and `0009` are applied, and Realtime enabled.

## Notes
- Groups sessions by (symbol, tf) and shares one stream per group.
- Loads the repository-root `.env.runner` file, then falls back to a standard `.env`.
- Reconnects closed Binance streams with backoff jitter and closes unused streams.
- Persists TP targets and pending Fib entries inside the session position so open positions and pending retracements survive runner restarts.
- Uses a simplified copy of the engine (Line Break/Fib entries + TP/SL/BE).
- Processes only paper sessions: sessions linked to a non-paper wallet are ignored. Legacy public sessions without `wallet_id` are still treated as paper.
