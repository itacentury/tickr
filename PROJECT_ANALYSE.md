# Projektanalyse Tickr

Stand: 23.04.2026

## Priorisierte Findings

### 5. Medium: Metrics-Endpunkt offen und vom Rate-Limit ausgenommen

- Fundstellen: `backend/routes/monitoring.py`, `backend/main.py`
- Problem: Informationsabfluss (Pfad-/Statusmuster) fuer Reconnaissance.
- Empfehlung: Token/IP-Allowlist fuer `/metrics`, optional eigenes Rate-Limit.

### 7. Low: History-Hard-Delete bei Listen-Delete

- Fundstelle: `backend/routes/lists.py`
- Problem: Liste/Items werden soft-deleted, History wird hart geloescht.
- Empfehlung: Konsistentes Deletionsmodell (soft-delete oder dokumentierter Hard-Delete).
