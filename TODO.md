# TODO — Tickr

## Critical

- [ ] **Add authentication / authorization** — App is completely open; anyone with network access can read, create, modify, and delete all data. Add at least basic auth (shared password, HTTP Basic Auth, or token-based) before exposing to the internet.
- [x] **Add automated tests** — Zero unit, integration, or end-to-end tests exist. Add pytest-based API tests for all endpoints and critical database operations. Target at least happy path coverage per endpoint.
- [ ] **Externalize configuration via environment variables** — Key values are hardcoded with no env var override: database path (`data/tickr.db`), rate limit settings (100 req/60s), max SSE connections (10), SSE heartbeat interval (15s), server host/port. Use `os.getenv()` with sensible defaults.
- [x] **Add `response.ok` checks to replication fetch calls** — Pull and push handlers in `replication.js` don't validate HTTP status before parsing JSON. Server errors (5xx) are silently ignored, making sync appear to work when it doesn't.
- [x] **Add try-catch to RxDB operations in app.js** — All database operations (`insert`, `patch`, `remove`) lack error handling. Failures (e.g. IndexedDB quota exceeded) crash silently with no user feedback. Affects 8+ call sites.
- [x] **Add error handling to `sync_push` endpoint** — `_insert_doc()` and `_update_doc()` in `main.py` are called without try-except. Database constraint violations (FK, unique) return 500 with stack trace instead of a proper conflict response.
- [x] **Fix EventSource connection leak in replication.js** — SSE connections are created per collection but never closed on app shutdown or tab close. Multiple tabs can exhaust the browser's connection limit and the server's max SSE connections (10).
- [x] **Add `_deleted` field to RxDB schemas** — `schemas.js` doesn't declare `_deleted` in list/item schemas. RxDB may strip undeclared fields during replication, breaking soft-delete sync between client and server.

## Moderate

- [ ] **Set up reverse proxy with TLS** — App serves plain HTTP. Document that a reverse proxy (nginx, Caddy, Traefik) with TLS is required. Consider adding HSTS header when behind TLS.
- [ ] **Automate database backups** — `backend/backup.py` exists but must be invoked manually via `docker exec`. Add a cron job or scheduled task (e.g. cron entry in Dockerfile or a sidecar container) to run backups automatically.
- [ ] **Bound the in-memory rate limit store** — `rate_limit_store` in `main.py` is a plain `defaultdict(list)` with no max size. Stale IPs are pruned per-request, but many unique IPs without repeat visits cause unbounded growth. Add a max entry count or periodic full cleanup.
- [ ] **Add CORS configuration** — No explicit CORS middleware. Works when frontend is served from the same origin, but would break if the API were consumed from a different domain. Add configurable CORS origins for flexibility.
- [ ] **Verify service worker cache invalidation** — `public/sw.js` should ensure stale frontends are updated after deployments. Verify the cache-busting strategy (e.g. versioned cache names or content hashes).
- [x] **Replace f-string SQL with explicit table queries** — Sync endpoints in `main.py` use `f"SELECT * FROM {collection}"`. The collection parameter is whitelisted, so this is currently safe, but fragile if refactored. Use explicit per-table queries instead.
- [x] **Make `package-lock.json` required in Dockerfile** — `COPY frontend/package-lock.json*` uses a glob, making the file optional. Remove the asterisk to ensure deterministic `npm ci` builds.
- [x] **Add request logging middleware** — No general request/response logging (method, path, status code, duration). Add access log middleware or use Uvicorn's built-in access logging.
- [x] **Implement graceful shutdown** — No explicit SIGTERM/SIGINT handling to drain SSE connections or finish in-flight requests. Add a shutdown event handler for SSE connections and the database.
- [x] **Set up database backup strategy** — SQLite database has no backup mechanism. Document or automate backups (e.g. periodic `cp` or `sqlite3 .backup` via cron). Consider WAL mode.
- [x] **Add API versioning** — All endpoints under `/api/` with no version prefix. Low priority for personal use, but consider `/api/v1/` if API will be consumed externally.

## Minor

- [ ] **Write deployment documentation** — No guide for deploying behind a reverse proxy, setting up TLS, or configuring backups.
- [ ] **Add E2E tests** — Once API tests are in place, add Playwright or Cypress E2E tests covering the critical user flows: creating lists/items, offline sync, and undo.
- [x] **Add structured error responses** — Errors are plain `{"detail": "..."}` strings. Add error codes or a machine-readable format.
- [x] **Add frontend error reporting** — Frontend errors only go to `console.error()`. Consider reporting back to the server for monitoring.
- [x] **Add metrics / monitoring** — No health metrics, request counters, or performance tracking beyond the basic health check endpoint.
