# TODO — Tickr

## Critical

- [ ] **Add authentication / authorization** — App is completely open; anyone with network access can read, create, modify, and delete all data. Add at least basic auth (shared password, HTTP Basic Auth, or token-based) before exposing to the internet.
- [ ] **Add automated tests** — Zero unit, integration, or end-to-end tests exist. Add pytest-based API tests for all endpoints and critical database operations. Target at least happy path coverage per endpoint.
- [ ] **Externalize configuration via environment variables** — Key values are hardcoded with no env var override: database path (`data/tickr.db`), rate limit settings (100 req/60s), max SSE connections (10), SSE heartbeat interval (15s), server host/port. Use `os.getenv()` with sensible defaults.
- [x] **Add `response.ok` checks to replication fetch calls** — Pull and push handlers in `replication.js` don't validate HTTP status before parsing JSON. Server errors (5xx) are silently ignored, making sync appear to work when it doesn't.
- [ ] **Add try-catch to RxDB operations in app.js** — All database operations (`insert`, `patch`, `remove`) lack error handling. Failures (e.g. IndexedDB quota exceeded) crash silently with no user feedback. Affects 8+ call sites.
- [ ] **Add error handling to `sync_push` endpoint** — `_insert_doc()` and `_update_doc()` in `main.py` are called without try-except. Database constraint violations (FK, unique) return 500 with stack trace instead of a proper conflict response.
- [ ] **Fix EventSource connection leak in replication.js** — SSE connections are created per collection but never closed on app shutdown or tab close. Multiple tabs can exhaust the browser's connection limit and the server's max SSE connections (10).
- [ ] **Add `_deleted` field to RxDB schemas** — `schemas.js` doesn't declare `_deleted` in list/item schemas. RxDB may strip undeclared fields during replication, breaking soft-delete sync between client and server.

## Moderate

- [ ] **Replace f-string SQL with explicit table queries** — Sync endpoints in `main.py` use `f"SELECT * FROM {collection}"`. The collection parameter is whitelisted, so this is currently safe, but fragile if refactored. Use explicit per-table queries instead.
- [ ] **Make `package-lock.json` required in Dockerfile** — `COPY frontend/package-lock.json*` uses a glob, making the file optional. Remove the asterisk to ensure deterministic `npm ci` builds.
- [ ] **Document SQLite scalability limitation** — SQLite is single-writer and file-based. Works for single-instance but not for horizontal scaling. Document this; consider PostgreSQL if scaling is needed.
- [ ] **Set up reverse proxy with TLS** — App serves plain HTTP. Document that a reverse proxy (nginx, Caddy, Traefik) with TLS is required. Consider adding HSTS header when behind TLS.
- [ ] **Add request logging middleware** — No general request/response logging (method, path, status code, duration). Add access log middleware or use Uvicorn's built-in access logging.
- [ ] **Implement graceful shutdown** — No explicit SIGTERM/SIGINT handling to drain SSE connections or finish in-flight requests. Add a shutdown event handler for SSE connections and the database.
- [ ] **Set up database backup strategy** — SQLite database has no backup mechanism. Document or automate backups (e.g. periodic `cp` or `sqlite3 .backup` via cron). Consider WAL mode.
- [ ] **Add API versioning** — All endpoints under `/api/` with no version prefix. Low priority for personal use, but consider `/api/v1/` if API will be consumed externally.

## Minor

- [ ] **Add structured error responses** — Errors are plain `{"detail": "..."}` strings. Add error codes or a machine-readable format.
- [ ] **Add frontend error reporting** — Frontend errors only go to `console.error()`. Consider reporting back to the server for monitoring.
- [ ] **Add metrics / monitoring** — No health metrics, request counters, or performance tracking beyond the basic health check endpoint.
- [ ] **Write deployment documentation** — No guide for deploying behind a reverse proxy, setting up TLS, or configuring backups.
