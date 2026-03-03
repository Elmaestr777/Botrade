import os, json, urllib.parse, urllib.request
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
ENV_CANDIDATES = [
    ROOT / '.env.local',
    Path(r'C:\Users\Verdinvoa\.openclaw\workspace\botrade_dev\.env.local'),
]
ENV = next((p for p in ENV_CANDIDATES if p.exists()), None)
if ENV is None:
    raise FileNotFoundError('No .env.local found in expected locations')

for raw in ENV.read_text(encoding='utf-8').splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

base = os.environ['SUPABASE_REST_URL'].rstrip('/')
key = os.environ['SUPABASE_SERVICE_ROLE_KEY']

def get(table, params):
    qs = urllib.parse.urlencode(params)
    url = f"{base}/{table}?{qs}"
    req = urllib.request.Request(url, headers={
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Accept': 'application/json'
    }, method='GET')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8', errors='replace'))

symbol='BTCUSDC'; tf='1h'
all_sets = get('palmares_sets', {
    'select':'*',
    'symbol':f'eq.{symbol}',
    'order':'created_at.desc',
    'limit':'20'
})
# fallback timeframe filter local
sets=[]
for s in all_sets:
    tfv = str(s.get('timeframe') or s.get('tf') or '').lower()
    if tfv == tf.lower():
        sets.append(s)

rows=[]
for s in sets[:5]:
    sid=s['id']
    entries = get('palmares_entries', {
        'select':'id,name,rank,score,created_at,run_type,profile,metrics',
        'set_id':f'eq.{sid}',
        'order':'score.desc',
        'limit':'3'
    })
    top = entries[0] if entries else None
    rows.append({
        'set_id': sid,
        'set_created_at': s.get('created_at'),
        'set_run_type': s.get('run_type'),
        'set_profile': s.get('profile'),
        'set_campaign_id': s.get('campaign_id'),
        'top_name': (top or {}).get('name'),
        'top_score': (top or {}).get('score'),
        'top_trades': ((top or {}).get('metrics') or {}).get('tradesCount'),
        'top_pnl': ((top or {}).get('metrics') or {}).get('totalPnl'),
        'top_avgRR': ((top or {}).get('metrics') or {}).get('avgRR'),
    })

# global top currently (as fetchGlobalPalmares does)
global_top = get('palmares_entries', {
    'select':'name,score,created_at,set_id,metrics,palmares_sets(*)',
    'order':'score.desc',
    'limit':'15'
})

# restrict to BTCUSDC/1h for readability
btc1h=[]
for r in global_top:
    ps = r.get('palmares_sets') or {}
    if isinstance(ps, list):
        ps = ps[0] if ps else {}
    tfv = str(ps.get('tf') or ps.get('timeframe') or '').lower()
    if str(ps.get('symbol') or '') == symbol and tfv == tf.lower():
        btc1h.append({
            'name': r.get('name'),
            'score': r.get('score'),
            'set_id': r.get('set_id'),
            'created_at': r.get('created_at'),
            'profile': ps.get('profile'),
            'trades': ((r.get('metrics') or {}).get('tradesCount')),
            'pnl': ((r.get('metrics') or {}).get('totalPnl')),
        })

print(json.dumps({
    'now_utc': datetime.now(timezone.utc).isoformat(),
    'latest_sets_btc1h': rows,
    'global_top_btc1h_subset': btc1h,
}, indent=2)[:50000])
