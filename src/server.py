import os, sqlite3, hashlib, secrets, json, time
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, session, redirect

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
DB_PATH = os.environ.get('DB_PATH', os.path.join(BASE_DIR, 'data', 'planner.db'))
SECRET_KEY = os.environ.get('SECRET_KEY', 'change-me-nora-secret')
PORT = int(os.environ.get('PORT', '3000'))

# Startup security warnings
if SECRET_KEY in ('change-me-nora-secret', 'change-this-in-portainer'):
    print("⚠️  WARNING: SECRET_KEY is set to the default value! Set a strong SECRET_KEY in your environment.", flush=True)

CHANNEL_MAP = {
    'FB': 'Facebook', 'IG': 'Instagram', 'LI': 'LinkedIn', 'TT': 'TikTok', 'WEB': 'Website'
}

# --- Rate limiting (in-memory, per IP) ---
LOGIN_ATTEMPTS = {}   # ip -> [timestamp, ...]
MAX_ATTEMPTS = 10
WINDOW_SECONDS = 300  # 5 minutes lockout window

def get_client_ip():
    # Support reverse proxy headers (Nginx Proxy Manager)
    return (
        request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
        or request.headers.get('X-Real-IP', '')
        or request.remote_addr
    )

def is_rate_limited(ip):
    now = time.time()
    attempts = LOGIN_ATTEMPTS.get(ip, [])
    attempts = [t for t in attempts if now - t < WINDOW_SECONDS]
    LOGIN_ATTEMPTS[ip] = attempts
    return len(attempts) >= MAX_ATTEMPTS

def record_attempt(ip):
    now = time.time()
    attempts = LOGIN_ATTEMPTS.get(ip, [])
    attempts = [t for t in attempts if now - t < WINDOW_SECONDS]
    attempts.append(now)
    LOGIN_ATTEMPTS[ip] = attempts

def clear_attempts(ip):
    LOGIN_ATTEMPTS.pop(ip, None)

# --- App setup ---
app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')
app.secret_key = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('COOKIE_SECURE', 'false').lower() == 'true',
    SESSION_COOKIE_NAME='nora_session',
    PERMANENT_SESSION_LIFETIME=86400 * 7,  # 7 days
)

# --- CSRF protection ---
def generate_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(32)
    return session['csrf_token']

def check_csrf():
    """Validate CSRF token for state-changing requests."""
    token = request.headers.get('X-CSRF-Token') or (request.get_json(silent=True) or {}).get('_csrf')
    if not token or token != session.get('csrf_token'):
        return jsonify({'error': 'CSRF-Validierung fehlgeschlagen'}), 403
    return None

def csrf_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        err = check_csrf()
        if err:
            return err
        return fn(*args, **kwargs)
    return wrapper


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_pw(password: str, salt: str | None = None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 200000).hex()
    return salt, digest


def normalize_channels(raw):
    result = []
    seen = set()
    for item in raw or []:
        name = CHANNEL_MAP.get((item or '').strip(), (item or '').strip())
        if name and name not in seen:
            seen.add(name)
            result.append(name)
    return result


def parse_channels(value):
    try:
        return normalize_channels(json.loads(value or '[]'))
    except Exception:
        return []


def ensure_channel(conn, name):
    name = CHANNEL_MAP.get((name or '').strip(), (name or '').strip())
    if name:
        conn.execute('INSERT OR IGNORE INTO channels(name) VALUES (?)', (name,))
    return name


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = db()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS content_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          notes TEXT DEFAULT '',
          planned_date TEXT,
          category TEXT DEFAULT '',
          content_type TEXT DEFAULT '',
          channels TEXT DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'idea',
          location TEXT NOT NULL DEFAULT 'ideas',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    user_cols = [r['name'] for r in cur.execute('PRAGMA table_info(users)').fetchall()]
    if 'is_active' not in user_cols:
        cur.execute('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1')

    for c in ['Allgemein', 'Service', 'Verkauf', 'Mitarbeiter', 'Redaktionell']:
        cur.execute('INSERT OR IGNORE INTO categories(name) VALUES (?)', (c,))
    for t in ['Reel', 'Grafik', 'Foto', 'Animation', 'Story']:
        cur.execute('INSERT OR IGNORE INTO content_types(name) VALUES (?)', (t,))
    for channel in ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'Website']:
        cur.execute('INSERT OR IGNORE INTO channels(name) VALUES (?)', (channel,))

    cur.execute('SELECT COUNT(*) AS c FROM users')
    if cur.fetchone()['c'] == 0:
        salt, digest = hash_pw('bitte-sofort-aendern-123')
        cur.execute(
            'INSERT INTO users(username, password_salt, password_hash, role, is_active) VALUES (?,?,?,?,1)',
            ('admin', salt, digest, 'admin')
        )

    cur.execute('SELECT COUNT(*) AS c FROM posts')
    if cur.fetchone()['c'] == 0:
        demo = [
            ('Ausstellung Detailpost', '', '2026-04-13', 'Allgemein', 'Reel', json.dumps(['Facebook', 'Instagram', 'LinkedIn']), 'work', 'planner'),
            ('Ende Winterreifenpflicht', '', '2026-04-15', 'Service', 'Grafik', json.dumps(['Facebook', 'Instagram', 'LinkedIn']), 'work', 'planner'),
            ('Morgen geht\'s los (Ausstellung)', '', '2026-04-17', 'Allgemein', 'Reel', json.dumps(['Facebook', 'Instagram', 'LinkedIn']), 'planned', 'planner'),
            ('Nachbericht Ausstellung', '', '2026-04-21', 'Allgemein', 'Reel', json.dumps(['Facebook', 'Instagram', 'LinkedIn']), 'work', 'planner'),
            ('Star Wars Day?', 'Humorvoller Sci-Fi-Post', None, 'Verkauf', 'Reel', json.dumps(['Facebook', 'Instagram']), 'idea', 'ideas'),
            ('Urlaubscheck Wischerblätter', 'Kurzer Service-Hinweis vor Reisebeginn', None, 'Service', 'Reel', json.dumps(['Facebook', 'Instagram']), 'idea', 'ideas'),
        ]
        cur.executemany('INSERT INTO posts(title,notes,planned_date,category,content_type,channels,status,location) VALUES (?,?,?,?,?,?,?,?)', demo)

    # normalize old channel abbreviations in existing posts
    cur.execute('SELECT id, channels FROM posts')
    for row in cur.fetchall():
        normalized = normalize_channels(parse_channels(row['channels']))
        cur.execute('UPDATE posts SET channels=? WHERE id=?', (json.dumps(normalized), row['id']))
        for name in normalized:
            cur.execute('INSERT OR IGNORE INTO channels(name) VALUES (?)', (name,))

    conn.commit()
    conn.close()


def require_login(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get('user_id'):
            return jsonify({'error': 'unauthorized'}), 401
        return fn(*args, **kwargs)
    return wrapper


def current_user():
    if not session.get('user_id'):
        return None
    conn = db()
    cur = conn.cursor()
    cur.execute('SELECT id, username, role, is_active, created_at FROM users WHERE id=?', (session['user_id'],))
    row = cur.fetchone()
    conn.close()
    if not row or not row['is_active']:
        session.clear()
        return None
    return dict(row)


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({'error': 'unauthorized'}), 401
        if user['role'] != 'admin':
            return jsonify({'error': 'forbidden'}), 403
        return fn(*args, **kwargs)
    return wrapper


def require_editor_role():
    user = current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    if user['role'] == 'viewer':
        return jsonify({'error': 'Nur lesen'}), 403
    return None


# --- Check if default password is still in use ---
def admin_uses_default_password():
    try:
        conn = db()
        cur = conn.cursor()
        cur.execute("SELECT password_salt, password_hash FROM users WHERE username='admin' AND is_active=1")
        row = cur.fetchone()
        conn.close()
        if not row:
            return False
        _, digest = hash_pw('bitte-sofort-aendern-123', row['password_salt'])
        return digest == row['password_hash']
    except Exception:
        return False


@app.route('/')
def home():
    return redirect('/app' if session.get('user_id') else '/login')


@app.route('/login')
def login_page():
    return send_from_directory(PUBLIC_DIR, 'login.html')


@app.route('/app')
def app_page():
    if not session.get('user_id'):
        return redirect('/login')
    return send_from_directory(PUBLIC_DIR, 'index.html')


@app.post('/api/login')
def login_api():
    ip = get_client_ip()
    if is_rate_limited(ip):
        return jsonify({'error': 'Zu viele Anmeldeversuche. Bitte warte einige Minuten.'}), 429

    data = request.get_json(force=True)
    username = data.get('username', '').strip()
    password = data.get('password', '')
    conn = db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM users WHERE username=?', (username,))
    row = cur.fetchone()
    conn.close()

    if not row or not row['is_active']:
        record_attempt(ip)
        return jsonify({'error': 'Ungültige Zugangsdaten'}), 401

    _, digest = hash_pw(password, row['password_salt'])
    if digest != row['password_hash']:
        record_attempt(ip)
        return jsonify({'error': 'Ungültige Zugangsdaten'}), 401

    clear_attempts(ip)
    session.permanent = True
    session['user_id'] = row['id']
    # Issue a fresh CSRF token on login
    session.pop('csrf_token', None)
    csrf = generate_csrf_token()

    return jsonify({
        'ok': True,
        'csrf_token': csrf,
        'user': {'username': row['username'], 'role': row['role']},
        'default_password': admin_uses_default_password()
    })


@app.post('/api/logout')
def logout_api():
    session.clear()
    return jsonify({'ok': True})


@app.get('/api/me')
def me_api():
    user = current_user()
    csrf = generate_csrf_token()
    return jsonify({
        'authenticated': bool(user),
        'user': user,
        'csrf_token': csrf,
        'default_password': admin_uses_default_password() if user else False
    })


@app.post('/api/account/password')
@require_login
@csrf_required
def change_my_password():
    user = current_user()
    data = request.get_json(force=True)
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    if len(new_password) < 8:
        return jsonify({'error': 'Neues Passwort muss mindestens 8 Zeichen haben'}), 400
    conn = db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM users WHERE id=?', (user['id'],))
    row = cur.fetchone()
    _, digest = hash_pw(current_password, row['password_salt'])
    if digest != row['password_hash']:
        conn.close()
        return jsonify({'error': 'Aktuelles Passwort ist falsch'}), 400
    salt, new_hash = hash_pw(new_password)
    cur.execute('UPDATE users SET password_salt=?, password_hash=? WHERE id=?', (salt, new_hash, user['id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.get('/api/users')
@require_admin
def list_users():
    conn = db()
    cur = conn.cursor()
    cur.execute('SELECT id, username, role, is_active, created_at FROM users ORDER BY username')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.post('/api/users')
@require_admin
@csrf_required
def create_user():
    data = request.get_json(force=True)
    username = data.get('username', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'editor').strip() or 'editor'
    if not username:
        return jsonify({'error': 'Benutzername fehlt'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Passwort muss mindestens 8 Zeichen haben'}), 400
    if role not in ('admin', 'editor', 'viewer'):
        return jsonify({'error': 'Ungültige Rolle'}), 400
    salt, digest = hash_pw(password)
    conn = db()
    cur = conn.cursor()
    try:
        cur.execute('INSERT INTO users(username, password_salt, password_hash, role, is_active) VALUES (?,?,?,?,1)', (username, salt, digest, role))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Benutzername existiert bereits'}), 400
    conn.close()
    return jsonify({'ok': True})


@app.put('/api/users/<int:user_id>')
@require_admin
@csrf_required
def update_user(user_id):
    data = request.get_json(force=True)
    role = data.get('role', 'editor').strip() or 'editor'
    is_active = 1 if data.get('is_active', True) else 0
    if role not in ('admin', 'editor', 'viewer'):
        return jsonify({'error': 'Ungültige Rolle'}), 400
    user = current_user()
    if user_id == user['id'] and not is_active:
        return jsonify({'error': 'Du kannst deinen eigenen Account nicht deaktivieren'}), 400
    conn = db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET role=?, is_active=? WHERE id=?', (role, is_active, user_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.post('/api/users/<int:user_id>/reset-password')
@require_admin
@csrf_required
def reset_user_password(user_id):
    data = request.get_json(force=True)
    new_password = data.get('new_password', '')
    if len(new_password) < 8:
        return jsonify({'error': 'Passwort muss mindestens 8 Zeichen haben'}), 400
    salt, digest = hash_pw(new_password)
    conn = db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET password_salt=?, password_hash=? WHERE id=?', (salt, digest, user_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.delete('/api/users/<int:user_id>')
@require_admin
@csrf_required
def delete_user(user_id):
    user = current_user()
    if user_id == user['id']:
        return jsonify({'error': 'Du kannst deinen eigenen Account nicht löschen'}), 400
    conn = db()
    cur = conn.cursor()
    cur.execute('SELECT COUNT(*) AS c FROM users WHERE is_active=1 AND role="admin"')
    active_admins = cur.fetchone()['c']
    cur.execute('SELECT role, is_active FROM users WHERE id=?', (user_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Benutzer nicht gefunden'}), 404
    if row['role'] == 'admin' and row['is_active'] and active_admins <= 1:
        conn.close()
        return jsonify({'error': 'Der letzte aktive Admin kann nicht gelöscht werden'}), 400
    cur.execute('DELETE FROM users WHERE id=?', (user_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.get('/api/bootstrap')
@require_login
def bootstrap_api():
    conn = db()
    cur = conn.cursor()
    cur.execute('SELECT name FROM categories ORDER BY name')
    categories = [r['name'] for r in cur.fetchall()]
    cur.execute('SELECT name FROM content_types ORDER BY name')
    types = [r['name'] for r in cur.fetchall()]
    cur.execute('SELECT name FROM channels ORDER BY name')
    channels = [r['name'] for r in cur.fetchall()]
    conn.close()
    return jsonify({'categories': categories, 'types': types, 'channels': channels})


@app.get('/api/channels')
@require_login
def channels_api():
    conn = db()
    cur = conn.cursor()
    cur.execute('SELECT name FROM channels ORDER BY name')
    rows = [r['name'] for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.post('/api/channels')
@require_login
@csrf_required
def create_channel():
    deny = require_editor_role()
    if deny:
        return deny
    data = request.get_json(force=True)
    name = CHANNEL_MAP.get(data.get('name', '').strip(), data.get('name', '').strip())
    if not name:
        return jsonify({'error': 'Kanalname fehlt'}), 400
    conn = db()
    try:
        conn.execute('INSERT INTO channels(name) VALUES (?)', (name,))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Kanal existiert bereits'}), 400
    conn.close()
    return jsonify({'ok': True})


@app.delete('/api/channels/<path:name>')
@require_login
@csrf_required
def delete_channel(name):
    deny = require_editor_role()
    if deny:
        return deny
    decoded = CHANNEL_MAP.get(name.strip(), name.strip())
    conn = db()
    cur = conn.cursor()
    cur.execute('DELETE FROM channels WHERE name=?', (decoded,))
    cur.execute('SELECT id, channels FROM posts')
    for row in cur.fetchall():
        channels = [x for x in parse_channels(row['channels']) if x != decoded]
        cur.execute('UPDATE posts SET channels=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (json.dumps(channels), row['id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.get('/api/posts')
@require_login
def posts_api():
    location = request.args.get('location')
    conn = db()
    cur = conn.cursor()
    query = 'SELECT * FROM posts'
    params = []
    if location:
        query += ' WHERE location=?'
        params.append(location)
    query += ' ORDER BY COALESCE(planned_date, "9999-12-31"), id DESC'
    cur.execute(query, params)
    rows = []
    for r in cur.fetchall():
        d = dict(r)
        d['channels'] = parse_channels(d['channels'])
        rows.append(d)
    conn.close()
    return jsonify(rows)


@app.post('/api/posts')
@require_login
@csrf_required
def create_post():
    deny = require_editor_role()
    if deny:
        return deny
    data = request.get_json(force=True)
    title = data.get('title', '').strip()
    if not title:
        return jsonify({'error': 'Titel fehlt'}), 400
    category = data.get('category', '').strip()
    content_type = data.get('content_type', '').strip()
    channels = normalize_channels(data.get('channels', []))
    conn = db()
    cur = conn.cursor()
    if category:
        cur.execute('INSERT OR IGNORE INTO categories(name) VALUES (?)', (category,))
    if content_type:
        cur.execute('INSERT OR IGNORE INTO content_types(name) VALUES (?)', (content_type,))
    for channel in channels:
        cur.execute('INSERT OR IGNORE INTO channels(name) VALUES (?)', (channel,))
    payload = (title, data.get('notes', '').strip(), data.get('planned_date') or None, category, content_type, json.dumps(channels), data.get('status', 'idea'), data.get('location', 'ideas'))
    cur.execute('INSERT INTO posts(title,notes,planned_date,category,content_type,channels,status,location,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)', payload)
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return jsonify({'ok': True, 'id': pid})


@app.put('/api/posts/<int:pid>')
@require_login
@csrf_required
def update_post(pid):
    deny = require_editor_role()
    if deny:
        return deny
    data = request.get_json(force=True)
    category = data.get('category', '').strip()
    content_type = data.get('content_type', '').strip()
    channels = normalize_channels(data.get('channels', []))
    conn = db()
    cur = conn.cursor()
    if category:
        cur.execute('INSERT OR IGNORE INTO categories(name) VALUES (?)', (category,))
    if content_type:
        cur.execute('INSERT OR IGNORE INTO content_types(name) VALUES (?)', (content_type,))
    for channel in channels:
        cur.execute('INSERT OR IGNORE INTO channels(name) VALUES (?)', (channel,))
    cur.execute(
        'UPDATE posts SET title=?, notes=?, planned_date=?, category=?, content_type=?, channels=?, status=?, location=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        (data.get('title', '').strip(), data.get('notes', '').strip(), data.get('planned_date') or None, category, content_type, json.dumps(channels), data.get('status', 'idea'), data.get('location', 'ideas'), pid)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.delete('/api/posts/<int:pid>')
@require_login
@csrf_required
def delete_post(pid):
    deny = require_editor_role()
    if deny:
        return deny
    conn = db()
    conn.execute('DELETE FROM posts WHERE id=?', (pid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.get('/api/summary')
@require_login
def summary():
    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE location='planner'")
    planner = cur.fetchone()['c']
    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE location='ideas'")
    ideas = cur.fetchone()['c']
    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE status='work'")
    work = cur.fetchone()['c']
    cur.execute('SELECT name FROM channels ORDER BY name')
    channel_names = [r['name'] for r in cur.fetchall()]
    cur.execute("SELECT * FROM posts WHERE location='planner' ORDER BY COALESCE(planned_date, '9999-12-31') LIMIT 8")
    upcoming = []
    for r in cur.fetchall():
        d = dict(r)
        d['channels'] = parse_channels(d['channels'])
        upcoming.append(d)
    cur.execute("SELECT * FROM posts WHERE location='ideas' ORDER BY id DESC LIMIT 6")
    openideas = []
    for r in cur.fetchall():
        d = dict(r)
        d['channels'] = parse_channels(d['channels'])
        openideas.append(d)

    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE location='planner' AND (planned_date IS NULL OR planned_date='')")
    missing_dates = cur.fetchone()['c']
    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE location='planner' AND (notes IS NULL OR TRIM(notes)='')")
    missing_notes = cur.fetchone()['c']
    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE location='planner' AND status='work'")
    work_items = cur.fetchone()['c']
    cur.execute("SELECT title, planned_date FROM posts WHERE location='planner' AND planned_date IS NOT NULL AND DATE(planned_date) <= DATE('now', '+3 day') ORDER BY planned_date LIMIT 1")
    next_due = cur.fetchone()
    conn.close()

    todos = []
    if work_items:
        todos.append({'text': f'{work_items} Beitrag/Beiträge sind noch in Arbeit', 'detail': 'Diese Posts brauchen noch Liebe, Pixel oder eine Caption.', 'kind': 'work'})
    if missing_dates:
        todos.append({'text': f'{missing_dates} geplanter Beitrag/Beiträge haben noch kein Datum', 'detail': 'Ohne Datum ist der Kalender eher Deko.', 'kind': 'idea'})
    if missing_notes:
        todos.append({'text': f'{missing_notes} geplanter Beitrag/Beiträge haben noch keine Notizen', 'detail': 'Kann später beim Produzieren unnötig weh tun.', 'kind': 'idea'})
    if next_due:
        todos.append({'text': f'Nächster fälliger Post: {next_due["title"]}', 'detail': f'Geplant für {next_due["planned_date"]}', 'kind': 'planned'})

    return jsonify({'stats': {'planner': planner, 'ideas': ideas, 'work': work, 'channels': len(channel_names), 'channel_names': channel_names[:4]}, 'upcoming': upcoming, 'openIdeas': openideas, 'todos': todos})


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=PORT)
else:
    init_db()
