# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Tickr is an offline-first todo PWA. It is a two-stack monorepo:

- **Backend:** FastAPI + Uvicorn + SQLite, single process (`backend/`).
- **Frontend:** **vanilla JavaScript** (no framework), RxDB (IndexedDB) + Vite (`frontend/`).
- Real-time sync across devices via Server-Sent Events (SSE).

## Code Style

See @docs/code-style.md for code style and convention rules (applies on every machine).

## Commands

### Backend (Python, run from repo root)

| Task                 | Command                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| Install (prod / dev) | `uv sync` / `uv sync --dev`                                                         |
| Lint                 | `uv run ruff check .` (autofix: `uv run ruff check --fix .`)                        |
| Format               | `uv run ruff format .`                                                              |
| Type check           | `uv run mypy .`                                                                     |
| Run                  | `uv run uvicorn backend.main:app --port 8000` (dev: add `--reload --env-file .env`) |
| Test (all)           | `uv run pytest`                                                                     |
| Test (single)        | `uv run pytest tests/test_<name>.py::<test_fn> -v`                                  |

### Frontend (run from `frontend/`)

| Task          | Command                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| Install       | `npm install`                                                              |
| Build         | `npm run build` (Vite → `static/dist`)                                     |
| Dev server    | `npm run dev` (HMR on :5173, proxies `/api` → :8000; backend must run too) |
| Lint          | `npm run lint` (eslint)                                                    |
| Format        | `npm run format` (prettier)                                                |
| Type check    | `npm run typecheck` (tsc, JSDoc-based)                                     |
| Test (all)    | `npm run test` (vitest run)                                                |
| Test (single) | `npm run test -- <path-or-pattern>`                                        |

Serving the built SPA at http://localhost:8000 requires running `npm run build` first.

## Architecture

### Layout

- `backend/` — FastAPI app + SQLite persistence
- `frontend/src/` — vanilla JS PWA
- `tests/` — Python backend tests
- `static/dist` — frontend build output
- `data/` — SQLite database + backups

### Barrel-file + wire-function convention (key, non-obvious)

- `data.js`, `events.js`, and `metrics.js` are **barrel files** that re-export from the `data/`, `events/`, and `metrics/` submodule directories. Consumers import from the barrel; the internal split stays transparent, so the public API is stable while implementation moves.
- Each feature exposes a `wireX()` function (e.g. `wireMetrics`, `wireSettings`, `wireHistory`) that attaches its DOM listeners. `setupEventListeners()` in `events.js` is the single orchestration point that calls every `wireX()`; it runs once from `app.js` `initApp()`.
- **To add a feature:** write a submodule with a `wireX()` function, then add one line to `setupEventListeners()`.

### Layered module boundaries

- `state.js` — shared mutable state; leaf module (no app imports).
- `bus.js` — RxJS Subjects (`navigationChanged$`, `itemsChanged$`, `categoriesChanged$`, `authExpired$`) that decouple the data layer from the view layer.
- **Data layer** (`data/`, `db/`) writes to state/RxDB and emits on the bus — it never imports `render.js`.
- **View layer** (`render.js`) subscribes to the bus and re-renders; it calls data functions only from user-event handlers.
- **Event layer** (`events/`) wires DOM listeners and orchestrates data + render calls.

### Data flow (offline-first)

```
user event → wireX handler → RxDB CRUD (local, immediate)
  → db/replication.js pushes to backend
  → backend/routes/sync.py persists + broadcasts SSE
  → clients receive SSE, pull
  → data/subscriptions.js RxDB subscription fires
  → updates state + emits on bus
  → render.js re-renders
```

Writes and renders happen locally first; replication is background and best-effort. The server is the source of truth (last-write-wins). Deletions are soft with undo windows (`state.pendingDeletes`). Settings and history are HTTP-only (not replicated).

### Entry points

- Frontend: `main.js` (auth gate, service worker) → `app.js` (`initApp`).
- Backend: `backend/main.py` (app, middlewares, lifespan).

## Conventions & gotchas

- **Config:** the backend reads `TICKR_*` from the process environment and deliberately does **not** call `load_dotenv`. For a local `.env`, run uvicorn with `--env-file .env` (requires dev deps / `python-dotenv`). See `tickr.env.example`.
- **Ruff:** line-length 100; rule sets F/E/W/I/N/UP/B/SIM/T20/RUF (T20 forbids stray `print`).
- **Strict CSP** (`default-src 'self'`): no inline styles/scripts; escape user input via `escapeHtml()` before any innerHTML insertion.
- VS Code: open `tickr.code-workspace` for ready-made tasks and debug configs.
