---
name: botrade-heaven-supabase
description: Botrade Heaven, Lab, palmares, meilleures strategies, Supabase-only storage, no local strategy storage. Use when changing Heaven strategy logic, Lab optimization, best strategy persistence, Supabase palmares, or localStorage removal. Do not use for unrelated UI styling or non-Heaven pages.
---

# Objectif

Garder le workflow Heaven fiable: moteurs coherents, meilleures strategies stockees dans Supabase, et aucun fallback local pour les palmares ou presets de strategie.

# Quand utiliser ce skill

- Modifications de `src/main.js`, `src/supa_ui.js`, `heaven_opt/**`, `runner/**` ou `supabase/migrations/**` liees a Heaven.
- Changements du Lab, du palmares, des strategies sauvegardees ou du live headless.
- Demandes "pas de local", "stocke dans Supabase", "meilleures strategies", "Heaven fonctionne".

# Quand ne pas utiliser ce skill

- Changements visuels sans effet sur Heaven ou Supabase.
- Preferences UI non strategiques, comme theme, langue ou layout.
- Taches ponctuelles de lecture sans modification.

# Entrees attendues

- Objectif utilisateur et perimetre: UI, moteur Python, runner, Supabase ou plusieurs.
- Fichiers a inspecter: `src/main.js`, `src/supa_ui.js`, `heaven_opt/simulator.py`, `heaven_opt/combo_generator.py`, migrations Supabase.
- Etat attendu du stockage: Supabase obligatoire ou fallback autorise.

# Procedure standard

1. Rechercher les chemins `readPalmares`, `writePalmares`, `persistLabResults`, `fetchPalmares`, `heaven_strategies`, `lbcOptions`, `results.yaml`, `ea_seeds.yaml` et `localStorage`.
2. Corriger d'abord les bugs moteur deterministes ou de parite qui cassent les backtests.
3. Pour la modale Heaven, comparer les champs `opt*` affiches avec `populateHeavenModal`, `lbcSave` et les chemins d'evaluation afin d'eviter les parametres fantomes.
4. Pour le coeur optimiseur, verifier que l'EA preserve les meilleurs individus observes et que les diagnostics de trades restent persistables en metriques numeriques.
5. Faire echouer clairement les flux Heaven si Supabase est requis mais indisponible.
6. Persister les meilleurs resultats dans `palmares_sets`, `palmares_entries` et, si recharge UI attendue, `heaven_strategies`.
7. Donner un `run_id` commun aux evaluations, au set et aux entrees d'un meme run quand les colonnes de run existent.
8. Pour une campagne multi-paires/TF, utiliser `run_experiment_matrix.py`: bougies cloturees, fenetre d'entrainement, holdout intact, profils par TF, puis gates paper. Sur les TF courts, ajouter `--include-no-be` pour tester `beEnable` actif/inactif sans relacher les gates; sur `1m`, utiliser `--time-budget-sec` plutot qu'un timeout externe brutal afin de persister les candidats partiels, et `--scalping-1m` pour forcer les entrees scalping avant d'augmenter le budget.
9. Pour faire avancer un scope de bout en bout, utiliser `advance_heaven_project.py --symbol <PAIR> --tf <TF>`: il compare `heaven_strategies`, `strategy_evaluations` et `live_sessions`, refuse les doublons paper, puis imprime la prochaine action. Ajouter `--start-paper --invoke-runner` seulement pour creer les sessions paper manquantes dans Supabase.
10. Pour lancer un candidat paper individuellement, utiliser `start_paper_candidate.py` afin de refuser automatiquement les strategies non eligibles et de rester Supabase-only.
11. Avant toute preparation live, utiliser `validate_paper_session.py` pour verifier les gates paper reels et enregistrer l'audit dans `live_events` si utile.
12. Ajouter une migration de grants/RLS seulement si l'acces Data API ou la securite Supabase le justifie.

# Regles de decision

- Les meilleures strategies ne doivent pas etre sauvegardees en `localStorage` quand Supabase-only est demande.
- Les sorties Python ne doivent pas sauvegarder de parametres de strategie dans `runs/` quand Supabase-only est demande.
- La strategie Heaven courante (`lbcOptions`) ne doit pas etre rechargee ou sauvegardee localement quand Supabase-only est demande.
- Les preferences UI peuvent rester locales si elles ne representent pas un palmares, un preset ou une strategie selectionnee.
- Les erreurs Supabase doivent etre visibles dans le statut/log, pas masquees par un fallback local.
- Les upserts publics sur des identites contenant des colonnes nullables exigent une cible unique compatible avec PostgREST, par exemple un index `NULLS NOT DISTINCT`.
- Une cible d'upsert pour `strategy_evaluations` doit inclure `run_id` afin de preserver l'historique immuable entre runs.
- Les vues ou lectures de "meilleures strategies" doivent dedupliquer les memes parametres entre runs sans supprimer l'historique des runs.
- Les metriques JSONB non finies (`Infinity`, `-Infinity`, `NaN`) doivent etre serialisees explicitement avant un appel REST Supabase.
- Un bulk upsert `strategy_evaluations` doit dedupliquer sa cible de conflit avant l'envoi pour eviter PostgreSQL `21000`.
- Le top-N d'un run doit contenir des parametres distincts avant validation et persistance dans le palmares.
- Les TP actifs identiques doivent etre fusionnes avant evaluation, hash, palmares, strategies rechargeables et paper pour eviter des ordres dupliques.
- Les noms de strategies generees automatiquement doivent commencer par un mot issu des dictionnaires francais, espagnol ou polonais du projet; le suffixe technique sert seulement a garantir l'unicite Supabase.
- Les profils d'optimisation doivent rester adaptes a chaque TF: plages Heaven, TP Percent, budget EA/Bayesian, `validation_top_n`, max trades et exposition ne doivent pas etre uniformes entre `1m`, `5m`, `15m`, `1h`, `4h` et `1d`.
- Les strategies qui overtradent ou restent trop exposees peuvent rester historisees, mais doivent recevoir une penalite de score et echouer aux gates paper via `max_trades`, `max_oos_trades`, `max_exposure_frac` ou `max_oos_exposure_frac`.
- Les scores train doivent rester nets de frais et decoter les candidats a rendement net negatif ou PF inferieur a 1.0; un perdant a faible drawdown ne doit pas dominer la recherche.
- Sur `15m`, preferer un profil selectif apres frais: `nol/prd` plus hauts, TP Percent plus larges, min OOS trades compatible avec une strategie moins frequente, et caps stricts d'exposition/trades.
- Un pivot de periode `prd` ne peut etre utilise qu'apres son delai de confirmation; toute utilisation a son index est une fuite du futur.
- Un signal calcule au close doit fermer la position opposee au close du flip, puis entrer a l'open de la bougie suivante; deux positions ne doivent pas se chevaucher sur cette bougie.
- Le score final doit integrer les metriques de robustesse disponibles, notamment holdout, walk-forward et Monte Carlo.
- Les analyses de strategies doivent privilegier des metriques numeriques persistables (`diag_*`, `oos_diag_*`) plutot que des fichiers locaux.
- `beEnable` peut etre optimise via `be_enable_values` ou `--include-no-be`, mais un candidat sans break-even doit respecter les memes criteres paper.
- Une strategie non eligible au paper peut rester dans les evaluations et le palmares, mais ne doit pas etre copiee automatiquement dans `heaven_strategies`.
- Le runner paper headless supporte les entrees `Original`, `Fib Retracement` et `Both`; les modes inconnus ou `Fib Retracement` avec `useFibRet=false` ne doivent pas etre marques eligibles.
- Les wallets et sessions paper doivent rester Supabase-only; aucun fallback `localStorage` n'est autorise.
- Les runners headless paper doivent ignorer tout wallet non-paper; le live reel exige une activation et un moteur separes explicitement controles.
- Une session paper ne doit pas etre consideree live-ready sans validation Supabase des evenements reels (`live_events`) et sans gates explicites.
- Un run coupe par budget temps doit persister ses candidats avec `time_budget_exhausted=1` et rester non eligible paper tant que la validation robuste n'est pas complete.
- Une equity paper egale a zero est une valeur valide et ne doit jamais retomber sur `start_cap`.
- Un runner qui ne peut pas couvrir toutes les bougies manquees doit arreter la session et signaler un `history_gap`, jamais simuler un rattrapage partiel silencieux.
- Si plusieurs moteurs copient la logique Heaven, noter le risque de parite et tester le moteur modifie.

# Verifications

- `npm run lint -- --quiet`
- `node --check runner/index.js` si le runner headless est modifie.
- `deno check supabase/functions/live-runner/index.ts` si `deno` est disponible et que l'Edge Function est modifiee.
- `python -m ruff check heaven_opt run_optimize.py run_experiment_matrix.py start_paper_candidate.py validate_paper_session.py tests`
- `python -m ruff check advance_heaven_project.py`
- `python -m pytest -q`
- `python run_experiment_matrix.py --dry-run`
- Test UI modale Heaven si des champs `opt*` changent: ouvrir la modale, modifier les champs visibles, sauvegarder, rouvrir, comparer les valeurs et verifier l'absence d'erreur console.
- `rg "localStorage\\.(setItem|getItem).*?(lab:palmares|lab:results|lbcPreset|lbcOptions)" src -n`
- `rg "liveWallets|readLiveWallets|writeLiveWallets" src -n`
- `rg "results\\.yaml|ea_seeds\\.yaml" heaven_opt run_optimize.py -n`

# Sortie attendue

- Resumer les fichiers modifies et les chemins de stockage Supabase.
- Indiquer si la verification distante Supabase a reussi ou non.
- Mentionner toute limite restante, notamment migrations non appliquees ou hostname Supabase inaccessible.

# Maintenance du skill

Mettre a jour ce skill si :
- le schema Supabase change ;
- un nouveau moteur Heaven devient source de verite ;
- un fallback local redevient explicitement autorise ;
- les commandes de validation changent.
