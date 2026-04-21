# Backend Review — TODO

Senior-review of the FastAPI backend in `backend/`. Items are grouped by priority and
reference the concrete file/line where applicable.

High-priority items #1–#8 are complete. Medium-priority items #9–#17 are complete.
See the "Done" section at the bottom.

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
