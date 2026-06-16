# Code-Qualität: Vereinfachung, Deduplizierung, Lesbarkeit

Refactoring-Plan für tickr (FastAPI-Backend + Vanilla-JS-Frontend, Offline-First mit RxDB-Sync). Ziel: weniger Wiederholung, kleinere/lesbarere Einheiten, eine Quelle der Wahrheit pro Konzept — ohne Verhalten zu ändern. Phasen sind unabhängig committbar; nach jeder Phase laufen die Tests grün.

Reihenfolge nach Risiko/Nutzen: 1 → 5 → 2 → 3 → 4.

---

## Phase 1 — Backend: risikoarme Deduplizierung ✅

- [x] **1.1 Zentraler History-Insert-Helper** — `log_history()` in `backend/database.py`; ersetzt das ~10× duplizierte `INSERT INTO history …`. sync.py behält `_insert_history` als dünnen Wrapper (lokale Argument-Reihenfolge).
- [x] **1.2 Kombinierter Broadcast-Helper** — `notify_change(bg, event_type, collection, list_id=None)` in `backend/events.py`; ersetzt das ~12× wiederholte `broadcast_update` + `broadcast_sync`-Paar.
- [x] **1.3 Sortier-Whitelist zentralisieren** — `LIST_SORT_SQL` + `resolve_sort_sql()` in `backend/models.py`; ersetzt die inline neu aufgebaute Map in `lists.py` und die `assert`-Whitelist-Prüfungen (unter `python -O` wirkungslos).
- [x] **1.4 Response-Typannotationen schärfen** — fehlende Rückgabetypen/Local-Annotations in `backend/routes/history.py` und `backend/routes/settings.py`.

## Phase 5 — Konstanten-Drift absichern (kein Build-Schritt) ✅

- [x] Neuer Test `tests/test_constants_sync.py`: liest `backend/constants.py` und `frontend/src/db/constants.js` und assertet Gleichheit der gemeinsamen Schlüssel (`NAME_MAX`, `ICON_MAX`, `TEXT_MAX`, `ID_MAX`, `SORT_OPTION_MAX`, `TIMESTAMP_MAX`, `COLOR_HEX_MAX`). Schlägt fehl, sobald eine Seite driftet.

## Phase 2 — Backend: update_item entschachteln & History vereinheitlichen

- [x] **2.1 `update_item` entschachteln** (`backend/routes/items.py`) — 78 Zeilen mit bis zu 4 Verschachtelungsebenen; pro Feld dupliziertes History-Logging. Je Feld eine kleine Helferfunktion (`_apply_text`, `_apply_category`, `_apply_completed`), die `(updates, values)` füllt und via `log_history` protokolliert. `update_item` wird zur flachen Sequenz dieser Aufrufe.
- [ ] **2.2 Vereinheitlichtes diff-basiertes History-Logging (sync ↔ REST)** — gemeinsame Logik in neues Modul `backend/history.py`: `log_item_diff(cursor, old_row, new_values,
*, undo=False)` und Listen-Pendant. Sowohl `update_item` als auch die Sync-Push-Pfade nutzen denselben Code.
  > ⚠️ Achtung Verhaltensdifferenz: REST loggt `item_completed` + aktualisiert `completed_at` auch bei `completed=true` auf ein bereits erledigtes Item (No-op), während der Sync-Pfad diff-basiert nur bei echter Änderung loggt. Vor der Vereinheitlichung entscheiden, welche Semantik kanonisch ist (und ggf. Tests anpassen).

## Phase 3 — Frontend: Dedup & wiederverwendbare Utilities

- [x] **3.1 Geteilte DOM-Utilities** — `esc()` (in `metrics.js`, dupliziert `escapeHtml()` aus `render.js`) und `cssVar()` nach `frontend/src/dom.js` (oder `utils/dom.js`).
- [ ] **3.2 Event-Wiring-Helfer in `events.js`** — `wireIconPicker(toggle, container)`, `wireColorSwatchPicker(container, valueInput)`, `wireQuickCategoryForm(...)` extrahieren (mehrfach kopierte Add/Reset/Focus- und `closest().dataset`-Muster).
- [ ] **3.3 Generischer Feld-Konverter in `db/replication.js`** — die 6 fast identischen `serverXToClient`/`clientXToServer`-Funktionen durch Feld-Maps + zwei generische Konverter `toClient(collection, doc)` / `toServer(collection, doc)` ersetzen.
- [ ] **3.4 Farb-Punkt-Helfer in `render.js`** — `renderColoredDot(color, className)` extrahieren (mehrfach inline gebautes `sanitizeHexColor` + `data-color`-Span).

## Phase 4 — Frontend: Dateien aufteilen (Architektur)

Reine Move-Operationen + Barrel-Re-Exports, damit Importe stabil bleiben. Keine Logikänderung. Ziel: jede Datei ~150–250 LOC.

- [ ] **`data.js` (851 LOC)** → `data/subscriptions.js`, `data/crud.js`, `data/category-draft.js`, `data/sorting.js`; `data.js` bleibt schlanker Barrel.
- [ ] **`events.js` (952 LOC)** → `events/modals.js`, `events/categories.js`, `events/history.js`, `events/gestures.js`.
- [ ] **`metrics.js` (620 LOC)** → `metrics/dashboard.js`, `metrics/charts.js`, `metrics/formatters.js`.

---

## Verification

Nach **jeder** Phase ausführen.

**Backend (Phasen 1, 2, 5):**

- `uv run pytest`
- `uv run ruff check backend/ tests/`

**Frontend (Phasen 3, 4):**

- `cd frontend && npm test`
- `cd frontend && npx eslint src/`
- `cd frontend && npm run build`

**End-to-End-Smoke (nach Phase 4):** App starten und Item-CRUD, Kategorie-Anlage (Quick-Form in beiden Modals), History-Drawer (remove/reopen/restore) und das Metrics-Dashboard prüfen.
