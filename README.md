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
uv run main.py
```

Open [http://localhost:8000](http://localhost:8000)

## Configuration

All settings can be overridden via `TICKR_*` environment variables. Copy the example file to get started:

```bash
cp .env.example .env
```

See [`.env.example`](.env.example) for the full list with defaults.

| Variable                       | Default         | Description                       |
| ------------------------------ | --------------- | --------------------------------- |
| `TICKR_DATABASE`               | `data/tickr.db` | SQLite database path              |
| `TICKR_RATE_LIMIT_REQUESTS`    | `100`           | Max requests per window per IP    |
| `TICKR_RATE_LIMIT_WINDOW`      | `60`            | Rate limit window in seconds      |
| `TICKR_RATE_LIMIT_MAX_IPS`     | `10000`         | Max tracked IPs in rate limiter   |
| `TICKR_MAX_SSE_CLIENTS`        | `10`            | Max concurrent SSE connections    |
| `TICKR_SSE_HEARTBEAT_INTERVAL` | `15`            | SSE heartbeat interval in seconds |
| `TICKR_BACKUP_DIR`             | `data/backups`  | Backup output directory           |
| `TICKR_BACKUP_RETAIN`          | `7`             | Number of backups to keep         |

See [`docker-compose.yml`](docker-compose.yml) for a ready-to-use Docker Compose setup with commented-out environment overrides.

## API

Interactive docs available at `/docs` (Swagger UI) and `/redoc`.

## Development

```bash
# Install dev dependencies
uv sync --dev

# Lint and format
uv run ruff check --fix .
uv run ruff format .

# Type check
uv run mypy main.py

# Frontend dev server (with API proxy to FastAPI)
cd frontend && npm run dev
```

## License

[GPLv3](LICENSE)

## Credits

[T cell icons created by Freepik - Flaticon](https://www.flaticon.com/free-icons/t-cell)
