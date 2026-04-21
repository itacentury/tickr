# Backend Review — TODO

Senior-review of the FastAPI backend in `backend/`. Items are grouped by priority and
reference the concrete file/line where applicable.

High-priority items #1–#8 are complete. Medium-priority items #9–#17 are complete.
Low-priority items #18–#24 and #26 are complete (Stages F + G + H).
See the "Done" section at the bottom.

Remaining: #25, #27 — covered by Stages I / J.

---

## Low priority (polish / DX) — remaining

### 25. `broadcast_update` called synchronously after `db.commit()`

If broadcast ever does network I/O (it will after #9), you'd be holding up the
response. Broadcast _after_ returning via `BackgroundTasks`.

### 27. `Request.client.host` trusts the peer socket

Behind a reverse proxy, all clients look like `127.0.0.1`. If deploying behind
nginx/traefik, read `X-Forwarded-For` (use `uvicorn --proxy-headers` + trusted
hosts list).

---

## Suggested next refactor order

1. **BackgroundTasks for broadcasts** (#25) — removes broadcast cost from the
   response critical path.
2. **`X-Forwarded-For` trust** (#27) — prerequisite for deploying behind a
   reverse proxy without the rate limiter collapsing all traffic onto one IP.
