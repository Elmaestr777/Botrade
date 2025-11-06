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
    // Expect a toEngineParams()-like object
    // Normalize keys order by reconstructing new object
    const tpArr = Array.isArray(p.tp)? p.tp.map(t=>({
      type: t.type||'Fib',
      fib: (t.fib!=null? t.fib : t.value),
      pct: (t.pct!=null? t.pct : undefined),
      emaLen: (t.emaLen!=null? t.emaLen : undefined),
      qty: (t.qty!=null? t.qty : undefined),
    })) : [];
    const slArr = Array.isArray(p.sl)? p.sl.map(t=>({
      type: t.type||'Percent',
      fib: (t.fib!=null? t.fib : undefined),
      pct: (t.pct!=null? t.pct : undefined),
      emaLen: (t.emaLen!=null? t.emaLen : undefined),
    })) : [];
    return {
      nol: p.nol|0,
      prd: p.prd|0,
      slInitPct: +p.slInitPct,
      beAfterBars: p.beAfterBars|0,
      beLockPct: +p.beLockPct,
      emaLen: p.emaLen|0,
      entryMode: String(p.entryMode||'Both'),
      tpEnable: !!p.tpEnable,
      tp: tpArr,
      slEnable: (p.slEnable!=null? !!p.slEnable : (slArr.length>0)),
      sl: slArr,
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
        const { data, error } = await c
          .from('strategy_evaluations')
          .select('params')
          .eq('symbol', symbol)
          .eq('tf', tf)
          .eq('profile_id', profileId)
          .range(from, from+step-1);
        if(error) break;
        if(!Array.isArray(data) || !data.length) break;
        for(const row of data){ try{ out.add(JSON.stringify(row.params||{})); }catch(_){ } }
        if(data.length<step) break;
        from += step;
      }catch(_){ break; }
    }
    return out;
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
  };
})();
