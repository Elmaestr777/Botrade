# Prompt d’audit — Configuration complète de l’algorithme d’optimisation

But: guider un audit technique exhaustif de l’optimiseur (architecture, paramètres, objectifs, algorithmes, validation, sorties, sécurité, convergence). Chaque section liste:
- Questions d’audit (à poser/valider)
- Où regarder dans le code
- Preuves à collecter (artefacts, extraits)
- Commandes de vérification (non destructives)

## 1) Architecture générale
Questions
- L’optimisation tourne-t-elle côté serveur, côté client, ou hybride (local + CLI/Cloud) ?
- Technologie du moteur (JS/TS WebWorker, Python, C++/Rust, etc.) ?
- Parallélisme (threading, multi-process, GPU, cluster) ?
- Caching/mémoïsation ou reprise (checkpoint) ?
- Backtesteur intégré à l’optimiseur ou séparé ?

Où regarder
- Front/UI: `index.html`, `src/main.js`, `src/opt_worker.js`
- Backend/CLI: `heaven_opt/**`, `run_optimize.py`, `requirements.txt`

Preuves
- WebWorker/`importScripts`, structures de cache (maps), appels à backtest
- Caches disque (joblib Memory), réutilisation EMA/LB/Pivots
- Séparation backtest (simulateur) vs orchestration EA/Bayes

Commandes (PowerShell)
- Select-String -Path (gci -Recurse -Include *.js).FullName -Pattern "new Worker|importScripts|localStorage|WebSocket"
- Select-String -Path (gci -Recurse -Include *.py).FullName -Pattern "joblib|Memory|optuna|deap"

## 2) Configuration des stratégies
Questions
- Sources de données (REST/WSS, CSV, broker) ?
- Stratégies codées, dynamiques ou templates ?
- Paramètres optimisés (NOL, PRD, SL/BE, EMA, TP types/ratios/allocations…) ?
- Bornes fixes vs espace adaptatif (grid, random, log, bayes) ?
- Filtrage/invalidation (min trades, max DD, etc.) ?

Où regarder
- UI: sections options/paramètres dans `src/main.js`
- Backend: `heaven_opt/simulator.py` (HeavenOpts), `config.example.yaml` (ranges), `heaven_opt/api.py`

Preuves
- Classes/options stratégiques, mapping UI → worker → backtest
- Ranges YAML (min/max/step) et bornes UI par profil
- Règles d’invalidation (min_trades, pénalités)

Commandes
- Select-String -Path (gci -Recurse -Include *.yaml,*.yml).FullName -Pattern "range|ranges|min|max|step"
- Select-String -Path (gci -Recurse -Include *.py).FullName -Pattern "HeavenOpts|min_trades|penal"

## 3) Objectifs d’optimisation
Questions
- Objectif principal (profit, Sharpe, DD, PF…)?
- Score multi-critères avec pondérations (profils Sûr/Balancé/Agressif) ?
- Pénalisation du risque/volatilité/complexité ?
- Normalisation des critères (0–1) avant agrégation ?

Où regarder
- UI scoring/poids: fonctions de score et presets de poids
- Backend scoring: `heaven_opt/scoring.py`, `config.example.yaml` (metrics.weights)

Preuves
- Fonctions de normalisation et agrégation, profils de poids

Commandes
- Select-String -Path (gci -Recurse -Include *.js,*.py).FullName -Pattern "score|weights|Sharpe|profitFactor|maxDD|calmar|expectancy"

## 4) Mécanismes d’optimisation
Questions
- Algorithmes utilisés (EA, Bayes, grid/random) ?
- Pour EA: pop, générations, mutation, crossover, sélection, élitisme ?
- Pour Bayes: sampler (TPE/GP/RF/QMC), acquisition (EI/UCB/PI), n_trials, warm start ?
- Enchaînement EA → Bayes ou exécution parallèle ?

Où regarder
- `heaven_opt/optimizer_ea.py`, `heaven_opt/optimizer_bayes.py`, orchestration `heaven_opt/api.py`

Preuves
- Paramètres clés, sélection tournoi/élitisme, TPE/QMC, refine_radius, seeds Best-of-EA

Commandes
- Select-String -Path (gci -Recurse -Include *.py).FullName -Pattern "DEAP|Optuna|TPESampler|QMC|elitism|tournament|mut|cx|n_trials|refine"

## 5) Validation et robustesse
Questions
- Split in-sample / out-of-sample ?
- Walk-forward intégré ? Monte Carlo ?
- Stratégies contre overfitting (min_trades, pénalités, robustesse) ?
- Reproductibilité (seed) ?
- Conservation des top-N, logs, artefacts ?

Où regarder
- `heaven_opt/validation.py`, appels dans `heaven_opt/api.py`
- `heaven_opt/utils.py` (seed), dossiers `runs/`

Preuves
- Appels WF/MC, conditions d’activation/désactivation, conservation YAML/CSV

Commandes
- Select-String -Path (gci -Recurse -Include *.py).FullName -Pattern "walk_forward|monte_carlo|seed|runs|results.yaml"

## 6) Sortie et interface utilisateur
Questions
- Présentation des résultats (table, graphique, ranking) ?
- Affichage de notes /100 ? Détails cliquables (paramètres, métriques, equity) ?
- Relance backtest/live depuis l’UI ? Export CSV/JSON ?
- Où sont stockés les résultats (localStorage, fichiers, DB) ?

Où regarder
- UI: modales Lab/Backtest/Stratégie dans `src/main.js`, `index.html`
- Export: fonctions CSV, `runs/*/results.yaml` côté backend

Preuves
- Tableaux/markers, modales détaillées, export CSV, stockage localStorage

Commandes
- Select-String -Path (gci -Recurse -Include *.js).FullName -Pattern "localStorage|CSV|export|modal|table|markers"

## 7) Sécurité et sandbox
Questions
- Exécution isolée (WebWorker, iframe, Docker) ?
- CSP, scripts externes autorisés ?
- Gestion des clés/API et données sensibles ?

Où regarder
- `index.html` (CSP), usage `new Worker`, fetch vers API publiques

Preuves
- Politique CSP, absence d’API keys, frontières d’origin

Commandes
- Select-String -Path index.html -Pattern "Content-Security-Policy|worker-src|connect-src"

## 8) Finalisation
Questions
- Critères de convergence (itérations, stagnation, temps limite) ?
- Durée moyenne d’une optimisation ?
- Export des meilleures stratégies (JSON/CSV/PineScript) ?
- Besoin d’améliorer le moteur (perfs, parallélisme) ou plutôt l’analyse/visualisation ?

Où regarder
- Paramètres `n_generations`, `n_trials`, timeouts éventuels (UI)
- Exports: CSV (UI), YAML (backend), autres formats éventuels

Preuves
- Paramétrage convergence, exports, scripts de relance

Commandes
- Select-String -Path (gci -Recurse -Include *.js,*.py).FullName -Pattern "n_generations|n_trials|timeout|export|results.yaml"
