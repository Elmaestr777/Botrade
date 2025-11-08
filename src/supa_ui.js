(function(){
  // Minimal Supabase UI integration for Lab persistence
  const LS_URL = 'supabase:url';
  const LS_ANON = 'supabase:anon';
  let client = null;
  let profileIdCache = null;

  function staticCfg(){
    try{
      const url = (typeof window!=='undefined' && (window.SUPABASE_URL||'')) || (document?.querySelector?.('meta[name="supabase-url"]')?.content||'') || '';
      const anon = (typeof window!=='undefined' && (window.SUPABASE_ANON_KEY||'')) || (document?.querySelector?.('meta[name="supabase-anon"]')?.content||'') || '';
      return { url, anon };
    }catch(_){ return {url:'',anon:''}; }
  }
  function readCfg(){
    const s = staticCfg();
    if(s.url && s.anon) return s;
    try{ return { url: localStorage.getItem(LS_URL)||'', anon: localStorage.getItem(LS_ANON)||'' }; }catch(_){ return {url:'',anon:''}; }
  }
  function saveCfg(url, anon){ try{ localStorage.setItem(LS_URL, url||''); localStorage.setItem(LS_ANON, anon||''); }catch(_){} }

  function ensureClient(){
    const cfg = readCfg();
    if(!cfg.url || !cfg.anon || !window.supabase){ client = null; return null; }
    if(client && client.supabaseUrl === cfg.url){ return client; }
    try{ client = window.supabase.createClient(cfg.url, cfg.anon, { auth: { persistSession: true, autoRefreshToken: true } }); }catch(_){ client = null; }
    return client;
  }

  async function isLoggedIn(){ try{ const c=ensureClient(); if(!c) return false; const { data:{ user } } = await c.auth.getUser(); return !!user; }catch(_){ return false; } }
  async function getUserId(){ try{ const c=ensureClient(); if(!c) return null; const { data:{ user } } = await c.auth.getUser(); return (user && user.id) || null; }catch(_){ return null; } }

  async function ensureAuthFlow(){
    const stat = staticCfg();
    if(stat.url && stat.anon){
      alert('Supabase est configuré globalement (supa_config.js). Aucune connexion supplémentaire nécessaire.');
      return true;
    }
    const c = ensureClient(); if(!c) { alert('Configurez Supabase (global supa_config.js ou via invite) d\'abord.'); return false; }
    if(await isLoggedIn()) return true;
    const email = prompt('Entrez votre email pour connexion Supabase (magic link)');
    if(!email) return false;
    try{
      const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if(error) throw error;
      alert('Lien envoyé. Vérifiez votre email puis revenez ici. Une fois connecté, relancez la synchro.');
    }catch(e){ alert('Erreur de login: '+ (e && e.message || e)); return false; }
    return false;
  }

  async function getBalanceeProfileId(){
    if(profileIdCache) return profileIdCache;
    const c = ensureClient(); if(!c) return null;
    try{
      const { data, error } = await c
        .from('lab_profiles')
        .select('id')
        .eq('name','balancee')
        .is('is_public', true)
        .limit(1)
        .maybeSingle();
      if(error) return null;
      profileIdCache = data && data.id || null;
      return profileIdCache;
    }catch(_){ return null; }
  }

  function chunk(arr, n){ const out=[]; for(let i=0;i<arr.length;i+=n){ out.push(arr.slice(i,i+n)); } return out; }

  async function upsertStrategyEvaluations(rows){
    const c = ensureClient(); if(!c || !rows || !rows.length) return;
    // Upsert with on_conflict composite key
    for(const part of chunk(rows, 80)){
      try{
        const { error } = await c
          .from('strategy_evaluations')
          .upsert(part, { onConflict: 'symbol,tf,profile_id,params', ignoreDuplicates: false, returning: 'minimal' });
        if(error) console.warn('supabase upsert strategy_evaluations', error);
      }catch(e){ console.warn('supabase upsert strategy_evaluations ex', e); }
    }
  }

  async function createPalmaresSet(row){
    const c = ensureClient(); if(!c) return null;
    try{
      const { data, error } = await c.from('palmares_sets').insert(row).select('id').single();
      if(error) return null; return data && data.id || null;
    }catch(_){ return null; }
  }

  async function insertPalmaresEntries(rows){
    const c = ensureClient(); if(!c || !rows || !rows.length) return;
    for(const part of chunk(rows, 80)){
      try{ const { error } = await c.from('palmares_entries').insert(part); if(error) console.warn('palmares_entries', error); }
      catch(e){ console.warn('palmares_entries ex', e); }
    }
  }

  async function markSelectedForSet(rows, setId){
    if(!rows || !rows.length || !setId) return;
    const upd = rows.map(r=> ({ ...r, selected:true, palmares_set_id:setId }));
    await upsertStrategyEvaluations(upd);
  }

  function canonicalParamsFromUI(p){
    // Canonical shape aligned with Python engine (snake_case + tp_types/tp_r/tp_p)
    const tp = Array.isArray(p.tp) ? p.tp.slice(0, 10) : [];
    const tp_types = new Array(10).fill('Fib');
    const tp_r = new Array(10).fill(0.0);
    const tp_p = new Array(10).fill(0.0);
    let sumW = 0;
    for(let i=0;i<tp.length && i<10;i++){
      const t = tp[i] || {};
      const typ = String(t.type || 'Fib');
      if(typ === 'Percent'){
        tp_types[i] = 'Percent';
        tp_r[i] = Number(t.pct != null ? t.pct : t.value) || 0;
      } else if(typ === 'EMA'){
        tp_types[i] = 'EMA';
        tp_r[i] = 0; // EMA target is handled by ema_len elsewhere
      } else {
        tp_types[i] = 'Fib';
        tp_r[i] = Number(t.fib != null ? t.fib : t.value) || 0;
      }
      let w = t.qty;
      if(w != null) w = (w > 1 ? Number(w) : Number(w) * 100);
      tp_p[i] = Number.isFinite(w) ? Math.max(0, w) : 0;
      sumW += tp_p[i];
    }
    if(sumW > 0){
      for(let i=0;i<10;i++) tp_p[i] = +(tp_p[i] / sumW * 100).toFixed(6);
    }
    return {
      nol: p.nol|0,
      prd: p.prd|0,
      sl_init_pct: +p.slInitPct,
      be_after_bars: p.beAfterBars|0,
      be_lock_pct: +p.beLockPct,
      ema_len: p.emaLen|0,
      entry_mode: String(p.entryMode||'Both').replace('Fib Retracement','Fib'),
      use_fib_ret: !!p.useFibRet,
      confirm_mode: String(p.confirmMode||'Bounce'),
      tp_types, tp_r, tp_p,
    };
  }

  async function testConnection(){
    const c = ensureClient(); if(!c) return false;
    try{
      // lightweight test query
      const { error } = await c.from('lab_profiles').select('id').limit(1);
      return !error;
    }catch(_){ return false; }
  }

  async function persistLabResults(ctx){
    try{
      const c = ensureClient(); if(!c) return;
      // Public pool: no auth, rows written with user_id = null
      const uid = null;
      const profileId = await getBalanceeProfileId();
      const sym = ctx.symbol, tf = ctx.tf;
      const now = Date.now();
      const runContext = { source:'UI:Lab', ts: now };

      // Upsert tested strategies (selected=false)
      const toEval = [];
      if(Array.isArray(ctx.tested)){
        for(const t of ctx.tested){
          const params = canonicalParamsFromUI(t.params||{});
          const metrics = t.metrics||t.res||{};
          const score = (typeof t.score==='number')? t.score : 0;
          toEval.push({ user_id: uid, symbol: sym, tf, profile_id: profileId || null, params, metrics, score, selected: false, palmares_set_id: null, provenance: 'UI:Lab', run_context: runContext });
        }
      }
      if(toEval.length){ await upsertStrategyEvaluations(toEval); }

      // Palmarès Top-N
      const best = Array.isArray(ctx.best)? ctx.best.slice() : [];
      if(best.length){
        const setId = await createPalmaresSet({ user_id: uid, symbol: sym, tf, profile_id: profileId || null, top_n: best.length, note: `Lab ${sym} ${tf}` });
        if(setId){
          const entries = []; let rank=1;
          for(const b of best){
            entries.push({ set_id: setId, rank, name: b.name||null, params: canonicalParamsFromUI(b.params||{}), metrics: b.metrics||b.res||{}, score: (typeof b.score==='number')? b.score : 0, provenance: 'UI:Lab', generation: (b.gen!=null? b.gen:1) });
            rank++;
          }
          await insertPalmaresEntries(entries);
          // Mark selected
          const selRows = best.map(b=> ({ user_id: uid, symbol: sym, tf, profile_id: profileId || null, params: canonicalParamsFromUI(b.params||{}) }));
          await markSelectedForSet(selRows, setId);
        }
      }
    }catch(e){ console.warn('persistLabResults error', e); }
  }

  async function openConfigAndLogin(){
    const stat = staticCfg();
    if(stat.url && stat.anon){
      alert('Configuration Supabase définie globalement (src/supa_config.js). Modifiez ce fichier pour changer de projet.');
      return;
    }
    // Fallback: prompt and save to localStorage if global not set
    const cur = readCfg();
    const url = prompt('SUPABASE_URL', cur.url||''); if(url==null) return;
    const anon = prompt('SUPABASE_ANON_KEY (public anon key)', cur.anon||''); if(anon==null) return;
    saveCfg(url.trim(), anon.trim()); ensureClient();
    alert('Configuration Supabase enregistrée (mode public, sans identification).');
  }

  async function fetchKnownCanonicalKeys(symbol, tf){
    const c=ensureClient(); if(!c) return new Set();
    const profileId = await getBalanceeProfileId();
    const out=new Set();
    let from=0, step=1000; // simple paging
    while(true){
      try{
        let q = c
          .from('strategy_evaluations')
          .select('params')
          .eq('symbol', symbol)
          .eq('tf', tf);
        if(profileId!=null) q = q.eq('profile_id', profileId); else q = q.is('profile_id', null);
        const { data, error } = await q.range(from, from+step-1);
        if(error) break;
        if(!Array.isArray(data) || !data.length) break;
        for(const row of data){ try{ const p=row.params||{}; const keys=Object.keys(p).sort(); out.add(JSON.stringify(p, keys)); }catch(_){ } }
        if(data.length<step) break;
        from += step;
      }catch(_){ break; }
    }
    return out;
  }

  function uiParamsFromCanonical(p){
    // Map Python-canonical params to UI schema used by the front
    if(!p || typeof p !== 'object') return {};
    const tp_types = Array.isArray(p.tp_types)? p.tp_types.slice(0,10) : [];
    const tp_r = Array.isArray(p.tp_r)? p.tp_r.slice(0,10) : [];
    const tp_p = Array.isArray(p.tp_p)? p.tp_p.slice(0,10) : [];
    const tp = [];
    for(let i=0;i<10;i++){
      const typ = tp_types[i] || 'Fib';
      const r = Number(tp_r[i]||0);
      const w = Number(tp_p[i]||0);
      if(!(w>0)) continue;
      if(typ === 'Percent') tp.push({ type:'Percent', pct:r, value:r, qty: Math.max(0, Math.min(1, w/100)) });
      else if(typ === 'EMA') tp.push({ type:'EMA', emaLen: (p.ema_len|0)||55, qty: Math.max(0, Math.min(1, w/100)) });
      else tp.push({ type:'Fib', fib:r, value:r, qty: Math.max(0, Math.min(1, w/100)) });
    }
    const entryModeUI = String(p.entry_mode||'Both') === 'Fib' ? 'Fib Retracement' : String(p.entry_mode||'Both');
    return {
      nol: p.nol|0,
      prd: p.prd|0,
      slInitPct: +p.sl_init_pct,
      beAfterBars: p.be_after_bars|0,
      beLockPct: +p.be_lock_pct,
      emaLen: p.ema_len|0,
      entryMode: entryModeUI,
      useFibRet: !!p.use_fib_ret,
      confirmMode: String(p.confirm_mode||'Bounce'),
      tpEnable: tp.length>0,
      tp,
      slEnable: false,
      sl: [],
    };
  }

  async function fetchPalmares(symbol, tf, limit=25){
    const c=ensureClient(); if(!c) return [];
    const profileId = await getBalanceeProfileId();
    function mapRows(rows){ const out=[]; let idx=1; for(const row of rows||[]){ const paramsUI=uiParamsFromCanonical(row.params||{}); const metrics=row.metrics||{}; const score=(typeof row.score==='number')? row.score:0; out.push({ id:'db_'+(idx++), name:null, gen:1, params:paramsUI, res:metrics, score, ts:Date.now() }); } return out; }
    try{
      // Primary source: selected strategies
      let q = c
        .from('strategy_evaluations')
        .select('params,metrics,score')
        .eq('symbol', symbol)
        .eq('tf', tf)
        .eq('selected', true)
        .order('score', { ascending: false })
        .limit(Math.max(1, limit));
      if(profileId!=null) q = q.eq('profile_id', profileId); else q = q.is('profile_id', null);
      let { data, error } = await q;
      if(!error && Array.isArray(data) && data.length){ return mapRows(data); }
      // Fallback: read latest palmarès set entries
      let qs = c
        .from('palmares_sets')
        .select('id')
        .eq('symbol', symbol)
        .eq('tf', tf)
        .order('id', { ascending:false })
        .limit(1);
      if(profileId!=null) qs = qs.eq('profile_id', profileId); else qs = qs.is('profile_id', null);
      const { data:sets, error:err2 } = await qs;
      if(err2 || !Array.isArray(sets) || !sets.length) return [];
      const setId = sets[0]?.id;
      if(!setId) return [];
      const qe = c
        .from('palmares_entries')
        .select('params,metrics,score,rank')
        .eq('set_id', setId)
        .order('rank', { ascending:true })
        .limit(Math.max(1, limit));
      const { data:entries, error:err3 } = await qe;
      if(err3 || !Array.isArray(entries) || !entries.length) return [];
      return mapRows(entries);
    }catch(_){ return []; }
  }

  window.SUPA = {
    isConfigured: ()=>{ const c=readCfg(); return !!(c.url && c.anon); },
    configSource: ()=>{ const s=staticCfg(); return (s.url&&s.anon)? 'static' : 'localStorage'; },
    openConfigAndLogin,
    ensureAuthFlow,
    persistLabResults,
    testConnection,
    getUserId,
    fetchKnownKeys: fetchKnownCanonicalKeys,
    fetchPalmares,
  };
})();
