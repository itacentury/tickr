# TODO

Findings from a deep review of the backend and the RxDB sync implementation (2026-06-10).
Ordered by priority.

## Sync protocol

- [ ] **B1 — No SSE broadcast on partial-conflict push batches** (bug, `backend/routes/sync.py:426-428`)
      The broadcast only fires `if not conflicts`. A push batch with e.g. 9 successful writes and 1 conflict commits the 9 writes but never notifies other clients, so they only learn about the changes on the next unrelated event. Fix: broadcast whenever at least one write succeeded (track a `wrote_any` flag), independent of the conflicts list.

- [ ] **B2 — Conflict detection compares only `updated_at`** (design limit, `backend/routes/sync.py:327-329`)
      `_states_match()` checks timestamp equality only (millisecond precision). Two clients that happen to produce the same `updated_at` silently overwrite each other without a detected conflict. Acceptable for a single-user app; a full field comparison of `assumedMasterState` against the current row (or a revision counter) would be more robust.

- [ ] **B3 — Updates fill missing fields with defaults instead of current values** (footgun, `backend/routes/sync.py:308-313`)
      `_resolve_values()` combined with `model_dump(exclude_unset=True)` (line 384) means a partial `newDocumentState` resets omitted fields to collection defaults (e.g. `text=""`) on update rather than preserving the stored value. The RxDB client always sends complete documents, so this is latent — but any other API consumer would corrupt data. Fix: fill gaps from `current_dict` instead of `spec.defaults()` when updating.

- [ ] **B4 — Tombstones accumulate forever**
      The pull endpoint returns all soft-deleted documents indefinitely; nothing ever purges them. A fresh device transfers the entire deletion graveyard on initial sync. Consider periodically purging tombstones older than N days — clients offline longer than that already fall into the IndexedDB wipe-and-resync recovery path (`frontend/src/db/index.js:57-67`).

## Frontend hygiene

- [ ] **B5 — Replication subscriptions are never cleaned up**
      `rep.active$.subscribe(...)` in `frontend/src/sync-status.js:33-37` has no unsubscribe, and `collectionSubjects` in `frontend/src/db/replication.js:17` is never cleared. Currently safe because `initApp()` runs once per page load and re-login forces a full reload, but fragile if the app lifecycle ever changes. Fix: store subscriptions and dispose them in `cleanupSSE()`.

## Minor

- [ ] **B6a** — `history` table has no `ON DELETE CASCADE` (`backend/database.py:53-60`); irrelevant with soft deletes, but a hard delete would leave orphaned rows.
- [ ] **B6b** — Pull/push `fetch()` calls have no timeout or `AbortController` (`frontend/src/db/replication.js:212,250`); a hung server stalls replication until the socket dies.
- [ ] **B6c** — Malformed SSE messages are silently swallowed (`frontend/src/db/replication.js:52-54`); logging unexpected payloads would make sync failures debuggable.
