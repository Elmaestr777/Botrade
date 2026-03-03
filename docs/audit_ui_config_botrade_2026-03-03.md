# Audit complet — points de configuration UI Botrade

_Date_: 2026-03-03  
_Périmètre demandé_: `src/main.js`, `run_optimize.py`, `heaven_opt/*.py` (+ `src/supa_ui.js` pour le mapping canonique)

---

## Résumé exécutif (10 lignes)

1. Le moteur **Backtest/Lab** utilisé par l’UI est majoritairement en **JavaScript** (`runBacktestSlice`, `runBacktestSliceFor`, `liveOnBar`), pas via `run_optimize.py`.
2. Les options critiques de risque/backtest (capital, frais, levier, max %, base, période) sont globalement **bien branchées** au moteur UI.
3. Le **Lab** (EA/Bayes/Hybrid, ranges, TP/SL avancés, objectifs, limites) est largement câblé et effectif dans l’exécution locale.
4. Le mapping des paramètres UI vers schéma canonique Python existe (`supa_ui.js`: `canonicalParamsFromUI`) et est cohérent pour la persistance Supabase.
5. En revanche, il n’existe **pas de pont direct UI → `run_optimize.py` / `heaven_opt.optimize_heaven`** : séparation forte front/back.
6. Le mode Live est en pratique « headless paper »; le label UI « Live trading réel » est **partiel/ambigu** (pas de flux exchange réel côté UI).
7. Défaut important: démarrage depuis drawer wallet force `fee=0.1` et `lev=1` (ignore paramètres wallet/session) => **Partiel/KO fonctionnel**.
8. La gestion du risque runtime stricte (`_runtime_risk_gate_errors`) est testée côté Python mais non invoquée par le flux UI local.
9. Les tests Python existants passent (smoke): `python -m pytest -q` => **8 passed**.
10. Priorité patch: (P0) corriger Live drawer fee/lev, (P1) clarifier/implémenter mode réel, (P1) unifier contrat UI↔engine Python (optionnel selon architecture cible).

---

## 1) Inventaire des options configurables UI (et branchement)

## A. Backtest modal (header)

- `btStartCap` (capital initial)
- `btFee` (frais)
- `btLev` (levier)
- `btMaxPct` (max % par trade)
- `btMaxBase` (base: initial/equity)
- Plage: `btRangeVisible` / `btRangeAll` / `btRangeDates` + `btFrom`, `btTo`
- Optimisation: `btOptInterval`, `btOptTopN`, `btOptMax`, `btUseTFPrior`
- Ranges d’optimisation: `btOptNol*`, `btOptPrd*`, `btOptSL*`, `btOptBEBars*`, `btOptBELock*`, `btOptEMALen*`

## B. Lab modal

- Contexte: `labProfile`, `labSymbol`, `labTF`
- Objectif/méthode: `labGoal`, `labStrategy`
- Risque: `labStartCap`, `labFee`, `labLev`, `labMaxPctMode`, `labMaxPct`
- Plage d’analyse: `labRangeMode`, `labFrom`, `labTo`
- Bornes d’exécution: `labTimeLimitSec`, `labMaxEvals`, `labMinScore`
- Mode avancé: `labAdvEn`/`labAdvancedToggle`
- Toggles variables: `labVarNol`, `labVarPrd`, `labVarSLInit`, `labVarBEBars`, `labVarBELock`, `labVarEMALen`, `labVarTP`, `labVarSL`, `labVarEntries`
- Ranges avancés: `labNol*`, `labPrd*`, `labSLInit*`, `labBEBars*`, `labBELock*`, `labEMALen*`
- TP/SL avancés: `labTP*`, `labSL*`, `labTPFibWrap`, `labSLFibWrap`
- Algo tuning: `labEAPop`, `labEAGen`, `labEAMut`, `labEACx`, `labBayIters`, `labBayInit`, `labBayElitePct`

## C. Heaven config (stratégie)

- Paramètres cœur `lbcOpts` (NOL, PRD, entry mode, Fib retracement, ladder TP/SL, BE, trails, EMA)
- Presets locaux (`lbcPreset*`)
- Persistance Supabase de stratégie Heaven (`lbcSupa*`, `heavenTF`, `heavenLoad*`, `heavenProfileSelect`)

## D. Live modal / wallets

- Session: `liveStartCap`, `liveFee`, `liveLev`, `liveTF`, source stratégie (`liveStratSrcHeaven`/`Palmares`) + `liveStrategy`
- Wallets: `liveWalletSel`, `liveWalletName`, save/load/delete
- Historique: `liveHistSessionSel`, `liveHistFrom`, `liveHistTo`

---

## 2) Statut par option (OK / Partiel / KO)

## A. Backtest

- Capital/frais/levier/max%/base: **OK**
- Période visible/all/dates: **OK**
- Optimisation ranges + TopN/MaxComb + prior TF: **OK**
- Effet réel: **OK** (appliqué dans `runBacktestSlice*` via `conf`/`params`)

## B. Lab

- Profil/symbole/TF/goal/strategy: **OK**
- Risque Lab (`readLabRiskConf`): **OK**
- Range mode + dates: **OK**
- Time limit / max evals / min score: **OK**
- Advanced toggles + ranges + TP/SL mutation/eval: **OK**
- Pondérations scoring profil: **OK**
- Persistance Supabase (tested + best + selected): **OK**

## C. Heaven config / canonique Python

- Mapping UI → canonique snake_case (`canonicalParamsFromUI`): **OK**
- Mapping canonique → UI (`uiParamsFromCanonical`): **OK**
- Exécution Python `run_optimize.py` directement depuis UI: **KO** (non connecté)

## D. Live

- Start live depuis modal avec cap/fee/lev/tf/params: **OK**
- Wallet CRUD local/Supabase: **OK**
- Start/stop depuis drawer checkbox/boutons: **Partiel/KO** (fee/lev hardcodés à 0.1/1)
- Mode « live réel » (exchange réel) exposé en UI: **Partiel/KO** (libellé présent, implémentation front = headless/paper)

---

## 3) Preuves (code path + test)

## Backtest/Lab (UI engine JS)

- Lecture conf backtest: `src/main.js` (~2964, ~3008)
- Simulation: `runBacktestSlice` / `runBacktestSliceFor` (~2668, ~2834)
- Quantité et risque (max%, base, fees, lev): `__computeQty` (~2707, ~2874)
- Lab run config: `labRun` handler (~5058+) + `readLabRiskConf` (~1872)

## Live

- Start modal: `liveStartBtn` (~6642) utilise `cap/fee/lev`
- Start depuis drawer (bug): `renderLiveDrawer` (~6444+) appelle `SUPA.startHeadlessLive(... fee:0.1, lev:1 ...)`

## Python engine / gates

- Runtime gate: `run_optimize.py::_runtime_risk_gate_errors` (lignes 17+)
- Config canonique: `heaven_opt/__init__.py` (Pydantic models)
- Optimizer principal: `heaven_opt/api.py::optimize_heaven`

## Tests exécutés (smoke)

Commande:

```bash
python -m pytest -q
```

Résultat:

- `8 passed in 0.79s`

Couvre notamment:

- garde-fou runtime risk gate (`tests/test_runtime_risk_gate.py`)
- metric gates & max DD fix (`tests/test_p0_p1_fixes.py`)
- génération patterns (`tests/test_basic.py`)

Limite: pas de tests auto UI DOM/headless pour valider visuellement chaque contrôle.

---

## 4) Risques métier

- **R1 (élevé)**: incohérence paramètres live (drawer force fee/lev) ⇒ simulation/perf trompeuse.
- **R2 (élevé)**: confusion « live réel » vs implémentation paper/headless ⇒ risque d’attente produit non satisfaite.
- **R3 (moyen)**: double moteur (UI JS vs Python) non unifié ⇒ divergences de résultat possibles.
- **R4 (moyen)**: gates de risque Python non appliqués au run UI local ⇒ garde-fous partiels selon chemin utilisé.
- **R5 (moyen)**: dette de test UI (pas d’e2e/smoke front) ⇒ régressions silencieuses sur câblage options.

---

## 5) Patchs recommandés priorisés

## P0 (immédiat)

1. **Corriger drawer live start** pour utiliser les paramètres session/wallet (fee/lev/cap), pas valeurs hardcodées.
   - Zone: `renderLiveDrawer` actions checkbox/play.
   - Attendu: reprendre `sess.fee`, `sess.lev`, `sess.start_cap` ou champs modal actifs.

## P1 (court terme)

2. **Clarifier le mode réel**: soit implémenter vrai flux exchange, soit retirer/renommer le libellé « live réel ».
3. **Contrat unique paramètres**: extraire schéma partagé UI↔Python (JSON schema) pour éliminer écarts.
4. **Appliquer (ou émuler) runtime risk gate côté UI run** pour cohérence de sécurité.

## P2 (moyen terme)

5. Ajouter tests e2e front (Playwright) pour: backtest modal, lab advanced, live wallet start/stop.
6. Ajouter tests de non-régression sur mapping `canonicalParamsFromUI` / `uiParamsFromCanonical` (round-trip).

---

## Conclusion

Le câblage UI→moteur est globalement bon pour **Backtest/Lab** (JS local), mais l’architecture actuelle sépare nettement ce flux de l’engine Python `run_optimize.py`. Les principaux écarts opérationnels sont concentrés sur **Live** (paramètres drawer, promesse mode réel) et sur l’**absence d’unification stricte** des garde-fous et du contrat de config entre front et backend.
