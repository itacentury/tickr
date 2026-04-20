# Backend Review — TODO

Senior-review of the FastAPI backend in `backend/`. Items are grouped by priority and
reference the concrete file/line where applicable.

High-priority items #1–#8 are complete. Medium-priority items #9–#17 are complete.
See the "Done" section at the bottom.

---

## Medium priority (architecture / performance)

---

## Low priority (polish / DX)

### 18. No response models (`response_model=...`)

Endpoints return raw dicts. Defining `ListResponse`, `ItemResponse` Pydantic models
gives auto-filtered fields (no accidental `_deleted` leaks), typed OpenAPI schema
for frontend codegen, and guaranteed output shape.

### 19. `Field(..., max_length=N)` but no `min_length=1`

**File:** `backend/models.py`

Empty-string `name`/`text` is currently accepted. Add `min_length=1` and
`.strip()` validators.

### 20. `FrontendErrorReport` endpoint logs at ERROR level with no carve-out

**File:** `backend/routes/errors.py`

A buggy client can flood your logs. Either sample (log 1-in-N) or log at WARNING.

### 21. Health check duplicates SSE-count logic from metrics

**Files:** `backend/routes/monitoring.py:43-46`, `backend/metrics.py:119-122`

Factor into `events.get_connection_counts()`.

### 22. `dist_path.exists()` on every `/icons/*` request

**File:** `backend/routes/static.py:67`

Two `stat()` calls per icon request. Mount both directories as `StaticFiles` with
a fallback, or cache the resolution at startup.

### 23. `conftest.py` reimplements schema

**File:** `tests/conftest.py:19-59`

Two places to keep in sync with `database.py`. Refactor `init_db` to accept a
connection so tests can point it at `:memory:` and reuse the real schema.

### 24. `tests` DB connection is `scope="session"` but cleared per-test

A `scope="function"` in-memory DB is usually simpler and cheaper than the
teardown SQL. Benchmark before changing.

### 25. `broadcast_update` called synchronously after `db.commit()`

If broadcast ever does network I/O (it will after #9), you'd be holding up the
response. Broadcast _after_ returning via `BackgroundTasks`.

### 26. `DATABASE` imported directly in `monitoring.py`

**File:** `backend/routes/monitoring.py:10`

Tight coupling — health check can't be tested with a fake DB path. Move to
`Depends(get_db)` + `execute("SELECT 1")`.

### 27. `Request.client.host` trusts the peer socket

Behind a reverse proxy, all clients look like `127.0.0.1`. If deploying behind
nginx/traefik, read `X-Forwarded-For` (use `uvicorn --proxy-headers` + trusted
hosts list).

---

## Suggested next refactor order

With high- and medium-priority items done, the biggest remaining wins are:

1. **Pydantic `response_model`s** (#18) + `min_length=1` (#19) — tightens both
   ends of the API contract and unlocks frontend codegen.
2. **`X-Forwarded-For` trust** (#27) — prerequisite for deploying behind a
   reverse proxy without the rate limiter collapsing all traffic onto one IP.
3. **`DATABASE` via `Depends`** (#26) — unlocks testable health checks.

---

## Done (high priority)

All 8 items addressed. Implementation split across two commits:

### Commit 1 — Database layer hardening

- **#1 UTC timestamps** — `now()` now returns ISO-8601 with `Z` suffix and
  millisecond precision, so lexicographic sorting matches chronological order
  regardless of server TZ.
- **#4 SQLite `busy_timeout = 5000`** — added to `get_db`, `init_db`, and the
  health-check connection. Concurrent writers now wait up to 5s instead of
  erroring instantly.
- **#5 Indexes** — new `_ensure_indexes(conn)` helper creates
  `idx_items_list_id`, `idx_items_updated`, `idx_lists_updated` (idempotent via
  `IF NOT EXISTS`). Called unconditionally from `init_db` so existing DBs pick
  them up on next startup.
- **#7 `_ensure_columns` backfill** — `updated_at` column is added as
  nullable, then backfilled via `UPDATE ... SET updated_at = ?` with a real
  timestamp. No more empty strings sorting before valid ISO dates.

### Commit 2 — Route-layer hardening

- **#2 Pydantic sync-push model** — new `SyncChange` model with
  `newDocumentState`/`assumedMasterState` aliases (so RxDB's camelCase still
  validates) + `Body(..., max_length=500)` size cap. Missing `id` returns 422.
- **#3 Explicit transactions** — `delete_list` and `sync_push` bodies wrapped
  in `with db:` so partial failures roll back atomically.
- **#6 404 on `GET /lists/{id}/items`** — now checks list exists and isn't
  soft-deleted, raises `AppError(LIST_NOT_FOUND, ..., 404)`. New
  `LIST_NOT_FOUND` error code added to `ErrorCode` enum.
- **#8 Rate-limit `Retry-After` floor** — `max(1, int(...) + 1)` prevents a
  zero/negative value from slipping through on clock edge cases.

**Bonus (linter-driven):**

- Ruff `extend-immutable-calls` list now includes `Body`/`fastapi.Body`
  alongside existing `Depends` entries, since FastAPI idioms rely on calling
  these in argument defaults.

**Test coverage added:**

- `test_get_items_nonexistent_list` — asserts 404 + `LIST_NOT_FOUND`
- `test_push_malformed_change_missing_new_state` — asserts 422
- `test_push_missing_id_in_document_state` — asserts 422
- `test_push_batch_size_limit` — asserts 422 on 501-change payload
- `test_delete_list_soft_deletes` updated to expect 404 instead of `[]`

Test suite: **71 passing**, ruff clean.

## Done (medium priority)

### Commit 3 — SSE broadcaster refactor

- **#9 SSE busy-poll eliminated** — replaced `queue.get_nowait()` +
  `asyncio.sleep(0.1)` with `asyncio.Queue` and
  `asyncio.wait_for(queue.get(), timeout=HEARTBEAT)`. One `await` now serves
  both heartbeats and messages, so broadcast latency dropped from ~50 ms
  (half the old poll floor) to effectively zero.
- **#10 Duplicated SSE code extracted** — new `SseBroadcaster` class in
  `backend/events.py` owns the client set, per-client `asyncio.Queue`, and the
  shared event generator. `backend/routes/sse.py` and `backend/routes/sync.py`
  collapsed to ~10-line endpoints that call `register()` and return
  `StreamingResponse(broadcaster.stream(queue, heartbeat=...))`. Shutdown
  drain logic centralized on the two module-level broadcasters
  (`legacy_broadcaster`, `sync_broadcaster`).
- **Thread-safety** — `broadcast()` captures the bound event loop at startup
  via `bind_loop(asyncio.get_running_loop())` in `lifespan()` and dispatches
  via `loop.call_soon_threadsafe`, so sync DB handler threads can publish
  without touching the asyncio queue directly.
- **Call-site stability** — `broadcast_update` / `broadcast_sync` signatures
  preserved, so the six existing callers in `lists.py`, `items.py`, `sync.py`
  needed no changes.

**Test coverage added:**

- `tests/test_events.py` (6 tests) — register/unregister, capacity rejection
  (429), fan-out delivery, queue-full drop, heartbeat-on-timeout,
  message-as-SSE-frame.

Test suite: **77 passing**, ruff clean.

### Commit 4 — Sync collection spec refactor

- **#11 Switch-on-string collapsed** — new `CollectionSpec` frozen dataclass
  in `backend/routes/sync.py` captures each collection's table name,
  insert/update field order, a `defaults()` factory (so timestamps are
  evaluated per-call, not at spec-construction time), and the legacy
  `broadcast_update` event name. SQL strings are exposed as properties
  (`insert_sql`, `update_sql`, `select_sql`, `pull_sql_checkpoint`,
  `pull_sql_all`) so there is no runtime string-building on the hot path.
- **Helpers collapsed** — `_select_doc`, `_pull_docs`, `_insert_doc`,
  `_update_doc` went from branching per collection to 1–3 lines each.
  Endpoint validation is now `_require_spec(collection)` returning the
  `CollectionSpec` or raising `INVALID_COLLECTION` 400.
- **Broadcast branch removed** — `sync_push` now emits
  `broadcast_update(spec.broadcast_event)` instead of an inline
  `"lists_changed" if collection == "lists" else "items_changed"` ternary.
- **Adding a third collection** is now a dict entry plus a defaults
  factory; no helper edits.

**Test coverage added:**

- `tests/test_sync_collections.py` (8 tests) — parametrized SQL shape
  checks for both collections, `_require_spec` rejection path,
  insert/select/update round-trips on lists and items, limit-respecting
  `_pull_docs`, and an end-to-end `POST /sync/items/push` smoke test
  proving the refactor keeps the public contract.

Test suite: **85 passing**, ruff clean.

### Commit 5 — Middleware merge and single-process note

- **#14 429s are now access-logged** — the former two-middleware chain
  (`access_log_middleware` → `metrics_middleware`) is replaced by a single
  `access_log_and_metrics_middleware` declared **last** in `backend/main.py`.
  FastAPI adds middleware bottom-up, so "last declared = outermost": the
  merged layer now wraps `rate_limit_middleware`, and 429 responses emitted
  by the rate limiter pass through it on their way out instead of being
  short-circuited.
- **#15 Duplicate `time.monotonic()` removed** — one `start` / `duration_ms`
  pair serves both the access log line and the metrics `collector.record(...)`
  call. Saves one coroutine frame per request.
- **#12 / #13 Single-process constraint documented** — module docstring in
  `backend/main.py` explicitly calls out that `rate_limit_store` and
  `backend.metrics.collector` are process-local, so `uvicorn --workers N`
  fragments both. Documents the upgrade path (`slowapi` + Redis for rate
  limiting, `prometheus_client` multiprocess dir for metrics) without
  shipping those dependencies today.

**Test coverage added:**

- `test_rate_limited_requests_are_access_logged` — fills the per-IP sliding
  window, asserts a `backend.main` log record contains the path and status
  `429`. This is the concrete regression guard for #14.
- `test_successful_requests_are_access_logged` — pins the expected format
  on the happy path so the merge doesn't silently drop log output.

Test suite: **87 passing**, ruff clean.

### Commit 6 — Metrics fast-path and percentile cache

- **#17 Regex skipped on hot paths** — `_normalize_path` now checks a tight
  `_FAST_PATHS` frozenset (health, metrics, events, sync/stream) and a cheap
  `"-" not in path and "/static/" not in path` prefilter before invoking
  the UUID / static-file regexes. The two most-scraped endpoints
  (`/api/v1/health`, `/api/v1/metrics`) no longer touch `re.sub` at all, and
  the common non-UUID paths skip it via the prefilter.
- **#16 Percentile snapshot cached for 1 s** — `get_percentiles()` now caches
  the computed dict keyed by `window_seconds` with a monotonic-clock TTL
  (`_PERCENTILE_CACHE_TTL = 1.0`). Frequent Prometheus scrapes return the
  cached dict without re-sorting the 10 k-sample deque. New `record()` calls
  within the TTL are intentionally not invalidating — stale-but-bounded is
  acceptable for a scrape target. The refactor splits out
  `_compute_percentiles_locked()` so the lock is held exactly once per
  recomputation and the cache write happens under the same lock.

**Test coverage added:**

- `tests/test_metrics.py` (7 tests):
  - Parametrized fast-path pass-through for the four static paths.
  - Dash-free paths skip the regex entirely.
  - UUID and `/static/...` normalization still works for dynamic segments.
  - Cache hit within the TTL returns the same snapshot even after a fresh
    `record()`.
  - Monkey-patched `time.monotonic` jump invalidates the cache past the TTL
    and the new sample count shows up.
  - Different `window_seconds` bypasses the single-entry cache.

Test suite: **97 passing**, ruff clean.
