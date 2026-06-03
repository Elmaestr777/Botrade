# Audit - Snapshot courant

Date: 2026-06-03
Dépôt: Botrade / Heaven

## 1) Architecture et fonctionnalités

- `index.html`, `src/main.js`, `src/worker_eval.js`
  - Graphiques Lightweight Charts, données Binance REST et WebSocket.
  - Configuration Heaven, backtests visibles, Lab d'optimisation, palmarès global.
  - Mode live navigateur et suivi des sessions headless.
- `src/supa_ui.js`
  - Accès Data API Supabase pour profils, évaluations, palmarès, stratégies Heaven, wallets et sessions live.
- `heaven_opt/**`, `run_optimize.py`
  - Optimiseur Python: recherche aléatoire/grille, EA, raffinement bayésien, surrogate ML, walk-forward et Monte Carlo.
  - Simulation Heaven avec Line Break, entrées Fib, SL, break-even, TP Fib/Percent/EMA et sorties partielles.
- `runner/index.js`
  - Runner Node.js long-running, partagé par `(symbol, tf)`, alimenté par les WebSockets Binance.
- `supabase/functions/live-runner/index.ts`
  - Runner Edge Function périodique, alimenté par les klines REST Binance.
- `supabase/migrations/**`
  - Schéma, RLS, vues, grants Data API et index d'identité pour les upserts publics.

## 2) Flux de stratégies Heaven

1. Le Lab ou l'optimiseur Python évalue des paramètres.
2. Les évaluations sont écrites dans `strategy_evaluations`.
3. Les meilleurs résultats sont classés dans `palmares_sets` et `palmares_entries`.
4. Les stratégies rechargeables par l'UI sont écrites dans `heaven_strategies`.
5. Il n'existe plus de fallback local pour les résultats, palmarès, presets ou options Heaven.

Les préférences non stratégiques peuvent rester en `localStorage` : thème, langue, filtres, positions de fenêtres et cache de marché.

## 3) Problèmes corrigés lors de l'audit

- Persistance Python:
  - Supabase est obligatoire pour l'optimisation Heaven.
  - Les erreurs d'écriture ne sont plus masquées.
  - Les stratégies ne sont plus écrites dans `runs/.../results.yaml` ou `ea_seeds.yaml`.
- Scoring Python:
  - Le poids `cons` utilise maintenant la métrique `consistency`.
  - `maxDDAbs` mesure le vrai drawdown pic-vers-creux.
  - Le mode de recherche n'est plus écrasé par un mode d'entrée aléatoire dans les métadonnées.
- Runner Node.js:
  - Reconnexion WebSocket avec backoff et jitter.
  - Fermeture des streams devenus inutiles.
  - Persistance des cibles TP dans `pos` pour survivre aux redémarrages.
  - Chargement explicite de `.env.runner`.
  - Mise à jour de `ws` vers une version sans l'avis de sécurité détecté.
- Data API:
  - Les upserts de stratégies, évaluations et wallets utilisent des index d'identité `NULLS NOT DISTINCT` compatibles avec PostgREST.
- Edge Function:
  - Aucun retraitement de l'historique lorsqu'il n'existe aucune nouvelle bougie.
  - Les segments de pivots sont limités aux pivots confirmés au moment de la bougie traitée.
- Outils:
  - Configuration Ruff migrée vers les sections `tool.ruff.lint`.

## 4) Sécurité et Supabase

- La clé `service_role` reste réservée au runner et à l'optimiseur Python, jamais au navigateur.
- Les tables exposées utilisent RLS; les grants Data API sont séparés des politiques RLS.
- La vue exposée ajoutée par migration utilise `security_invoker`.
- Le modèle public actuel autorise les utilisateurs anonymes à manipuler les données publiques mutualisées. C'est fonctionnel mais reste un risque à réévaluer si des données privées ou multi-utilisateurs sont introduites.

## 5) Limites restantes

- Les runners headless utilisent une copie simplifiée du moteur Heaven. Ils ne couvrent pas encore toutes les entrées Fib Retracement, actions par TP et trails avancés disponibles dans le navigateur.
- Les écritures Supabase du palmarès sont plusieurs appels REST, pas une transaction atomique unique.
- `src/main.js` concentre encore beaucoup de responsabilités et augmente le risque de régression lors des changements UI.
- La vérification distante Supabase dépend de la disponibilité du projet et de l'application de la migration en attente.

## 6) Vérifications standard

- `npm run lint -- --quiet`
- `node --check runner/index.js`
- `python -m ruff check heaven_opt run_optimize.py tests`
- `python -m pytest -q`
- `npm audit --omit=dev`
- `npm audit --omit=dev` dans `runner/`
- `deno check supabase/functions/live-runner/index.ts` si Deno est disponible
- Test REST Supabase après application des migrations
