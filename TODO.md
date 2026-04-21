# Frontend JavaScript — Refactoring TODO

Senior-Code-Review der `frontend/src/`-Module (Vanilla ES6 + RxDB + RxJS,
~2.7k Zeilen). Punkte sind nach Schaden/Aufwand-Verhältnis sortiert.
Kosmetik und spekulative Senior-Pattern sind bewusst ausgelassen.

---

## Tier 2 — Doppelter Code & Klarheit

### 2.3 Zirkuläre Abhängigkeit `data.js` ↔ `render.js`

- **Dateien:** `frontend/src/data.js:13`, `frontend/src/render.js:13`
- **Problem:** `data.js` importiert `renderNavigation`/`renderItems`,
  `render.js` importiert `selectList`/`reorderLists`/`updateItem`/
  `getItemCount`. Funktioniert nur, weil die Aufrufe erst nach Modul-Init
  passieren — bricht beim nächsten Refactor.
- **Fix (pragmatisch):** `data.js` ruft `render.js` nicht mehr direkt auf.
  Subscriptions schreiben nur `state` und emittieren auf einem RxJS-`Subject`
  (oder `EventTarget`); `render.js` und `events.js` abonnieren. Richtung wird
  einseitig: `render → data`.
- **Fix (alternativ, kleiner):** `selectList` und `getItemCount` aus `data.js`
  in ein neues `navigation.js` extrahieren — bricht den Zyklus ohne Pub/Sub.

---

## Tier 3 — Punktuelle Härtungen

- **`frontend/src/db/schemas.js`**
  - `_deleted` als `default: false` deklarieren.
  - Minimale `minLength` / `maxLength` für `name` und `text` ergänzen, damit
    leere/übergroße Datensätze blockiert werden.
  - Schema-Versioning (`migrationStrategies`) erst, wenn das Schema
    tatsächlich geändert wird.

- **`frontend/src/db/replication.js` Boolean-Konvertierung**
  - `completed` ist mal `0/1`, mal `boolean`. Im Schema als `boolean`
    deklarieren und die `? 1 : 0`-Konvertierungen entfernen.
  - Auch in `data.js:27`, `:185`, `:361`, `:385` Selectoren/Werte anpassen.

- **`frontend/public/sw.js` Cache-Versionierung**
  - `tickr-v2` aktuell hardcoded. Per Vite `define` aus `package.json`-
    Version injizieren, damit jeder Build automatisch neue Cache-Keys
    bekommt.

- **`frontend/src/error-reporting.js` HMR-Guard**
  - Sobald HMR im Dev-Setup eingeschaltet wird, doppelte Registrierung der
    `error`/`unhandledrejection`-Listener vermeiden:
    ```js
    if (!window.__errorReportingInit) {
      window.__errorReportingInit = true;
      window.addEventListener("error", ...);
      window.addEventListener("unhandledrejection", ...);
    }
    ```

---

## Bewusst NICHT auf der Liste

(Geprüft und für dieses Projekt verworfen — alles legitime Senior-Pattern,
hier aber Overengineering oder verfrüht:)

- TypeScript-Migration
- Toast-Queue, Modal-Manager-Klasse, EventManager-Klasse
- Splitten von `events.js`/`data.js` in Sub-Module um des Splittens willen
- Immer / Frozen State / dedizierte State-Library
- Indexes auf RxDB-Collections (erst wenn Perf gemessen leidet)
- Test-Infrastruktur, ESLint, vite-plugin-pwa (separater Plan, falls gewünscht)
- Exponential Backoff, Error-Batching (kein gemessener Pain-Point)

---

## Verifikation pro Tier

- **1.1 Listener-Leak:** DevTools → Memory → Heap-Snapshot vor/nach Fix
  vergleichen. 100 Items togglen, Anzahl Detached EventListeners sollte
  konstant bleiben.
- **1.2 `dbPromise`:** In DevTools `indexedDB.deleteDatabase("tickrdb")`
  während laufender App → Reload → `getDatabase()` zweimal aufrufen, zweiter
  Call darf nicht denselben Reject zurückgeben.
- **1.3 SSE-Reconnect:** Backend killen + restart → in Network-Tab nur
  _eine_ parallele Reconnect-Verbindung.
- **1.4 Counts:** Mit ~50 Items in 5 Listen ein Item togglen → Performance-
  Profile zeigt 1 Render statt N Queries.
- **2.x:** Manueller Smoke-Test (Liste anlegen / Items toggle/edit/delete /
  Undo / Sort wechseln / Mobile-Swipe / Settings / Cache leeren).
- **Build:** `cd frontend && npm run build` läuft ohne Warnings.
