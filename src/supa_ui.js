(function(){
  // Minimal Supabase UI integration for Lab persistence
  const LS_URL = 'supabase:url';
  const LS_ANON = 'supabase:anon';
  let client = null;
let __profileIdCacheByName = new Map();

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
 
  function slog(msg){ try{ if(typeof window!=='undefined' && typeof window.addLabLog==='function'){ window.addLabLog(msg); } }catch(_){ }
    try{ console.log('[SUPA]', msg); }catch(_){ }
  }
 
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

function currentProfileName(){ try{ return localStorage.getItem('labWeightsProfile') || 'balancee'; }catch(_){ return 'balancee'; } }
  async function getProfileIdByName(name){
    const key = (name||'balancee').toLowerCase();
    if(__profileIdCacheByName.has(key)) return __profileIdCacheByName.get(key);
    const c = ensureClient(); if(!c) return null;
    try{
      let row=null;
      let uid=null;
      try{ uid = await getUserId(); }catch(_){ uid=null; }
      if(uid){
        const { data, error } = await c
          .from('lab_profiles')
          .select('id')
          .eq('name', key)
          .eq('user_id', uid)
          .limit(1)
          .maybeSingle();
        if(!error && data){ row=data; }
      }
      if(!row){
        const { data, error } = await c
          .from('lab_profiles')
          .select('id')
          .eq('name', key)
          .is('is_public', true)
          .limit(1)
          .maybeSingle();
        if(!error && data){ row=data; }
      }
      const id = (row && row.id) || null;
      __profileIdCacheByName.set(key, id);
      return id;
    }catch(_){ return null; }
  }

  async function fetchLabProfileWeights(profileName){
    const c = ensureClient(); if(!c) return null;
    const key = (profileName||'balancee').toLowerCase();
    try{
      let row=null;
      let uid=null;
      try{ uid = await getUserId(); }catch(_){ uid=null; }
      if(uid){
        const { data, error } = await c
          .from('lab_profiles')
          .select('name,weights')
          .eq('name', key)
          .eq('user_id', uid)
          .limit(1)
          .maybeSingle();
        if(!error && data){ row=data; }
      }
      if(!row){
        const { data, error } = await c
          .from('lab_profiles')
          .select('name,weights')
          .eq('name', key)
          .is('is_public', true)
          .limit(1)
          .maybeSingle();
        if(!error && data){ row=data; }
      }
      return row || null;
    }catch(_){ return null; }
  }

  async function upsertLabProfileWeights(profileName, weights){
    const c = ensureClient(); if(!c) return false;
    let uid=null;
    try{ uid = await getUserId(); }catch(_){ uid=null; }
    if(!uid){ slog('Supabase: impossible de sauvegarder les pondérations (non connecté)'); return false; }
    const name = (profileName||'balancee').toLowerCase();
    try{
      const row = { user_id: uid, name, description: null, weights: weights||{}, is_public: false };
      const { error } = await c
        .from('lab_profiles')
        .upsert([row], { onConflict: 'user_id,name', ignoreDuplicates: false, returning: 'minimal' });
      if(error){ slog('Supabase: upsert lab_profiles KO — '+(error.message||error)); return false; }
      __profileIdCacheByName.delete(name);
      return true;
    }catch(e){ slog('Supabase: upsert lab_profiles exception — '+(e&&e.message?e.message:e)); return false; }
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
      if(error){ slog('Supabase: create palmares_set erreur — '+(error.message||error));
        // Fallback: réessayer sans user_id si la colonne est NOT NULL/protégée
        try{
          const r2 = { ...row }; delete r2.user_id;
          const { data: d2, error: e2 } = await c.from('palmares_sets').insert(r2).select('id').single();
          if(e2){ slog('Supabase: create palmares_set fallback erreur — '+(e2.message||e2)); return null; }
          return (d2 && d2.id) || null;
        }catch(e){ slog('Supabase: create palmares_set fallback exception — '+(e&&e.message?e.message:e)); return null; }
      }
      return (data && data.id) || null;
    }catch(e){ slog('Supabase: create palmares_set exception — '+(e&&e.message?e.message:e)); return null; }
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
    const c = ensureClient(); if(!c){ slog('Supabase: client absent'); return false; }
    try{
      const { error } = await c.from('lab_profiles').select('id').limit(1);
      if(error){ slog('Supabase: testConnection KO — '+(error.message||error)); return false; }
      slog('Supabase: connexion OK');
      return true;
    }catch(e){ slog('Supabase: testConnection exception — '+(e&&e.message?e.message:e)); return false; }
  }

async function persistLabResults(ctx){
    try{
      const c = ensureClient(); if(!c){ slog('Supabase: client indisponible'); return; }
      const ok = await testConnection(); if(!ok){ slog('Supabase: connexion KO, annulation de la persistance'); return; }
      // Public pool: no auth, rows written with user_id = null
      const uid = null;
      const profName = (ctx && ctx.profileName) || currentProfileName();
      const profileId = await getProfileIdByName(profName);
      const sym = ctx.symbol, tf = ctx.tf;
      const now = Date.now();
      const runContext = { source:'UI:Lab', ts: now };
 
      // Upsert tested strategies (selected=false)
      const toEval = [];
      // Limiter le volume d'évaluations envoyées à Supabase pour accélérer la fin des runs
      if(Array.isArray(ctx.tested)){
        const tested = ctx.tested.slice();
        try{ tested.sort((a,b)=> (Number(b.score)||0) - (Number(a.score)||0)); }catch(_){ }
        const MAX_EVAL_ROWS = 1000;
        const subset = tested.slice(0, MAX_EVAL_ROWS);
        for(const t of subset){
          const params = canonicalParamsFromUI(t.params||{});
          const metrics = t.metrics||t.res||{};
          const score = (typeof t.score==='number')? t.score : 0;
          toEval.push({ user_id: uid, symbol: sym, tf, profile_id: profileId || null, params, metrics, score, selected: false, palmares_set_id: null, provenance: 'UI:Lab', run_context: runContext });
        }
      }
      if(toEval.length){ slog(`Supabase: upsert ${toEval.length} évaluations (top) ...`); await upsertStrategyEvaluations(toEval); slog('Supabase: évaluations enregistrées'); }
 
      // Palmarès Top-N
      const best = Array.isArray(ctx.best)? ctx.best.slice() : [];
      if(best.length){
        slog(`Supabase: création palmarès (${best.length})...`);
        const setId = await createPalmaresSet({ user_id: uid, symbol: sym, tf, profile_id: profileId || null, top_n: best.length, note: `Lab ${sym} ${tf}` });
        if(setId){
          const entries = []; let rank=1;
          const used=new Set();
          function genName(){ try{ if(typeof window!=='undefined' && typeof window.randomName==='function'){ return window.randomName(); } }catch(_){ }
            const pool=['aurora','zenith','ember','nova','atlas','odyssey','vertex','harbor','willow','meadow']; return pool[Math.floor(Math.random()*pool.length)]; }
          for(const b of best){
            let nm = (b.name||null);
            if(!nm){ let tries=0; do{ nm=genName(); tries++; }while(used.has(nm)&&tries<5); used.add(nm); }
            entries.push({ set_id: setId, rank, name: nm, params: canonicalParamsFromUI(b.params||{}), metrics: b.metrics||b.res||{}, score: (typeof b.score==='number')? b.score : 0, provenance: 'UI:Lab', generation: (b.gen!=null? b.gen:1) });
            rank++;
          }
          try{
            await insertPalmaresEntries(entries); slog('Supabase: entrées palmarès insérées');
          }catch(e){ slog('Supabase: insert palmarès_entries KO — '+(e&&e.message?e.message:e)); }
        } else {
          slog('Supabase: création palmarès_set KO (id absent)');
        }
        // Mark selected — même si setId est null, on passe selected=true pour pouvoir lire via fetchPalmares
        try{
          const selRows = best.map(b=> ({ user_id: uid, symbol: sym, tf, profile_id: profileId || null, params: canonicalParamsFromUI(b.params||{}) }));
          await markSelectedForSet(selRows, setId||null); slog('Supabase: stratégies marquées selected=true');
        }catch(e){ slog('Supabase: mark selected KO — '+(e&&e.message?e.message:e)); }
        slog('Supabase: fin persistance Lab');
      } else {
        slog('Supabase: aucun “best” à enregistrer');
      }
    }catch(e){ slog('Supabase: persistLabResults exception — '+(e&&e.message?e.message:e)); console.warn('persistLabResults error', e); }
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

async function fetchKnownCanonicalKeys(symbol, tf, profileName){
    const c=ensureClient(); if(!c) return new Set();
    const profileId = await getProfileIdByName(profileName || currentProfileName());
    const out=new Set();
    let from=0, step=1000; // simple paging
    for(;;){
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
        // Limite de sécurité pour ne pas charger un volume énorme en mémoire
        const MAX_KEYS = 5000;
        if(out.size >= MAX_KEYS) break;
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

async function fetchPalmares(symbol, tf, limit=25, profileName){
    const c=ensureClient(); if(!c) return [];
    const profileId = await getProfileIdByName(profileName || currentProfileName());
    function mapRows(rows){ const out=[]; let idx=1; for(const row of rows||[]){ const paramsUI=uiParamsFromCanonical(row.params||{}); const metrics=row.metrics||{}; const score=(typeof row.score==='number')? row.score:0; const name=row.name||null; out.push({ id:'db_'+(idx++), name, gen:1, params:paramsUI, res:metrics, score, ts:Date.now() }); } return out; }
    try{
      // Primary: global best by pair/TF (selected=true), ordered by score desc
      let q = c
        .from('strategy_evaluations')
        .select('params,metrics,score')
        .eq('symbol', symbol)
        .eq('tf', tf)
        .eq('selected', true)
        .order('score', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(Math.max(1, limit));
      if(profileId!=null) q = q.eq('profile_id', profileId); else q = q.is('profile_id', null);
      let { data, error } = await q;
      if(!error && Array.isArray(data) && data.length){ return mapRows(data); }

      // Fallback: latest palmarès set entries (includes names)
      let qs = c
        .from('palmares_sets')
        .select('id, created_at')
        .eq('symbol', symbol)
        .eq('tf', tf)
        .order('created_at', { ascending:false })
        .limit(1);
      if(profileId!=null) qs = qs.eq('profile_id', profileId); else qs = qs.is('profile_id', null);
      const { data:sets, error:err2 } = await qs;
      if(!err2 && Array.isArray(sets) && sets.length){
        const setId = sets[0]?.id;
        if(setId){
          const qe = c
            .from('palmares_entries')
            .select('params,metrics,score,rank,name')
            .eq('set_id', setId)
            .order('rank', { ascending:true })
            .limit(Math.max(1, limit));
          const { data:entries, error:err3 } = await qe;
          if(!err3 && Array.isArray(entries) && entries.length){ return mapRows(entries); }
        }
      }
      return [];
    }catch(_){ return []; }
  }

  // Heaven strategies API (Supabase)
  async function persistHeavenStrategy(ctx){
    try{
      const c=ensureClient(); if(!c){ slog('Supabase: client indisponible'); return false; }
      const row={ user_id: null, symbol: ctx.symbol, tf: ctx.tf, name: (ctx.name||null), params: ctx.params||{}, metrics: ctx.metrics||null };
      const { error } = await c.from('heaven_strategies').upsert([row], { onConflict: 'symbol,tf,name', ignoreDuplicates: false, returning: 'minimal' });
      if(error){ slog('Supabase: persistHeavenStrategy KO — '+(error.message||error)); return false; }
      slog('Supabase: Heaven sauvegardée');
      return true;
    }catch(e){ slog('Supabase: persistHeavenStrategy exception — '+(e&&e.message?e.message:e)); return false; }
  }
  async function fetchHeavenStrategies(symbol, tf, limit=50){
    const c=ensureClient(); if(!c) return [];
    try{
      const { data, error } = await c
        .from('heaven_strategies')
        .select('id,name,params,metrics,created_at')
        .eq('symbol', symbol)
        .eq('tf', tf)
        .order('created_at', { ascending:false })
        .limit(Math.max(1, limit));
      if(error){ slog('Supabase: fetchHeavenStrategies KO — '+(error.message||error)); return []; }
      return Array.isArray(data)? data : [];
    }catch(_){ return []; }
  }
  async function deleteHeavenStrategy(id){
    const c=ensureClient(); if(!c || !id) return false;
    try{ const { error } = await c.from('heaven_strategies').delete().eq('id', id); if(error){ slog('Supabase: deleteHeavenStrategy KO — '+(error.message||error)); return false; } return true; }catch(_){ return false; }
  }
  async function renameHeavenStrategy(id, name){
    const c=ensureClient(); if(!c || !id) return false;
    try{ const { error } = await c.from('heaven_strategies').update({ name }).eq('id', id); if(error){ slog('Supabase: renameHeavenStrategy KO — '+(error.message||error)); return false; } return true; }catch(_){ return false; }
  }

  // Headless live sessions API (Supabase)
  async function startHeadlessLive(ctx){
    const c=ensureClient(); if(!c) return { ok:false };
    try{
      const p = (ctx && ctx.params) || (typeof window!=='undefined' && typeof window.currentHeavenParamsForPersist==='function'? window.currentHeavenParamsForPersist(): {});
      const name = (ctx && ctx.name) || (typeof window!=='undefined' && window.liveWalletName && window.liveWalletName.value) || (typeof window!=='undefined' && window.randomName && window.randomName()) || 'live';
      const base = {
        user_id: null,
        wallet_id: null,
        name,
        symbol: ctx.symbol,
        tf: ctx.tf,
        active: true,
        strategy_params: p,
        equity: Number(ctx.startCap)||0,
        start_cap: Number(ctx.startCap)||0,
        fee: Number(ctx.fee||0.1)||0.1,
        lev: Number(ctx.lev||1)||1,
        last_bar_time: null,
        pos: null,
        updated_at: new Date().toISOString(),
      };
      // Idempotent by name for public pool (user_id IS NULL):
      // 1) Try update existing row(s)
      let updated = false;
      try{
        const { data: ex, error: e0 } = await c
          .from('live_sessions')
          .select('id')
          .eq('name', name)
          .is('user_id', null)
          .maybeSingle();
        if(!e0 && ex && ex.id){
          const { error: e1 } = await c.from('live_sessions').update(base).eq('id', ex.id);
          if(e1){ slog('Supabase: startHeadlessLive update KO — '+(e1.message||e1)); }
          else { updated = true; }
        }
      }catch(_){ }
      // 2) If not updated, insert new row
      if(!updated){
        const { error: e2 } = await c.from('live_sessions').insert([base], { returning: 'minimal' });
        if(e2){ slog('Supabase: startHeadlessLive insert KO — '+(e2.message||e2)); return { ok:false, error:e2.message||String(e2) }; }
      }
      return { ok:true };
    }catch(e){ return { ok:false, error:(e&&e.message)||String(e) }; }
  }
  async function stopHeadlessLiveByName(name){
    const c=ensureClient(); if(!c||!name) return false;
    try{ const { error } = await c.from('live_sessions').update({ active:false }).eq('name', name); if(error){ slog('Supabase: stopHeadlessLive KO — '+(error.message||error)); return false; } return true; }catch(_){ return false; }
  }
async function fetchHeadlessSessions(limit=50){
    const c=ensureClient(); if(!c) return [];
    try{ const { data, error } = await c.from('live_sessions').select('id,name,symbol,tf,active,equity,start_cap,created_at,updated_at').order('updated_at',{ascending:false}).limit(Math.max(1,limit)); if(error){ slog('Supabase: fetchHeadlessSessions KO — '+(error.message||error)); return []; } return Array.isArray(data)? data:[]; }catch(_){ return []; }
  }
async function fetchHeadlessSessionByName(name){
    const c=ensureClient(); if(!c||!name) return null;
    try{ const { data, error } = await c.from('live_sessions').select('id,name,symbol,tf,active,equity,start_cap,last_bar_time,created_at,updated_at').eq('name', name).maybeSingle(); if(error){ slog('Supabase: fetchHeadlessSessionByName KO — '+(error.message||error)); return null; } return data||null; }catch(_){ return null; }
  }
  async function fetchLiveEvents(sessionId, sinceIso, limit=500){
    const c=ensureClient(); if(!c||!sessionId) return [];
    try{
      let q = c.from('live_events').select('id,kind,at_time,payload').eq('session_id', sessionId).order('at_time',{ascending:true}).limit(Math.max(1,limit));
      if(sinceIso){ q = q.gt('at_time', sinceIso); }
      const { data, error } = await q;
      if(error){ slog('Supabase: fetchLiveEvents KO — '+(error.message||error)); return []; }
      return Array.isArray(data)? data:[];
    }catch(_){ return []; }
  }
  function subscribeLiveEvents(sessionId, onInsert){
    const c=ensureClient(); if(!c||!sessionId) return { unsubscribe(){}};
    const channel = c.channel('live_events_'+sessionId)
      .on('postgres_changes', { event: 'INSERT', schema:'public', table:'live_events', filter:`session_id=eq.${sessionId}` }, (payload)=>{
        try{ if(typeof onInsert==='function') onInsert(payload.new); }catch(_){ }
      })
      .subscribe((status)=>{ try{ slog('Supabase: realtime '+status); }catch(_){ } });
    return {
      unsubscribe(){ try{ c.removeChannel(channel); }catch(_){ } }
    };
  }

  // Live wallets API (Supabase)
  // Persist a wallet (public/no-auth by default): { name, startCap, fee, lev, exchange='paper', base_currency='USDC' }
  async function persistLiveWallet(ctx){
    try{
      const c=ensureClient(); if(!c){ slog('Supabase: client indisponible'); return false; }
      const row={
        user_id: null,
        name: String(ctx.name||'').trim(),
        exchange: String(ctx.exchange||'paper'),
        base_currency: String(ctx.base_currency||'USDC'),
        paper: true,
        leverage: Number(ctx.lev||ctx.leverage||1) || 1,
        settings: { start_cap: Number(ctx.startCap||ctx.start_cap||0)||0, fee: Number(ctx.fee||0)||0 }
      };
      if(!row.name){ slog('Supabase: persistLiveWallet — nom requis'); return false; }
      const { error } = await c
        .from('wallets')
        .upsert([row], { onConflict: 'name,exchange', ignoreDuplicates: false, returning: 'minimal' });
      if(error){ slog('Supabase: persistLiveWallet KO — '+(error.message||error)); return false; }
      slog('Supabase: Wallet sauvegardé');
      return true;
    }catch(e){ slog('Supabase: persistLiveWallet exception — '+(e&&e.message?e.message:e)); return false; }
  }

  async function fetchLiveWallets(limit=100, exchange='paper'){
    const c=ensureClient(); if(!c) return [];
    try{
      const { data, error } = await c
        .from('wallets')
        .select('id,name,exchange,base_currency,paper,leverage,settings,created_at')
        .eq('exchange', exchange)
        .order('created_at', { ascending:false })
        .limit(Math.max(1, limit));
      if(error){ slog('Supabase: fetchLiveWallets KO — '+(error.message||error)); return []; }
      const map = (row)=>({
        id: row.id,
        name: row.name,
        lev: Number(row.leverage||1) || 1,
        startCap: Number(row.settings&&row.settings.start_cap)||0,
        fee: Number(row.settings&&row.settings.fee)||0,
        exchange: row.exchange||'paper',
        base_currency: row.base_currency||'USDC',
        paper: !!row.paper,
        created_at: row.created_at,
      });
      return Array.isArray(data)? data.map(map) : [];
    }catch(_){ return []; }
  }

  async function deleteLiveWallet(name, exchange='paper'){
    const c=ensureClient(); if(!c || !name) return false;
    try{ const { error } = await c.from('wallets').delete().eq('name', name).eq('exchange', exchange); if(error){ slog('Supabase: deleteLiveWallet KO — '+(error.message||error)); return false; } return true; }catch(_){ return false; }
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
    getProfileIdByName,
    fetchLabProfileWeights,
    upsertLabProfileWeights,
    // Heaven
    persistHeavenStrategy,
    fetchHeavenStrategies,
    deleteHeavenStrategy,
    renameHeavenStrategy,
    // Headless live
    startHeadlessLive,
    stopHeadlessLiveByName,
    fetchHeadlessSessions,
    fetchHeadlessSessionByName,
    fetchLiveEvents,
    subscribeLiveEvents,
    // Wallets
    persistLiveWallet,
    fetchLiveWallets,
    deleteLiveWallet,
  };
})();
