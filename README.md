# NØRA Social Planner

Selfhosted Social-Media-Planer mit:
- Login + CSRF-Schutz
- Rate-Limiting auf dem Login-Endpoint (10 Versuche / 5 Minuten)
- Rollen (`admin`, `editor`, `viewer`)
- Benutzerverwaltung für Admins
- Passwort ändern für den eigenen Account
- Passwort-Reset über Modal (kein Browser-`prompt()`)
- Ideensammlung, Planer und Übersichtsseite
- Kalender mit Drag & Drop (Ideen einplanen + Beiträge verschieben)
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

## Umgebungsvariablen
| Variable       | Standard                     | Beschreibung                              |
|----------------|------------------------------|-------------------------------------------|
| `SECRET_KEY`   | `change-this-in-portainer`   | **Unbedingt ändern!** Flask Session Key   |
| `DB_PATH`      | `/app/data/planner.db`       | Pfad zur SQLite-Datenbank                 |
| `PORT`         | `3000`                       | Interner Port                             |
| `COOKIE_SECURE`| `false`                      | Auf `true` setzen wenn HTTPS aktiv ist    |

## Netzwerk
Der Container joined automatisch das externe Docker-Netzwerk `npm_default`
(Nginx Proxy Manager). Falls dieses Netzwerk nicht existiert:
```bash
docker network create npm_default
```

## Rollen
- `admin`: alles + Benutzerverwaltung
- `editor`: Beiträge anlegen/bearbeiten/löschen
- `viewer`: nur lesen

## Sicherheitshinweise
- `SECRET_KEY` in Portainer als Environment-Variable setzen
- `COOKIE_SECURE=true` setzen wenn die App hinter HTTPS läuft
- Standard-Passwort nach erstem Login ändern (App zeigt Warnung)
