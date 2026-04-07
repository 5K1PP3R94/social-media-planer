# NØRA Social Planner V5

Selfhosted Social-Media-Planer mit:
- Login + CSRF-Schutz
- Rate-Limiting auf dem Login-Endpoint
- Rollen (`admin`, `editor`, `viewer`)
- Benutzerverwaltung für Admins
- Passwort ändern für den eigenen Account
- Passwort-Reset über Modal
- Ideensammlung, Planer und Übersichtsseite
- Kalender mit **Monats- und Wochenansicht**
- Drag & Drop (Ideen einplanen + Beiträge verschieben)
- **Planner-Filter** für Suche, Status und Kanal
- **Idea-Suche**
- **Kanäle anlegen, umbenennen und löschen**
- Toast-Benachrichtigungen statt `alert()`
- Warnung bei aktivem Standard-Passwort
- SQLite + Flask + Docker

## Standard-Login
- Benutzer: `admin`
- Passwort: `bitte-sofort-aendern-123`

> ⚠️ Bitte das Passwort nach dem ersten Login sofort ändern!

## Start lokal
```bash
docker compose up -d --build
```

## Portainer
- Stack aus Git oder Upload anlegen
- danach **Rebuild image** aktivieren
- Standardport im Stack: `3005` (extern) → `3000` (intern)
