import os, sqlite3, hashlib, secrets, json
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, session, redirect

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
DB_PATH = os.environ.get('DB_PATH', os.path.join(BASE_DIR, 'data', 'planner.db'))
SECRET_KEY = os.environ.get('SECRET_KEY', 'change-me-nora-secret')
PORT = int(os.environ.get('PORT', '3001'))

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')
app.secret_key = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_NAME='nora_session'
)


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_pw(password: str, salt: str | None = None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 200000).hex()
    return salt, digest


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
    # migrations
    user_cols = [r['name'] for r in cur.execute('PRAGMA table_info(users)').fetchall()]
    if 'is_active' not in user_cols:
        cur.execute('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1')

    for c in ['Allgemein','Service','Verkauf','Mitarbeiter','Redaktionell']:
        cur.execute('INSERT OR IGNORE INTO categories(name) VALUES (?)', (c,))
    for t in ['Reel','Grafik','Foto','Animation','Story']:
        cur.execute('INSERT OR IGNORE INTO content_types(name) VALUES (?)', (t,))

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
            ('Ausstellung Detailpost','', '2026-04-13','Allgemein','Reel', json.dumps(['FB','IG','LI']), 'work', 'planner'),
            ('Ende Winterreifenpflicht','', '2026-04-15','Service','Grafik', json.dumps(['FB','IG','LI']), 'work', 'planner'),
            ('Morgen geht’s los (Ausstellung)','', '2026-04-17','Allgemein','Reel', json.dumps(['FB','IG','LI']), 'planned', 'planner'),
            ('Nachbericht Ausstellung','', '2026-04-21','Allgemein','Reel', json.dumps(['FB','IG','LI']), 'work', 'planner'),
            ('Star Wars Day?','Humorvoller Sci-Fi-Post', None,'Verkauf','Reel', json.dumps(['FB','IG']), 'idea', 'ideas'),
            ('Urlaubscheck Wischerblätter','Kurzer Service-Hinweis vor Reisebeginn', None,'Service','Reel', json.dumps(['FB','IG']), 'idea', 'ideas'),
        ]
        cur.executemany('INSERT INTO posts(title,notes,planned_date,category,content_type,channels,status,location) VALUES (?,?,?,?,?,?,?,?)', demo)
    conn.commit(); conn.close()


def require_login(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get('user_id'):
            return jsonify({'error':'unauthorized'}), 401
        return fn(*args, **kwargs)
    return wrapper


def current_user():
    if not session.get('user_id'):
        return None
    conn = db(); cur = conn.cursor()
    cur.execute('SELECT id, username, role, is_active, created_at FROM users WHERE id=?', (session['user_id'],))
    row = cur.fetchone(); conn.close()
    if not row or not row['is_active']:
        session.clear()
        return None
    return dict(row)


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({'error':'unauthorized'}), 401
        if user['role'] != 'admin':
            return jsonify({'error':'forbidden'}), 403
        return fn(*args, **kwargs)
    return wrapper


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
    data = request.get_json(force=True)
    username = data.get('username','').strip()
    password = data.get('password','')
    conn = db(); cur = conn.cursor()
    cur.execute('SELECT * FROM users WHERE username=?', (username,))
    row = cur.fetchone(); conn.close()
    if not row or not row['is_active']:
        return jsonify({'error':'Ungültige Zugangsdaten'}), 401
    _, digest = hash_pw(password, row['password_salt'])
    if digest != row['password_hash']:
        return jsonify({'error':'Ungültige Zugangsdaten'}), 401
    session['user_id'] = row['id']
    return jsonify({'ok': True, 'user': {'username': row['username'], 'role': row['role']}})


@app.post('/api/logout')
def logout_api():
    session.clear()
    return jsonify({'ok': True})


@app.get('/api/me')
def me_api():
    user = current_user()
    return jsonify({'authenticated': bool(user), 'user': user})


@app.post('/api/account/password')
@require_login
def change_my_password():
    user = current_user()
    data = request.get_json(force=True)
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    if len(new_password) < 8:
        return jsonify({'error': 'Neues Passwort muss mindestens 8 Zeichen haben'}), 400
    conn = db(); cur = conn.cursor()
    cur.execute('SELECT * FROM users WHERE id=?', (user['id'],))
    row = cur.fetchone()
    _, digest = hash_pw(current_password, row['password_salt'])
    if digest != row['password_hash']:
        conn.close()
        return jsonify({'error': 'Aktuelles Passwort ist falsch'}), 400
    salt, new_hash = hash_pw(new_password)
    cur.execute('UPDATE users SET password_salt=?, password_hash=? WHERE id=?', (salt, new_hash, user['id']))
    conn.commit(); conn.close()
    return jsonify({'ok': True})


@app.get('/api/users')
@require_admin
def list_users():
    conn = db(); cur = conn.cursor()
    cur.execute('SELECT id, username, role, is_active, created_at FROM users ORDER BY username')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


@app.post('/api/users')
@require_admin
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
    conn = db(); cur = conn.cursor()
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
def update_user(user_id):
    data = request.get_json(force=True)
    role = data.get('role', 'editor').strip() or 'editor'
    is_active = 1 if data.get('is_active', True) else 0
    if role not in ('admin', 'editor', 'viewer'):
        return jsonify({'error': 'Ungültige Rolle'}), 400
    user = current_user()
    if user_id == user['id'] and not is_active:
        return jsonify({'error': 'Du kannst deinen eigenen Account nicht deaktivieren'}), 400
    conn = db(); cur = conn.cursor()
    cur.execute('UPDATE users SET role=?, is_active=? WHERE id=?', (role, is_active, user_id))
    conn.commit(); conn.close()
    return jsonify({'ok': True})


@app.post('/api/users/<int:user_id>/reset-password')
@require_admin
def reset_user_password(user_id):
    data = request.get_json(force=True)
    new_password = data.get('new_password', '')
    if len(new_password) < 8:
        return jsonify({'error': 'Passwort muss mindestens 8 Zeichen haben'}), 400
    salt, digest = hash_pw(new_password)
    conn = db(); cur = conn.cursor()
    cur.execute('UPDATE users SET password_salt=?, password_hash=? WHERE id=?', (salt, digest, user_id))
    conn.commit(); conn.close()
    return jsonify({'ok': True})


@app.delete('/api/users/<int:user_id>')
@require_admin
def delete_user(user_id):
    user = current_user()
    if user_id == user['id']:
        return jsonify({'error': 'Du kannst deinen eigenen Account nicht löschen'}), 400
    conn = db(); cur = conn.cursor()
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
    conn.commit(); conn.close()
    return jsonify({'ok': True})


@app.get('/api/bootstrap')
@require_login
def bootstrap_api():
    conn = db(); cur = conn.cursor()
    cur.execute('SELECT name FROM categories ORDER BY name')
    categories = [r['name'] for r in cur.fetchall()]
    cur.execute('SELECT name FROM content_types ORDER BY name')
    types = [r['name'] for r in cur.fetchall()]
    conn.close()
    return jsonify({'categories': categories, 'types': types, 'channels': ['FB','IG','LI','TT','WEB']})


@app.get('/api/posts')
@require_login
def posts_api():
    location = request.args.get('location')
    conn = db(); cur = conn.cursor()
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
        d['channels'] = json.loads(d['channels'] or '[]')
        rows.append(d)
    conn.close()
    return jsonify(rows)


@app.post('/api/posts')
@require_login
def create_post():
    user = current_user()
    if user['role'] == 'viewer':
        return jsonify({'error': 'Nur lesen'}), 403
    data = request.get_json(force=True)
    title = data.get('title','').strip()
    if not title:
        return jsonify({'error':'Titel fehlt'}), 400
    category = data.get('category','').strip()
    content_type = data.get('content_type','').strip()
    conn = db(); cur = conn.cursor()
    if category:
        cur.execute('INSERT OR IGNORE INTO categories(name) VALUES (?)', (category,))
    if content_type:
        cur.execute('INSERT OR IGNORE INTO content_types(name) VALUES (?)', (content_type,))
    payload = (title, data.get('notes','').strip(), data.get('planned_date') or None, category, content_type, json.dumps(data.get('channels', [])), data.get('status','idea'), data.get('location','ideas'))
    cur.execute('INSERT INTO posts(title,notes,planned_date,category,content_type,channels,status,location,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)', payload)
    conn.commit(); pid = cur.lastrowid; conn.close()
    return jsonify({'ok': True, 'id': pid})


@app.put('/api/posts/<int:pid>')
@require_login
def update_post(pid):
    user = current_user()
    if user['role'] == 'viewer':
        return jsonify({'error': 'Nur lesen'}), 403
    data = request.get_json(force=True)
    category = data.get('category','').strip()
    content_type = data.get('content_type','').strip()
    conn = db(); cur = conn.cursor()
    if category:
        cur.execute('INSERT OR IGNORE INTO categories(name) VALUES (?)', (category,))
    if content_type:
        cur.execute('INSERT OR IGNORE INTO content_types(name) VALUES (?)', (content_type,))
    cur.execute('UPDATE posts SET title=?, notes=?, planned_date=?, category=?, content_type=?, channels=?, status=?, location=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (data.get('title','').strip(), data.get('notes','').strip(), data.get('planned_date') or None, category, content_type, json.dumps(data.get('channels', [])), data.get('status','idea'), data.get('location','ideas'), pid))
    conn.commit(); conn.close()
    return jsonify({'ok': True})


@app.delete('/api/posts/<int:pid>')
@require_login
def delete_post(pid):
    user = current_user()
    if user['role'] == 'viewer':
        return jsonify({'error': 'Nur lesen'}), 403
    conn = db(); conn.execute('DELETE FROM posts WHERE id=?', (pid,)); conn.commit(); conn.close()
    return jsonify({'ok': True})


@app.get('/api/summary')
@require_login
def summary():
    conn = db(); cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE location='planner'")
    planner = cur.fetchone()['c']
    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE location='ideas'")
    ideas = cur.fetchone()['c']
    cur.execute("SELECT COUNT(*) AS c FROM posts WHERE status='work'")
    work = cur.fetchone()['c']
    cur.execute("SELECT * FROM posts WHERE location='planner' ORDER BY COALESCE(planned_date, '9999-12-31') LIMIT 8")
    upcoming = []
    for r in cur.fetchall():
        d = dict(r); d['channels']=json.loads(d['channels'] or '[]'); upcoming.append(d)
    cur.execute("SELECT * FROM posts WHERE location='ideas' ORDER BY id DESC LIMIT 6")
    openideas=[]
    for r in cur.fetchall():
        d = dict(r); d['channels']=json.loads(d['channels'] or '[]'); openideas.append(d)
    conn.close()
    todos = [
      {'text':'2 Beiträge brauchen noch eine Caption', 'kind':'work'},
      {'text':'1 geplanter Post hat noch kein Datum', 'kind':'idea'},
      {'text':'Muttertag-Idee bis nächste Woche entscheiden', 'kind':'planned'}
    ]
    return jsonify({'stats': {'planner': planner, 'ideas': ideas, 'work': work, 'channels': 5}, 'upcoming': upcoming, 'openIdeas': openideas, 'todos': todos})


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=PORT)
else:
    init_db()
