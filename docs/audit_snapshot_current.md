# Audit — Snapshot (configuration actuelle)

Date: 2025-11-03
Dépôt: Chart (UI JS + optimiseur Python)

Avertissement: ce snapshot cite des extraits et chemins avec numéros de ligne tels qu’observés dans le dépôt local. Marquer "À confirmer" si nécessaire.

---

## 1) Architecture générale
- Modèle: Hybride local
  - UI/Lab côté client avec WebWorker classique pour l’évaluation/backtest visible.
    - Worker boot: `src/main.js` 179–191 (création Worker, importScripts)
    - Worker impl.: `src/opt_worker.js` (caches, eval, backtest)
  - Optimiseur Python (CLI) pour batch/expérimentations: `run_optimize.py` + `heaven_opt/**`.
- Parallélisme
  - UI: exécution dans un WebWorker (mono-thread par worker). Caches: `pivotCache`, `emaCache`, `lbCache`, `sigCache`.
    - `src/opt_worker.js` 7–12 (Map caches), 54–116 (génération signaux/compute), 154–164 (backtest)
  - Python: interfaces exposent `n_jobs`, caches disque via joblib.Memory; EA/Optuna lancés de manière séquentielle dans le code fourni (À confirmer si parallélisme activé en prod).
    - `heaven_opt/signal_engine.py` 96–109 (cached_lb_piv via Memory)
    - `heaven_opt/data_loader.py` 48–51 (cache fetch_klines_range)
- Backtesteur séparé et intégré
  - JS: backtest visible et simulation TP/SL dans `src/main.js` 321–386
  - Python: backtesteur dans `heaven_opt/simulator.py` 320–387, appelé par l’API d’optimisation.

## 2) Configuration des stratégies
- Données
  - JS UI: REST Binance `/api/v3/klines` + WebSocket temps-réel
    - `src/main.js` 1771–1790 (fetchKlinesBatch), 1946–1996 (WebSocket)
  - Python: REST Binance via `requests` + cache
    - `heaven_opt/data_loader.py` 12–25, 28–45 (fetch_klines_range)
- Stratégie: Heaven (Line Break + ZigZag/Fib + ladder TP/EMA/Percent)
  - Paramètres (JS defaults): `src/main.js` 1005–1052 (defaultLBC)
  - Paramètres (Python): `heaven_opt/simulator.py` 14–51 (HeavenOpts)
- Paramètres optimisés & bornes
  - YAML ranges: `config.example.yaml` 10–16 (nol/prd/sl/be/ema)
  - Profils UI (bornes TF): `src/main.js` 1339–1344 (labBounds)
- Filtrage/invalidation
  - Pénalisation trade count minimal: `heaven_opt/api.py` 103–106 (min_trades → PF * 0.5 et pénalité PnL)

## 3) Objectifs d’optimisation
- Score multi-critères (backend)
  - Normalisations + agrégation: `heaven_opt/scoring.py` 4–38 (pf, sharpe, dd, rr, calmar, r2, slope, recov)
  - Poids (config): `config.example.yaml` 49–61 (metrics.weights)
- UI (Lab): profils de pondérations Sûr/Balancé/Agressif
  - `src/main.js` 1182–1188 (defaultWeights)
  - Score UI: `src/main.js` 1258–1277 (labScoreProfile)
- Pénalisations
  - min_trades (voir 2) ; DD intégré au score ; (Complexité: champ config non exploité dans scoring — À confirmer)

## 4) Mécanismes d’optimisation
- Mode hybride EA → Bayes (coarse → refine)
  - Orchestration: `heaven_opt/api.py` 149–206 (EA), 194–204 (Bayes refine)
- EA (DEAP)
  - `heaven_opt/optimizer_ea.py` 50–145: sélection tournoi (tools.selTournament), élitisme (HallOfFame), mutation/crossover simples; paramètres: pop_size, n_generations, cx_prob, mut_prob, elitism_frac, tournament_size.
- Bayes (Optuna)
  - `heaven_opt/optimizer_bayes.py` 51–82: TPE par défaut (TPESampler) ou QMC; `refine_radius` contrôle voisinage; `n_trials` itérations par seed.
  - Warm start depuis seeds EA: `heaven_opt/api.py` 181–188 (top M seeds), 194–204 (refine_seeds)

## 5) Validation et robustesse
- Walk-Forward + Monte Carlo (backend)
  - `heaven_opt/validation.py` (WF: 22–63; MC: 66–87)
  - Activation dans pipeline: `heaven_opt/api.py` 257–268, 271–283 (si HEAVEN_NO_WF ≠ 1)
- Reproductibilité / seed
  - `heaven_opt/utils.py` 58–70 (seed_everything)
- Conservation résultats
  - `heaven_opt/api.py` 289–296 → `runs/<YYYYMMDD_HHMMSS>/results.yaml`

## 6) Sortie et interface utilisateur
- Présentation
  - UI: tableaux, modales (Lab/Backtest/Détails) et markers sur graphique
    - Lab table: `src/main.js` 862–877 (table), 1204–1231 (renderLabFromStorage)
    - Détails stratégie: `src/main.js` 1331–1338 (openStratDetails)
    - Backtest visible + markers: `src/main.js` 374–386 (stats), 633–650/714–790 (rendus), 1710–1761 (subscribe markers)
- Export/stockage
  - CSV: `src/main.js` 1247–1257 (exportLabCSV)
  - localStorage: `src/main.js` 1178–1188, 1201–1210 (Lab results)
  - Backend: YAML `runs/.../results.yaml` (voir 5)

## 7) Sécurité et sandbox
- Isolation & CSP
  - WebWorker: `src/main.js` 179–191 (createBtWorker)
  - CSP restreinte: `index.html` 7–8 (Content-Security-Policy)
- Accès API
  - REST/WSS Binance publics; pas d’API keys stockées dans le dépôt (À confirmer par grep secrets)

## 8) Finalisation
- Convergence
  - EA: `n_generations` (config YAML 26–31), Bayes: `n_trials` (32–35), rayon `refine_radius`.
  - UI: progress et timeouts (p.ex. `src/main.js` 803–829 avec timer DUR)
- Durée moyenne: À confirmer selon jeu de données et machine.
- Export
  - YAML (backend), CSV (UI). PineScript présent (`LineBreakChartStrategy.pine`) mais pas export automatique.
- Améliorations possibles (pistes)
  - Paralléliser évals EA/Optuna (n_jobs effectif), meilleure reprise (checkpoint seeds), profiling hot paths.

---

### Annexes — Emplacements clés
- UI/JS: `index.html`, `src/main.js`, `src/opt_worker.js`, `styles.css`
- Optimiseur Python: `heaven_opt/**`, `run_optimize.py`, `config.example.yaml`, `requirements.txt`
- Artefacts: `runs/<timestamp>/results.yaml`, cache: `.cache_heaven/`
