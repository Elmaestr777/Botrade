---
name: botrade-ui-audit
description: Audit UI Botrade, boutons, modales, parametres Heaven, smoke test navigateur, lint. Utiliser pour verifier que l'interface est branchee et fonctionne. Ne pas utiliser pour l'optimisation quantitative pure sans changement UI.
---

# Objectif

Verifier rapidement que l'UI Botrade est coherente, que les controles visibles sont branches, et que les parcours principaux fonctionnent dans le navigateur local.

# Quand utiliser ce skill

- Revue complete ou partielle de l'UI Botrade.
- Verification des modales Backtest, Lab, Heaven, EMA, Live, Supabase ou palmares.
- Controle des parametres affiches dans la box Heaven.
- Correction de boutons visibles sans handler ou de libelles HTML corrompus.

# Quand ne pas utiliser ce skill

- Optimisation de strategies sans modification UI.
- Schema Supabase, migrations ou RLS sans impact interface.
- Refonte visuelle large demandant une direction produit ou design.

# Entrees attendues

- `index.html`
- `src/main.js`
- `styles.css` si la demande implique layout, visibilite ou responsive.
- URL locale, par defaut `http://127.0.0.1:5173/`.

# Procedure standard

1. Lister les elements interactifs (`button`, `input`, `select`, `textarea`) et comparer leurs `id` aux references JS.
2. Filtrer les faux positifs dynamiques (`optTP*`, `labTP*`, `btOpt*`, etc.) avant de conclure qu'un controle est orphelin.
3. Verifier toutes les references `data-i18n*`: texte, titre, placeholder et aria-label.
4. Verifier que les libelles des boutons correspondent a leur action reelle (`save`, `load`, `apply`, `delete`, `reset`, `cancel`).
5. Verifier les octets NUL ou libelles corrompus dans `index.html` et `src/main.js`.
6. Corriger les handlers manquants, les libelles trompeurs ou les chemins UI fantomes.
7. Tester dans le navigateur local les parcours visibles principaux.
8. Pour Heaven, faire au moins un round-trip de sauvegarde sur un echantillon: general, fib/entry, TP dynamique.
9. Restaurer un etat UI propre apres les tests quand des controles persistants ont ete modifies.

# Regles de decision

- Un bouton visible ne doit pas lancer un chemin cache dont les resultats ne sont ni affiches ni persistes.
- Les controles caches volontairement par type (`Fib`, `Percent`, `EMA`) ne sont pas des bugs si le type les masque explicitement.
- Ne pas cliquer sur les actions destructives ou externes pendant un smoke test: suppression, live reel, envoi de secrets, sauvegarde Supabase non demandee.
- Les strategies et meilleurs resultats Heaven restent Supabase-only; ne pas ajouter de stockage local de strategies.

# Verifications

- `node --check src\main.js`
- `npm run lint -- --quiet`
- `git diff --check`
- Audit i18n: zero cle manquante pour `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, `data-i18n-aria-label`.
- Audit libelles: aucun bouton action avec cle i18n contradictoire.
- Smoke test navigateur sur: EMA, Heaven, Backtest, Backtest -> Lab, Lab, palmares global, theme/langue, drawer Live.
- Controle console navigateur: aucune erreur apres reload.

# Sortie attendue

- Resume court des problemes trouves et corriges.
- Liste des validations executees.
- Commit/push si la demande utilisateur l'inclut.

# Maintenance du skill

Mettre a jour ce skill si :
- un nouveau module UI devient central ;
- un bouton ou modal change de workflow canonique ;
- les IDs dynamiques changent ;
- une verification manuelle devient automatisable.
