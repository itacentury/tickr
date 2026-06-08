# Tickr

[![CI](https://github.com/itacentury/tickr/actions/workflows/ci.yml/badge.svg)](https://github.com/itacentury/tickr/actions/workflows/ci.yml)
[![Docker](https://github.com/itacentury/tickr/actions/workflows/docker.yml/badge.svg)](https://github.com/itacentury/tickr/actions/workflows/docker.yml)

A minimal, fast todo list app with real-time sync across devices.

## Features

- **Multiple lists** with custom emoji icons
- **Real-time sync** across devices via Server-Sent Events (SSE)
- **Offline-first** with RxDB (IndexedDB) and bidirectional sync
- **Undo actions** with history tracking
- **PWA installable** on mobile and desktop
- **Drag-and-drop** list reordering
- **Sorting options** for items and lists (alphabetical, date, custom)

## Stack

- **Backend:** FastAPI, Uvicorn, SQLite
- **Frontend:** Vanilla JavaScript, RxDB, Vite
- **Infrastructure:** Docker (multi-arch: amd64, arm64, armv7)

## Quick Start

### Docker (recommended)

Use the `docker-compose.yml` from this repository:

```bash
docker compose pull
docker compose up -d
```

Open [http://localhost:8000](http://localhost:8000)

The SQLite database is persisted in `./data/`.

### Local

Requires Python 3.13+ and Node.js 22+.

```bash
# Backend
uv sync

# Frontend
cd frontend && npm install && npm run build && cd ..

# Run
uv run uvicorn backend.main:app --port 8000
```

Open [http://localhost:8000](http://localhost:8000)

## Configuration

All settings can be overridden via `TICKR_*` environment variables. Copy the example file to get started:

```bash
cp .env.example .env
```

> **Note:** The app itself does not call `load_dotenv` — it reads `TICKR_*` from
> the process environment. With the dev dependencies installed (`uv sync --dev`,
> which brings in `python-dotenv`), the simplest option is to let uvicorn load
> the file via `--env-file`:
>
> ```bash
> uv run uvicorn backend.main:app --reload --port 8000 --env-file .env
> ```
>
> Without the dev dependencies (`--env-file` unavailable), pass the variables
> directly or load the file into your shell before starting the server:
>
> **PowerShell**
>
> ```powershell
> Get-Content .env | ForEach-Object {
>   if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
>     Set-Item "env:$($matches[1].Trim())" $matches[2].Trim()
>   }
> }
> uv run uvicorn backend.main:app --reload --port 8000
> ```
>
> **Bash**
>
> ```bash
> set -a; source .env; set +a
> uv run uvicorn backend.main:app --reload --port 8000
> ```
>
> Both loaders skip comment and blank lines. In Docker the variables come from
> the container environment / `env_file` instead (see
> [`docker-compose.yml`](docker-compose.yml)).

See [`.env.example`](.env.example) for the full list with defaults.

| Variable                       | Default                 | Description                                                     |
| ------------------------------ | ----------------------- | --------------------------------------------------------------- |
| `TICKR_DATABASE`               | `data/tickr.db`         | SQLite database path                                            |
| `TICKR_LOG_LEVEL`              | `INFO`                  | Logging level (`DEBUG`, `INFO`, …)                              |
| `TICKR_RATE_LIMIT_REQUESTS`    | `100`                   | Max requests per window per IP                                  |
| `TICKR_RATE_LIMIT_WINDOW`      | `60`                    | Rate limit window in seconds                                    |
| `TICKR_RATE_LIMIT_MAX_IPS`     | `10000`                 | Max tracked IPs in rate limiter                                 |
| `TICKR_MAX_SSE_CLIENTS`        | `10`                    | Max concurrent SSE connections                                  |
| `TICKR_SSE_HEARTBEAT_INTERVAL` | `15`                    | SSE heartbeat interval in seconds                               |
| `TICKR_BACKUP_DIR`             | `data/backups`          | Backup output directory                                         |
| `TICKR_BACKUP_RETAIN`          | `7`                     | Number of backups to keep                                       |
| `TICKR_CORS_ORIGINS`           | `http://localhost:8000` | Comma-separated allowed origins (also drives CSP `connect-src`) |
| `TICKR_TRUSTED_PROXIES`        | `127.0.0.1`             | Trusted proxy IPs for `X-Forwarded-For` (Docker/uvicorn)        |
| `TICKR_AUTH_ENABLED`           | `false`                 | Enable the single-password login                                |
| `TICKR_PASSWORD_HASH`          | _(empty)_               | argon2 hash of the password                                     |
| `TICKR_PASSWORD`               | _(empty)_               | Dev-only plaintext password                                     |
| `TICKR_SESSION_SECRET`         | _(empty)_               | Secret for signing session cookies                              |
| `TICKR_SESSION_DAYS`           | `30`                    | "Stay signed in" duration (days)                                |
| `TICKR_COOKIE_SECURE`          | `true`                  | `Secure` flag on the cookie                                     |
| `TICKR_COOKIE_SAMESITE`        | `lax`                   | `SameSite` flag on the cookie                                   |

See [`docker-compose.yml`](docker-compose.yml) for a ready-to-use Docker Compose setup with commented-out environment overrides.

### Authentication

Tickr ships with an optional single-password login (disabled by default). The
app shell, PWA assets and `/api/v1/health` stay public so the login screen can
load offline-first; all data and sync routes require a session.

Enable it by setting `TICKR_AUTH_ENABLED=true` and providing a password and a
session secret:

```bash
# Generate a session secret
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Generate an argon2 password hash (preferred over plaintext)
uv run python -c "from argon2 import PasswordHasher; print(PasswordHasher().hash('your-password'))"
```

Then set `TICKR_PASSWORD_HASH` and `TICKR_SESSION_SECRET` (keep both out of
version control — use `.env` or Docker secrets). For quick local testing you may
instead set `TICKR_PASSWORD` in plaintext; this logs a startup warning.

> **Docker Compose & the `$` in argon2 hashes:** an argon2 hash
> (`$argon2id$v=19$m=...`) contains `$` characters that Docker Compose treats as
> variable references, so it mangles the hash and logs
> `WARN The "argon2id" variable is not set`. Disable interpolation for the env
> file using the long `env_file` syntax with `format: raw`:
>
> ```yaml
> env_file:
>   - path: tickr.env
>     format: raw
> ```
>
> The hash then stays untouched with single `$`. (Alternatively, double every
> `$` to `$$` in the env file.) Verify with
> `docker exec tickr printenv TICKR_PASSWORD_HASH`.

- **Stay signed in:** the login form has a checkbox. Checked → the cookie lives
  ~30 days (`TICKR_SESSION_DAYS`); unchecked → it expires when the browser closes.
- **HTTPS:** keep `TICKR_COOKIE_SECURE=true` behind TLS. For local plain-HTTP
  testing set it to `false`. Behind a reverse proxy, forward `X-Forwarded-Proto`
  and run uvicorn with `--proxy-headers` so `Secure` cookies work reliably.
- **Known limits:** single user only; sessions are stateless signed cookies and
  cannot be revoked server-side — logout just clears the browser cookie.

## API

Interactive API docs are available at `/api/docs` (Swagger UI) and `/api/redoc`
(ReDoc); the OpenAPI schema is at `/api/openapi.json`. With `TICKR_AUTH_ENABLED`,
these require a valid session like any other protected route.

## Development

```bash
# Install dev dependencies
uv sync --dev

# Lint and format
uv run ruff check --fix .
uv run ruff format .

# Type check
uv run mypy .

# Run tests
uv run pytest

# Frontend dev server (with API proxy to FastAPI)
cd frontend && npm run dev
```

### Editor setup (VS Code)

Open `tickr.code-workspace` for ready-to-run tasks and debug configs. They start
uvicorn with `--env-file .env.example`, so the app comes up with auth enabled and the
dev credentials (`test1234`):

- **Dev: Full Stack** — backend + Vite dev server together
- **Run: Start Server** — backend only
- **Dev: Frontend** / **Build: Frontend** / **Lint: All** / **Test: Run All** / **Format: All**

Dev server URLs:

- **http://localhost:5173** — Vite dev server (HMR); proxies `/api` to the backend, so the
  backend must run too. Use this while developing the frontend.
- **http://localhost:8000** — FastAPI serving the built SPA from `static/dist` (after
  **Build: Frontend**).

## License

[GPLv3](LICENSE)

## Credits

[T cell icons created by Freepik - Flaticon](https://www.flaticon.com/free-icons/t-cell)
