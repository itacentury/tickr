# Backend Review — TODO

Senior-review of the FastAPI backend in `backend/`. Items are grouped by priority and
reference the concrete file/line where applicable.

High-priority items #1–#8 are complete. Medium-priority items #9–#17 are complete.
Low-priority items #18–#22 and #26 are complete (Stages F + G).
See the "Done" section at the bottom.

Remaining: #23, #24, #25, #27 — covered by Stages H / I / J.

---

## Low priority (polish / DX) — remaining

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

### 27. `Request.client.host` trusts the peer socket

Behind a reverse proxy, all clients look like `127.0.0.1`. If deploying behind
nginx/traefik, read `X-Forwarded-For` (use `uvicorn --proxy-headers` + trusted
hosts list).

---

## Suggested next refactor order

1. **Test-fixture consolidation** (#23 + #24) — share the schema with
   `init_db` and benchmark function-scope.
2. **BackgroundTasks for broadcasts** (#25) — removes broadcast cost from the
   response critical path.
3. **`X-Forwarded-For` trust** (#27) — prerequisite for deploying behind a
   reverse proxy without the rate limiter collapsing all traffic onto one IP.
