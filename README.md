# Social Media Planner

Ein selfhosted Social-Media-Planer mit drei Ansichten:

- **Planer** für die eigentliche Arbeit
- **Ideensammlung** als schneller Eingangskorb
- **Planübersicht** als kompakte Liste aller geplanten Inhalte

## Stack

- Python 3
- SQLite
- HTML / CSS / Vanilla JS
- Docker / Docker Compose

## Was die App schon kann

- Ideen anlegen
- Ideen in den Planer übernehmen
- Geplante Posts wieder zurück in die Ideensammlung schicken
- Posts bearbeiten
- Posts löschen
- Kompakte Planübersicht
- Persistente Daten per SQLite-Volume

## Lokaler Start ohne Docker

```bash
python src/server.py
```

Die App läuft dann auf `http://localhost:3000`.

## Start mit Docker Compose

```bash
docker compose up -d --build
```

Danach läuft die App auf `http://localhost:3000`.

## Projektstruktur

```text
social-media-planner/
├── data/                # SQLite-Datei wird hier gespeichert
├── public/              # HTML, CSS, JS
├── src/
│   └── server.py        # Webserver, API und Datenbank-Setup
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Wichtige API-Endpunkte

- `GET /api/posts` – alle Posts
- `GET /api/posts/summary` – Kennzahlen
- `POST /api/posts` – neuen Post anlegen
- `PUT /api/posts/:id` – Post bearbeiten
- `POST /api/posts/:id/plan` – Idee in den Planer übernehmen
- `POST /api/posts/:id/unplan` – Post zurück in die Ideensammlung
- `DELETE /api/posts/:id` – Post löschen

## Deployment-Hinweis

Wenn du das in dein Git-Repo lädst, solltest du die echte SQLite-Datei **nicht** committen. Die wird zur Laufzeit im `data`-Ordner erzeugt und über das Volume erhalten.
