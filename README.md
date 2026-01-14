# Tickr

Eine moderne, PWA-fähige Todo-Listen Anwendung mit FastAPI Backend und Vanilla JavaScript Frontend.

## Features

- ✅ Mehrere Listen mit verschiedenen Icons
- ✅ Ein-/ausklappbare Sidebar-Navigation
- ✅ Mobile-optimiertes Design
- ✅ PWA-Ready (installierbar auf Smartphone/Desktop)
- ✅ Verlaufsansicht für jede Liste
- ✅ SQLite Datenbank
- ✅ Docker-Support

## Installation

### Option 1: Docker (empfohlen)

```bash
# Image bauen
docker build -t tickr .

# Container starten
docker run -d -p 8000:8000 -v tickr-data:/app/data --name tickr tickr
```

### Option 2: Lokal

```bash
# Python-Abhängigkeiten installieren
pip install -r requirements.txt

# Server starten
python main.py
```

Oder mit uvicorn direkt:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Im Browser öffnen

Navigiere zu `http://localhost:8000`

## API Dokumentation

FastAPI generiert automatisch eine interaktive API-Dokumentation:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Projektstruktur

```plaintext
tickr/
├── main.py              # FastAPI Backend
├── requirements.txt     # Python-Abhängigkeiten
├── Dockerfile           # Docker Container Definition
├── .dockerignore        # Docker Build Ausschlüsse
├── data/
│   └── tickr.db         # SQLite Datenbank (wird automatisch erstellt)
├── templates/
│   └── index.html       # HTML Template
└── static/
    ├── css/
    │   └── style.css    # Styles
    ├── js/
    │   └── app.js       # Frontend JavaScript
    ├── icons/
    │   ├── icon.svg
    │   ├── icon-192.png
    │   └── icon-512.png
    ├── manifest.json    # PWA Manifest
    └── sw.js            # Service Worker
```

## API Endpunkte

### Listen

| Methode | Endpunkt          | Beschreibung         |
| ------- | ----------------- | -------------------- |
| GET     | `/api/lists`      | Alle Listen abrufen  |
| POST    | `/api/lists`      | Neue Liste erstellen |
| PUT     | `/api/lists/{id}` | Liste aktualisieren  |
| DELETE  | `/api/lists/{id}` | Liste löschen        |

### Einträge

| Methode | Endpunkt                | Beschreibung            |
| ------- | ----------------------- | ----------------------- |
| GET     | `/api/lists/{id}/items` | Einträge einer Liste    |
| POST    | `/api/lists/{id}/items` | Neuen Eintrag erstellen |
| PUT     | `/api/items/{id}`       | Eintrag aktualisieren   |
| DELETE  | `/api/items/{id}`       | Eintrag löschen         |

### Verlauf

| Methode | Endpunkt                  | Beschreibung        |
| ------- | ------------------------- | ------------------- |
| GET     | `/api/lists/{id}/history` | Verlauf einer Liste |

## PWA Installation

Die App kann auf mobilen Geräten und Desktop als PWA installiert werden:

1. Öffne die App im Browser
2. Im Browser-Menü "Zum Startbildschirm hinzufügen" / "App installieren" wählen
3. Die App erscheint als eigenständige Anwendung

## Lizenz

MIT
