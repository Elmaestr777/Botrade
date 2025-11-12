export default async function handler(req, res) {
  try {
    const ref = process.env.SUPABASE_REF || "moxxmohsvgyihjrcdupr";
    const url = process.env.LIVE_RUNNER_URL || `https://${ref}.functions.supabase.co/live-runner`;
    const r = await fetch(url, { method: 'GET', headers: { 'content-type': 'application/json' } });
    let body = null;
    try { body = await r.json(); } catch (_) { body = null; }
    res.status(200).json({ ok: true, status: r.status, body });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
