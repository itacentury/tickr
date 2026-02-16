# Tickr

A minimal, fast todo list app with real-time sync across devices.

## Features

- **Multiple lists** with custom emoji icons
- **Real-time sync** across devices via Server-Sent Events (SSE)
- **Offline support** with automatic caching and background sync
- **Undo actions** with history tracking
- **PWA installable** on mobile and desktop
- **Drag-and-drop** list reordering
- **Sorting options** for items and lists (alphabetical, date, custom)

## Stack

- **Backend:** FastAPI, Uvicorn, SQLite
- **Frontend:** Vanilla JavaScript, HTML5, CSS3
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

Requires Python 3.13+.

```bash
pip install .
python main.py
```

Open [http://localhost:8000](http://localhost:8000)

## API

Interactive docs available at `/docs` (Swagger UI) and `/redoc`.

## Development

```bash
# Install dev tools
pip install ruff mypy

# Lint and format
ruff check --fix .
ruff format .

# Type check
mypy main.py
```

## License

[GPLv3](LICENSE)

## Credits

[T cell icons created by Freepik - Flaticon](https://www.flaticon.com/free-icons/t-cell)
