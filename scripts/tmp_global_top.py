import os,json,urllib.parse,urllib.request
from pathlib import Path
for raw in Path(r'C:\Users\Verdinvoa\.openclaw\workspace\botrade_dev\.env.local').read_text(encoding='utf-8').splitlines():
    line=raw.strip()
    if line and not line.startswith('#') and '=' in line:
        k,v=line.split('=',1)
        os.environ.setdefault(k.strip(),v.strip().strip('"').strip("'"))
base=os.environ['SUPABASE_REST_URL'].rstrip('/'); key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
qs=urllib.parse.urlencode({'select':'name,score,created_at,set_id,metrics,palmares_sets(*)','order':'score.desc','limit':'10'})
url=f"{base}/palmares_entries?{qs}"
req=urllib.request.Request(url,headers={'apikey':key,'Authorization':f'Bearer {key}','Accept':'application/json'})
rows=json.loads(urllib.request.urlopen(req,timeout=30).read().decode())
print(json.dumps(rows,indent=2)[:15000])
