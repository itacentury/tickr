# TODO

Findings from a deep review of the frontend (2026-06-10).
Ordered by priority. Frontend items already tracked in `TODO-backend.md` (B5, B6b, B6c) are referenced, not duplicated.

## Robustness

- [x] **F1 — `fetchHistory()` does not check `response.ok`** (bug, `frontend/src/render.js:245-255`)
      A 401/404/500 response is parsed as JSON (or throws), gets caught, and renders as an empty history — the failure is invisible to both the user and error reporting. Fix: throw on `!response.ok` before `response.json()` and report the error.

- [x] **F2 — `sessionExpired` flag is never reset** (design gap, `frontend/src/db/replication.js:16,24,60`)
      Once a 401 is seen, SSE stays closed and reconnects are suppressed for the lifetime of the page. This is only healed by the full reload after re-login (`frontend/src/main.js:60-62`). In the window between 401 and reload, sync stalls silently with no UI indication. Fix: either reset the flag on successful re-login or show a "signed out" state in the sync indicator.

- [ ] **F3 — No timeout on replication fetches** — tracked as **B6b** in `TODO-backend.md`
      (`frontend/src/db/replication.js:212,250`). A hung server stalls replication until the socket dies. Fix: AbortController with a 10-15s timeout; RxDB's `retryTime` handles the retry.

- [ ] **F4 — Unguarded `localStorage` access** (footgun, `frontend/src/data.js`, `frontend/src/events.js`)
      `tickr_current_list` and `sidebarCollapsed` are read/written without try/catch. Private browsing modes or a full quota can throw and break list selection or the sidebar toggle. Fix: small safe-storage wrapper that falls back to in-memory state.

- [ ] **F5 — SSE has no heartbeat/liveness check** (`frontend/src/db/replication.js:35-63`)
      A silently dropped EventSource connection stops live updates; the 3s reconnect only fires on an explicit `error` event. Replication still works on the 5s retry loop, but real-time updates degrade unnoticed. Fix: server-side keepalive pings plus a client-side staleness timer that forces a reconnect.

- [ ] **F6 — Sync-status subscriptions never cleaned up** — tracked as **B5** in `TODO-backend.md`
      (`frontend/src/sync-status.js:33-37`).

## Accessibility

- [ ] **F7 — No `:focus-visible` styles**
      Keyboard focus relies on browser defaults, which are barely visible on the dark theme. Dropdown/autocomplete ARIA (listbox/option, `aria-activedescendant`) is otherwise solid.

- [ ] **F8 — No `aria-live` region for toasts**
      Undo/error toasts (`frontend/src/toast.js`) appear without screen reader announcement, so the undo window is effectively invisible to assistive tech. Fix: `role="status"` / `aria-live="polite"` on the toast container.

- [ ] **F9 — Inline category forms lack labels; no skip link**
      The quick-create category inputs rely on placeholders only; the page has no skip-to-content link.

## Hygiene

- [ ] **F10 — `console.log` leftovers** (`frontend/src/main.js:78,97`)
      Service worker registration logs should be removed or gated behind a debug flag.

- [ ] **F11 — Malformed SSE messages silently swallowed** — tracked as **B6c** in `TODO-backend.md` (`frontend/src/db/replication.js:52-54`).

- [ ] **F12 — Magic numbers scattered** (5000ms replication retry, 3000ms SSE reconnect, 500ms sync-indicator delay, undo window, `setTimeout(..., 100)` focus workarounds). Centralize in a constants module.

- [ ] **F13 — `setupEventListeners()` is monolithic** (`frontend/src/events.js`, ~720 lines)
      Hard to navigate and test. Split into per-feature wiring functions (nav, items, modals, settings, keyboard, swipe).

- [x] **F14 — No linter, tests, or type checking for the frontend**
      Only Prettier is configured (`frontend/package.json`). Consider ESLint + vitest; the pure modules (`category-tag.js`, sort logic in `data.js`, converters in `db/replication.js`) are cheap to unit-test.

## Reviewed and fine

- XSS: all user-supplied text goes through `escapeHtml()` before `innerHTML`; category colors are sanitized to 6-digit hex; styles applied CSP-safely via CSSOM (`render.js`).
- Category draft lifecycle: `discardCategoryDraft()` is called on every modal close path; no draft leaks between the edit-list and edit-item modals.
- Module dependency graph is acyclic with a strict one-way data flow (data → state/bus → render); no dead frontend code found.
