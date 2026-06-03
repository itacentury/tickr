## Plan: Passwortschutz für Tickr

Ziel ist eine robuste, aber schlanke Single-Password-Authentifizierung mit optionalem 30-Tage-Login. Umsetzung über gehashte Server-Passwortprüfung + signierte, HttpOnly Session-Cookies (statt Token in LocalStorage). Dadurch bleibt die Frontend-Änderung minimal, XSS-Risiko sinkt, und Dev (ohne TLS) sowie Prod (mit HTTPS/Nginx) sind sauber abbildbar.

**Wichtig — Architektur-Randbedingungen (gegen den echten Code geprüft):**
- Tickr ist eine **Offline-first-PWA**: Die HTML-Shell wird unter `GET /` und das JS-Bundle unter `/assets/*` ausgeliefert (`backend/routes/static.py`), der Service Worker (`frontend/public/sw.js`) cached `"/"` network-first. **Die App-Shell darf daher NICHT hinter Auth liegen** — sonst gibt es keine UI, die einen Login anzeigen könnte, und der SW cached eine 401. Geschützt werden nur die **Daten-/API-Routen**; der Login ist ein **clientseitiges Gate**.
- 401 muss **direkt als `JSONResponse`** aus der Middleware kommen — Starlette leitet Exceptions aus `@app.middleware` nicht an die Handler in `errors.py` weiter (analog zur bestehenden `rate_limit_middleware`, `backend/main.py`).
- `AUTH_ENABLED` muss **Default `false`** sein, sonst bricht die gesamte bestehende Testsuite (kein Test authentifiziert sich).

**Steps**
1. **Phase 1 - Sicherheits- und Konfigurationsfundament**
2. Dependencies ergänzen: `uv add argon2-cffi itsdangerous` (Hashing + Cookie-Signing; `itsdangerous` ggf. bereits über Starlette vorhanden — prüfen).
3. In `backend/config.py` neue Auth-Settings ergänzen: `AUTH_ENABLED` (Default **`false`**), Passwort-Quelle aus ENV (`TICKR_PASSWORD_HASH` bevorzugt, optional `TICKR_PASSWORD` für Dev mit Start-up-Hashing-Hinweis), `SESSION_SECRET`, `SESSION_DAYS_DEFAULT=30`, `COOKIE_SECURE` env-gesteuert für dev/prod.
4. In `backend/errors.py` Auth-Fehlercode `UNAUTHORIZED` zum `ErrorCode`-Enum ergänzen; bestehendes `_error_body`-Format wiederverwenden.
5. In `backend/auth.py` (neu) Session-Cookie Sign/Verify (itsdangerous), Passwort-Verify (argon2) und Helfer `is_authenticated(request) -> bool` kapseln. Middleware in `main.py` delegiert nur dünn hierher.
6. In `backend/main.py` Auth-Middleware einfügen (nur aktiv wenn `AUTH_ENABLED`), die **API-Datenrouten** schützt und bei fehlender/ungültiger Session **`JSONResponse(status_code=401, …)` mit `_error_body(UNAUTHORIZED, …)`** zurückgibt. Reihenfolge: **nach** Rate-Limit (Login-Bruteforce wird limitiert), **vor** den Route-Handlern. *blockt Phase 2 und 3*
7. Öffentliche Exemptions (ohne Session erreichbar): `/`, `/assets/*`, `/static/*`, `/icons/*`, `/manifest.json`, `/sw.js`, `/api/v1/health`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`. Bewusst entscheiden, ob `/api/v1/metrics` geschützt wird (aktuell offen).
8. **Phase 2 - Auth-Endpunkte und Session-Lebenszyklus**
9. Neue Route `backend/routes/auth.py` mit Endpunkten: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`; Router in `backend/routes/__init__.py` (`all_routers`) registrieren.
10. Login-Flow: Passwort gegen `TICKR_PASSWORD_HASH` (argon2) prüfen, bei Erfolg signierte Session erzeugen und HttpOnly-Cookie setzen; bei "remember me" `Max-Age=30 Tage`, sonst Session-Cookie ohne persistente Laufzeit.
11. Logout-Flow: Cookie invalidieren (leeres Cookie mit `Max-Age=0`). Hinweis: stateless signierte Cookies sind serverseitig nicht widerrufbar — bewusste Designentscheidung (Single-User).
12. `GET /api/v1/auth/me`: liefert Authentifizierungsstatus (z. B. `200 {authed: true}` bzw. `401`) für das Frontend-Gate.
13. **Phase 3 - Frontend Login-Gate und API-Integration**
14. Login als **clientseitiges Gate**: In `frontend/src/app.js`/`main.js` vor `initApp()` einen Auth-Check (`GET /api/v1/auth/me`) einbauen; bei „nicht eingeloggt" Login-View rendern statt App zu initialisieren. **Replication erst nach erfolgreichem Login starten** (`setupReplication` nicht vorher aufrufen).
15. Login-UI im JS-Bundle (neues `frontend/src/auth.js` + Darstellung über `frontend/src/render.js`/`dom.js`) — **kein inline `<script>`**, da die CSP in `backend/main.py` `unsafe-inline` für Scripts verbietet. Felder: Passwort + Checkbox "30 Tage angemeldet bleiben".
16. Login-Submit: `POST /api/v1/auth/login`; Cookie-Handling browser-seitig. Hinweis: `credentials: "include"` ist same-origin **nicht** nötig (Fetch sendet Cookies bei same-origin per Default) — nur relevant, falls über `TICKR_CORS_ORIGINS` cross-origin betrieben wird (dann zusätzlich `SameSite=None; Secure`).
17. 401 während Laufzeit: Da `EventSource` (`frontend/src/db/replication.js`) keinen Statuscode exponiert, den Logout-/Ablauf-Zustand über die RxDB-Replication-`error$`-Observables bzw. die `!response.ok`-Pfade in den Pull/Push-Handlern erkennen. Dann `cleanupSSE()` aufrufen, Reconnect-Loop pausieren und App in Login-Zustand zurücksetzen; nach erneutem Login neu initialisieren.
18. **Phase 4 - Docker/Deployment und Betriebsmodus**
19. In `docker-compose.yml` ENV definieren (`AUTH_ENABLED=true`, `TICKR_PASSWORD_HASH`/`SESSION_SECRET` via `.env`/Secrets statt Klartext im Commit); dev/prod Cookie-Secure-Strategie dokumentieren.
20. Nginx/Proxy: `X-Forwarded-Proto` korrekt setzen (siehe bestehende `--proxy-headers`-Doku im Modul-Docstring von `backend/main.py`), damit Secure-Cookies in Prod stabil sind; lokal ohne TLS `COOKIE_SECURE=false`.
21. README-Abschnitt: Passwort-Hash erzeugen, ENV setzen, remember-me Verhalten, bekannte Grenzen (Single-User, keine serverseitige Session-Invalidierung).
22. **Phase 5 - Tests und Abnahme**
23. `tests/conftest.py`: Suite mit `AUTH_ENABLED=false` betreiben (Default), zusätzlich `authed_client`-Fixture für Auth-Tests (setzt `AUTH_ENABLED=true` + gültiges Session-Cookie).
24. Neue Tests `tests/test_auth.py`: Login erfolgreich/fehlerhaft, remember-me Cookie-Ablaufattribute, Logout, `/auth/me`.
25. Neue Middleware-Tests `tests/test_auth_middleware.py`: geschützte Routen → 401 ohne Session; Exemptions (`/`, `/assets/*`, `/api/v1/health`, `manifest.json`, `sw.js`, Login) bleiben erreichbar.
26. Sync/SSE-Tests in `tests/test_sync_collections.py` (plus ggf. neues `tests/test_sse.py`): ohne Session 401 vor Stream/Sync, mit Session normal.
27. Gesamtsuite + Qualitätschecks: `uv run pytest tests/ -v`, `uv run ruff check .`, `uv run mypy backend`.

**Relevant files** (Repo-Wurzel: `C:\Users\Juli\Repos\tickr`)
- `backend/config.py` - neue Auth-/Cookie-/Session-Settings aus ENV (`AUTH_ENABLED` Default false).
- `backend/auth.py` *(neu)* - Cookie Sign/Verify, Passwort-Verify, `is_authenticated`-Helfer.
- `backend/main.py` - Auth-Middleware (gibt 401 als `JSONResponse` zurück), Exemptions, Reihenfolge.
- `backend/errors.py` - `UNAUTHORIZED` im `ErrorCode`-Enum.
- `backend/routes/auth.py` *(neu)* - Login/Logout/Me-Endpunkte.
- `backend/routes/__init__.py` - Auth-Router in `all_routers` registrieren.
- `frontend/src/app.js` / `frontend/src/main.js` - Auth-Gate vor App-Init; Replication erst nach Login.
- `frontend/src/auth.js` *(neu)* - Login-Submit + Login-State.
- `frontend/src/render.js` / `frontend/src/dom.js` - Login-View darstellen.
- `frontend/src/db/replication.js` - 401-/Ablauf-Handling über error$ / `!response.ok`, SSE-Cleanup.
- `docker-compose.yml` - ENV für Passwort-Hash/Secret/Auth-Enable.
- `README.md` - Betriebs- und Sicherheitsdokumentation.
- `tests/conftest.py` - `AUTH_ENABLED=false` für Suite + `authed_client`-Fixture.
- `tests/test_auth.py` *(neu)* - Auth-Endpunkt-Tests.
- `tests/test_auth_middleware.py` *(neu)* - Exemptions/401-Verhalten.
- `tests/test_sync_collections.py` - Sync-Endpunkte unter Auth absichern.

> Hinweis: Die im ursprünglichen Plan genannten `frontend/index.html`, `tests/test_middleware.py` und `tests/test_sync.py` existieren in diesem Repo nicht — Pfade oben korrigiert.

**Verification**
1. Ohne Session: `GET /` liefert HTML (200) und die App-Shell lädt; `GET /api/v1/lists` liefert 401.
2. Login-View erscheint im Browser; nach erfolgreichem Login startet Replication und Daten laden.
3. Login ohne remember-me: Browser schließen/öffnen → erneute Anmeldung erforderlich. Mit remember-me: Cookie `Max-Age` ~30 Tage, bleibt über Neustart bestehen.
4. Sync und SSE: ohne Session 401, **kein 3s-Reconnect-Sturm**; mit Session funktionieren Pull/Push/Stream normal.
5. Security-Check: Cookie ist `HttpOnly`; in Prod zusätzlich `Secure` + passendes `SameSite`.
6. `uv run pytest tests/ -v` grün (Default `AUTH_ENABLED=false`; Auth-Tests setzen es gezielt auf `true`), `uv run ruff check .` und `uv run mypy backend` grün.

**Decisions**
- Gewählt: solide Basis mit Hash + signierten Session-Cookies (kein Klartextpasswort im Frontend, kein LocalStorage-Token als primärer Auth-Mechanismus).
- Gewählt: nur **Daten-/API-Routen** geschützt; App-Shell (`/`, `/assets/*`, `/static/*`, `/icons/*`), `manifest.json`, `sw.js`, `health` öffentlich; Login als clientseitiges Gate.
- Gewählt: remember-me als optionale Checkbox (30 Tage), sonst Session bis Browserende.
- Gewählt: Dev ohne TLS und Prod mit HTTPS/Nginx über konfigurierbares `COOKIE_SECURE`.
- Nicht im Scope: Multi-User/Rollenmodell, OAuth/OIDC, feingranulare RBAC, serverseitige Session-Invalidierung.

**Further Considerations**
1. Passwort-Quelle: Empfehlung Option A `TICKR_PASSWORD_HASH` (bevorzugt), Option B Klartext `TICKR_PASSWORD` nur für lokale Entwicklung.
2. Session-Design: Empfehlung Option A stateless signiertes Cookie (einfach, aber nicht widerrufbar), Option B serverseitige Session-Tabelle für explizite Invalidierung aller Sessions.
3. Bruteforce-Schutz: Login-Endpoint bewusst **nicht** vom bestehenden Rate-Limit ausnehmen (Auth-Middleware läuft nach dem Rate-Limit) oder eigenes engeres Login-Limit ergänzen.
4. `/api/v1/metrics`: aktuell öffentlich — entscheiden, ob es mit unter den Schutz fällt.
