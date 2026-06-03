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
3. Faire echouer clairement les flux Heaven si Supabase est requis mais indisponible.
4. Persister les meilleurs resultats dans `palmares_sets`, `palmares_entries` et, si recharge UI attendue, `heaven_strategies`.
5. Ajouter une migration de grants/RLS seulement si l'acces Data API ou la securite Supabase le justifie.

# Regles de decision

- Les meilleures strategies ne doivent pas etre sauvegardees en `localStorage` quand Supabase-only est demande.
- Les sorties Python ne doivent pas sauvegarder de parametres de strategie dans `runs/` quand Supabase-only est demande.
- La strategie Heaven courante (`lbcOptions`) ne doit pas etre rechargee ou sauvegardee localement quand Supabase-only est demande.
- Les preferences UI peuvent rester locales si elles ne representent pas un palmares, un preset ou une strategie selectionnee.
- Les erreurs Supabase doivent etre visibles dans le statut/log, pas masquees par un fallback local.
- Les upserts publics sur des identites contenant des colonnes nullables exigent une cible unique compatible avec PostgREST, par exemple un index `NULLS NOT DISTINCT`.
- Si plusieurs moteurs copient la logique Heaven, noter le risque de parite et tester le moteur modifie.

# Verifications

- `npm run lint -- --quiet`
- `node --check runner/index.js` si le runner headless est modifie.
- `deno check supabase/functions/live-runner/index.ts` si `deno` est disponible et que l'Edge Function est modifiee.
- `python -m ruff check heaven_opt run_optimize.py tests`
- `python -m pytest -q`
- `rg "localStorage\\.(setItem|getItem).*?(lab:palmares|lab:results|lbcPreset|lbcOptions)" src -n`
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
