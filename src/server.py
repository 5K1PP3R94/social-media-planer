import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = BASE_DIR / 'public'
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.environ.get('DB_PATH', DATA_DIR / 'planner.db'))
PORT = int(os.environ.get('PORT', '3000'))

ALLOWED_STATUSES = {'idea', 'in_progress', 'planned', 'published'}
ALLOWED_LOCATIONS = {'idea_pool', 'planner'}
ALLOWED_CHANNELS = {'facebook', 'instagram', 'linkedin', 'tiktok', 'website'}


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'


def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db_conn()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            category TEXT DEFAULT '',
            content_type TEXT DEFAULT '',
            channels TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'idea',
            location TEXT NOT NULL DEFAULT 'idea_pool',
            planned_date TEXT,
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_posts_location ON posts(location);
        CREATE INDEX IF NOT EXISTS idx_posts_planned_date ON posts(planned_date);
        CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
        """
    )
    count = cur.execute('SELECT COUNT(*) FROM posts').fetchone()[0]
    if count == 0:
        seed_now = now_iso()
        seed_items = [
            ('Ausstellung Detailpost', 'Detailfokus auf Highlights der Ausstellung.', 'Allgemein', 'Reel', json.dumps(['facebook', 'instagram', 'linkedin']), 'in_progress', 'planner', '2026-04-13', '', seed_now, seed_now),
            ('Ende Winterreifenpflicht', 'Servicehinweis zum saisonalen Wechsel.', 'Service', 'Grafik', json.dumps(['facebook', 'instagram', 'linkedin']), 'in_progress', 'planner', '2026-04-15', '', seed_now, seed_now),
            ('Morgen geht’s los (Ausstellung)', 'Countdown vor dem Event.', 'Allgemein', 'Reel', json.dumps(['facebook', 'instagram', 'linkedin']), 'planned', 'planner', '2026-04-17', '', seed_now, seed_now),
            ('Nachbericht (Ausstellung)', 'Nachbericht zur Ausstellung mit Stimmung und Highlights.', 'Allgemein', 'Reel', json.dumps(['facebook', 'instagram', 'linkedin']), 'in_progress', 'planner', '2026-04-21', '', seed_now, seed_now),
            ('Earth Day?', 'Eventueller Post mit ökologischem Bezug.', 'Allgemein', 'Reel', json.dumps(['facebook', 'instagram', 'linkedin']), 'idea', 'planner', '2026-04-22', '', seed_now, seed_now),
            ('Dachbox Mieten/Kaufen', 'Saisonales Verkaufsformat.', 'Verkauf', 'Reel', json.dumps(['facebook', 'instagram', 'linkedin']), 'planned', 'planner', '2026-04-28', '', seed_now, seed_now),
            ('Kundenbewertung', 'Kurze Animation mit Kundenstimme.', 'Redaktionell', 'Animation', json.dumps(['facebook', 'instagram', 'linkedin']), 'in_progress', 'planner', '2026-05-01', '', seed_now, seed_now),
            ('Star Wars Day?', 'Humorvoller Autohaus-Post mit Sci-Fi-Anspielung.', 'Verkauf', 'Reel', json.dumps([]), 'idea', 'idea_pool', None, '', seed_now, seed_now),
            ('Urlaubscheck Wischerblätter', 'Schneller Servicepost vor der Reisezeit.', 'Service', 'Reel', json.dumps([]), 'idea', 'idea_pool', None, '', seed_now, seed_now),
            ('Angebot der Woche', 'Flexibles Format für spontane Aktionen.', 'DWA', 'Animation', json.dumps([]), 'idea', 'idea_pool', None, '', seed_now, seed_now),
            ('Muttertag', 'Wertschätzender Mitarbeiter- oder Familienbezug.', 'Mitarbeiter', 'Grafik', json.dumps([]), 'idea', 'idea_pool', None, '', seed_now, seed_now),
        ]
        cur.executemany(
            '''
            INSERT INTO posts (
                title, description, category, content_type, channels, status, location, planned_date, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            seed_items,
        )
    conn.commit()
    conn.close()


def parse_post(row):
    if row is None:
        return None
    result = dict(row)
    result['channels'] = json.loads(result.get('channels') or '[]')
    return result


def parse_body(handler):
    length = int(handler.headers.get('Content-Length', '0'))
    raw = handler.rfile.read(length) if length > 0 else b'{}'
    try:
        return json.loads(raw.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return {}


def normalize_channels(channels):
    if not isinstance(channels, list):
        return []
    return [channel for channel in channels if channel in ALLOWED_CHANNELS]


def normalize_date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '')).date().isoformat()
    except ValueError:
        return None


def validate_payload(body, existing=None):
    title = body.get('title', existing['title'] if existing else '')
    if not isinstance(title, str) or not title.strip():
        raise ValueError('Titel ist erforderlich.')
    title = title.strip()

    description = body.get('description', existing['description'] if existing else '') or ''
    category = body.get('category', existing['category'] if existing else '') or ''
    content_type = body.get('content_type', existing['content_type'] if existing else '') or ''
    notes = body.get('notes', existing['notes'] if existing else '') or ''

    status = body.get('status', existing['status'] if existing else 'idea')
    if status not in ALLOWED_STATUSES:
        raise ValueError('Ungültiger Status.')

    location = body.get('location', existing['location'] if existing else 'idea_pool')
    if location not in ALLOWED_LOCATIONS:
        raise ValueError('Ungültige Position.')

    planned_date = normalize_date(body.get('planned_date', existing['planned_date'] if existing else None))
    channels = normalize_channels(body.get('channels', existing['channels'] if existing else []))

    return {
        'title': title,
        'description': description.strip(),
        'category': category.strip(),
        'content_type': content_type.strip(),
        'notes': notes.strip(),
        'status': status,
        'location': location,
        'planned_date': planned_date,
        'channels': json.dumps(channels),
        'updated_at': now_iso(),
        'created_at': existing['created_at'] if existing else now_iso(),
    }


def get_post(post_id):
    conn = db_conn()
    row = conn.execute('SELECT * FROM posts WHERE id = ?', (post_id,)).fetchone()
    conn.close()
    return parse_post(row)


def list_posts(query):
    clauses = []
    params = []
    location = query.get('location', [None])[0]
    status = query.get('status', [None])[0]
    text = query.get('q', [None])[0]

    if location in ALLOWED_LOCATIONS:
        clauses.append('location = ?')
        params.append(location)
    if status in ALLOWED_STATUSES:
        clauses.append('status = ?')
        params.append(status)
    if text:
        like = f'%{text}%'
        clauses.append('(title LIKE ? OR description LIKE ? OR category LIKE ?)')
        params.extend([like, like, like])

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ''
    sql = f'''SELECT * FROM posts {where}
              ORDER BY CASE WHEN planned_date IS NULL THEN 1 ELSE 0 END, planned_date ASC, id DESC'''
    conn = db_conn()
    rows = [parse_post(row) for row in conn.execute(sql, params).fetchall()]
    conn.close()
    return rows


def summary():
    conn = db_conn()
    cur = conn.cursor()
    data = {
        'ideas': cur.execute("SELECT COUNT(*) FROM posts WHERE location = 'idea_pool'").fetchone()[0],
        'planner': cur.execute("SELECT COUNT(*) FROM posts WHERE location = 'planner'").fetchone()[0],
        'in_progress': cur.execute("SELECT COUNT(*) FROM posts WHERE status = 'in_progress'").fetchone()[0],
        'planned': cur.execute("SELECT COUNT(*) FROM posts WHERE status = 'planned'").fetchone()[0],
        'published': cur.execute("SELECT COUNT(*) FROM posts WHERE status = 'published'").fetchone()[0],
        'channels': 5,
    }
    conn.close()
    return data


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def log_message(self, format, *args):
        return

    def json_response(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def no_content(self):
        self.send_response(204)
        self.end_headers()

    def serve_index(self):
        index = (PUBLIC_DIR / 'index.html').read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(index)))
        self.end_headers()
        self.wfile.write(index)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/health':
            return self.json_response(200, {'ok': True})
        if parsed.path == '/api/posts':
            return self.json_response(200, list_posts(parse_qs(parsed.query)))
        if parsed.path == '/api/posts/summary':
            return self.json_response(200, summary())
        if parsed.path.startswith('/api/'):
            return self.json_response(404, {'error': 'Nicht gefunden.'})
        if parsed.path in ('/', ''):
            return self.serve_index()
        file_path = PUBLIC_DIR / parsed.path.lstrip('/')
        if file_path.exists() and file_path.is_file():
            return super().do_GET()
        return self.serve_index()

    def do_POST(self):
        parsed = urlparse(self.path)
        body = parse_body(self)
        if parsed.path == '/api/posts':
            try:
                payload = validate_payload(body)
                conn = db_conn()
                cur = conn.cursor()
                cur.execute(
                    '''
                    INSERT INTO posts (title, description, category, content_type, channels, status, location, planned_date, notes, created_at, updated_at)
                    VALUES (:title, :description, :category, :content_type, :channels, :status, :location, :planned_date, :notes, :created_at, :updated_at)
                    ''',
                    payload,
                )
                conn.commit()
                post = get_post(cur.lastrowid)
                conn.close()
                return self.json_response(201, post)
            except ValueError as exc:
                return self.json_response(400, {'error': str(exc)})

        if parsed.path.startswith('/api/posts/') and parsed.path.endswith('/plan'):
            post_id = parsed.path.split('/')[3]
            post = get_post(post_id)
            if not post:
                return self.json_response(404, {'error': 'Post nicht gefunden.'})
            planned_date = normalize_date(body.get('planned_date'))
            if not planned_date:
                return self.json_response(400, {'error': 'Bitte ein gültiges Planungsdatum angeben.'})
            channels = normalize_channels(body.get('channels', post['channels']))
            status = body.get('status', 'planned')
            if status not in ALLOWED_STATUSES:
                status = 'planned'
            conn = db_conn()
            conn.execute(
                '''UPDATE posts
                   SET location = 'planner', planned_date = ?, channels = ?, status = ?, updated_at = ?
                   WHERE id = ?''',
                (planned_date, json.dumps(channels), status, now_iso(), post_id),
            )
            conn.commit()
            conn.close()
            return self.json_response(200, get_post(post_id))

        if parsed.path.startswith('/api/posts/') and parsed.path.endswith('/unplan'):
            post_id = parsed.path.split('/')[3]
            post = get_post(post_id)
            if not post:
                return self.json_response(404, {'error': 'Post nicht gefunden.'})
            conn = db_conn()
            conn.execute(
                '''UPDATE posts
                   SET location = 'idea_pool', planned_date = NULL, channels = '[]', status = 'idea', updated_at = ?
                   WHERE id = ?''',
                (now_iso(), post_id),
            )
            conn.commit()
            conn.close()
            return self.json_response(200, get_post(post_id))

        return self.json_response(404, {'error': 'Nicht gefunden.'})

    def do_PUT(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith('/api/posts/'):
            return self.json_response(404, {'error': 'Nicht gefunden.'})
        post_id = parsed.path.split('/')[3]
        post = get_post(post_id)
        if not post:
            return self.json_response(404, {'error': 'Post nicht gefunden.'})
        body = parse_body(self)
        try:
            payload = validate_payload(body, existing=post)
            conn = db_conn()
            conn.execute(
                '''UPDATE posts SET
                   title = :title,
                   description = :description,
                   category = :category,
                   content_type = :content_type,
                   channels = :channels,
                   status = :status,
                   location = :location,
                   planned_date = :planned_date,
                   notes = :notes,
                   updated_at = :updated_at
                   WHERE id = :id''',
                {**payload, 'id': post_id},
            )
            conn.commit()
            conn.close()
            return self.json_response(200, get_post(post_id))
        except ValueError as exc:
            return self.json_response(400, {'error': str(exc)})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith('/api/posts/'):
            return self.json_response(404, {'error': 'Nicht gefunden.'})
        post_id = parsed.path.split('/')[3]
        conn = db_conn()
        cur = conn.cursor()
        cur.execute('DELETE FROM posts WHERE id = ?', (post_id,))
        conn.commit()
        changes = cur.rowcount
        conn.close()
        if changes == 0:
            return self.json_response(404, {'error': 'Post nicht gefunden.'})
        return self.no_content()


if __name__ == '__main__':
    init_db()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), AppHandler)
    print(f'Social Media Planner läuft auf Port {PORT}')
    server.serve_forever()
