# Backend Review — TODO

Senior-review of the FastAPI backend in `backend/`. Items are grouped by priority and
reference the concrete file/line where applicable.

High-priority items #1–#8 are complete. Medium-priority items #9–#17 are complete.
Low-priority items #18–#26 are complete (Stages F + G + H + I).
See the "Done" section at the bottom.

Remaining: #27 — covered by Stage J.

---

## Low priority (polish / DX) — remaining

### 27. `Request.client.host` trusts the peer socket

Behind a reverse proxy, all clients look like `127.0.0.1`. If deploying behind
nginx/traefik, read `X-Forwarded-For` (use `uvicorn --proxy-headers` + trusted
hosts list).

---

## Suggested next refactor order

1. **`X-Forwarded-For` trust** (#27) — prerequisite for deploying behind a
   reverse proxy without the rate limiter collapsing all traffic onto one IP.
