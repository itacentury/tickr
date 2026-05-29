# Projektanalyse Tickr

Stand: 23.04.2026

## Priorisierte Findings

### 7. Low: History-Hard-Delete bei Listen-Delete

- Fundstelle: `backend/routes/lists.py`
- Problem: Liste/Items werden soft-deleted, History wird hart geloescht.
- Empfehlung: Konsistentes Deletionsmodell (soft-delete oder dokumentierter Hard-Delete).
