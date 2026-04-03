# NØRA Social Planner

Selfhosted Social-Media-Planer mit:
- Login
- Rollen (`admin`, `editor`, `viewer`)
- Benutzerverwaltung für Admins
- Passwort ändern für den eigenen Account
- Ideensammlung, Planer und Übersichtsseite
- SQLite + Flask + Docker

## Standard-Login
- Benutzer: `admin`
- Passwort: `bitte-sofort-aendern-123`

## Start lokal
```bash
docker compose up -d --build
```

## Portainer
- Stack aus Git oder Upload anlegen
- danach **Rebuild image** aktivieren
- Standardport im Stack: `3001`

## Rollen
- `admin`: alles + Benutzerverwaltung
- `editor`: Beiträge anlegen/bearbeiten/löschen
- `viewer`: nur lesen
