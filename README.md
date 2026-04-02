# NORA Social Media Planner

Selfhosted Social-Media-Planer mit:
- Ideensammlung
- Planer
- kompakter Planübersicht
- SQLite
- Docker / Docker Compose
- Benutzerkonten mit Login
- Admin-Benutzerverwaltung

## Start

```bash
docker compose up -d --build
```

Danach erreichbar unter:

```text
http://SERVER-IP:3001
```

## Standard-Login

Die Standard-Zugangsdaten kommen aus der `docker-compose.yml`:

- Benutzername: `admin`
- Passwort: `bitte-sofort-aendern-123`

**Unbedingt direkt ändern.**

## Accountverwaltung

Im Tool gibt es rechts oben den Button **Account**.

Dort kannst du:
- dein Passwort ändern
- dich abmelden
- als Admin neue Benutzer anlegen
- Benutzer löschen
- Passwörter zurücksetzen

## Wichtige Umgebungsvariablen

```yaml
ADMIN_USERNAME: admin
ADMIN_PASSWORD: bitte-sofort-aendern-123
SESSION_DAYS: 14
DB_PATH: /app/data/planner.db
PORT: 3000
```

## Daten

Die SQLite-Datenbank liegt im Volume:

```text
./data -> /app/data
```

## Hinweis bei bestehender Installation

Wenn bereits eine alte `planner.db` ohne Benutzer-Tabellen existiert, werden die neuen Tabellen beim Start automatisch ergänzt.
