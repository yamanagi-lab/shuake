#!/usr/bin/env python3
"""P5R主明文本收录 · 段评后台

只用 Python 标准库。评论先进待审列表，管理员在 /admin 通过后才公开。

用法：
  server.py serve           启动服务（由 systemd 调用）
  server.py set-password    设置或修改管理口令（交互输入，不回显）
  server.py backup          备份数据库，保留 14 天（由 systemd 定时调用）
"""
import getpass
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import sqlite3
import ssl
import sys
import threading
import time
from contextlib import contextmanager
from urllib.parse import urlsplit, parse_qs

DATA = os.environ.get('SHUAKE_DATA', '/var/lib/shuake')
DB_PATH = os.path.join(DATA, 'comments.db')
TLS_CERT = os.path.join(DATA, 'tls', 'fullchain.pem')
TLS_KEY = os.path.join(DATA, 'tls', 'privkey.pem')
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('SHUAKE_PORT', '443'))
USE_TLS = os.environ.get('SHUAKE_TLS', '1') == '1'
ORIGINS = {
    'https://yamanagi-lab.github.io',
    'http://localhost:8643',
    'http://localhost:8642',
    'http://127.0.0.1:8643',
}

MAX_BODY = 4096
MAX_NAME = 16
MAX_TEXT = 300
MAX_QUOTE = 400
MAX_PENDING = 1000          # 待审太多时暂停收新评论，防刷屏
MAX_THREADS = 64
SESSION_DAYS = 30
PBKDF2_ROUNDS = 600_000

KEY_RE = re.compile(r'^[a-z0-9-]{1,40}:[0-9a-z]{1,8}(?:~\d{1,3})?$')
CH_RE = re.compile(r'^[a-z0-9-]{1,40}$')
ANCHOR_RE = re.compile(r'^[a-z0-9-]{0,40}$')
CTRL_RE = re.compile(r'[\x00-\x08\x0b-\x1f\x7f​-‏‪-‮⁦-⁩]')


# ---------------- 数据库 ----------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  ch TEXT NOT NULL,
  anchor TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  ip TEXT NOT NULL DEFAULT '',
  t INTEGER NOT NULL,
  reviewed INTEGER
);
CREATE INDEX IF NOT EXISTS ix_key ON comments(key, status);
CREATE INDEX IF NOT EXISTS ix_ch ON comments(ch, status);
CREATE INDEX IF NOT EXISTS ix_status ON comments(status, id);
CREATE TABLE IF NOT EXISTS bans(ip TEXT PRIMARY KEY, t INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""


@contextmanager
def db():
    """打开数据库；正常结束时提交，出错时回滚，最后都会关闭连接。"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout=5000')
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    os.makedirs(DATA, exist_ok=True)
    with db() as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript(SCHEMA)
        if not conn.execute("SELECT 1 FROM meta WHERE k='secret'").fetchone():
            conn.execute("INSERT INTO meta VALUES('secret', ?)", (secrets.token_hex(32),))


def meta_get(conn, k):
    row = conn.execute('SELECT v FROM meta WHERE k=?', (k,)).fetchone()
    return row['v'] if row else None


def now_ms():
    return int(time.time() * 1000)


# ---------------- 工具 ----------------

class Limiter:
    """滑动窗口限流，按来源分别计数，只存在内存里。"""

    def __init__(self):
        self.hits = {}
        self.lock = threading.Lock()

    def allow(self, key, limit, window):
        now = time.time()
        with self.lock:
            if len(self.hits) > 20000:
                self.hits = {k: v for k, v in self.hits.items() if v and now - v[-1] < 86400}
            q = [t for t in self.hits.get(key, []) if now - t < window]
            ok = len(q) < limit
            if ok:
                q.append(now)
            self.hits[key] = q
            return ok


limiter = Limiter()


def clean_text(s, limit, multiline):
    s = CTRL_RE.sub('', str(s or '')).replace('\r\n', '\n').replace('\r', '\n')
    if multiline:
        s = re.sub(r'[ \t]+\n', '\n', s)
        s = re.sub(r'\n{3,}', '\n\n', s)
    else:
        s = re.sub(r'\s+', ' ', s)
    return s.strip()[:limit]


def hash_password(pw, salt=None):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, PBKDF2_ROUNDS)
    return salt.hex() + '$' + h.hex()


def check_password(pw, stored):
    try:
        salt_hex, h_hex = stored.split('$')
        h = hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt_hex), PBKDF2_ROUNDS)
        return hmac.compare_digest(h.hex(), h_hex)
    except (ValueError, AttributeError):
        return False


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


# ---------------- HTTP ----------------

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'shuake'
    sys_version = ''

    def log_message(self, fmt, *args):
        # 不记录来源地址
        sys.stderr.write('%s\n' % (fmt % args))

    def log_request(self, code='-', size='-'):
        path = urlsplit(self.path).path
        self.log_message('%s %s %s', self.command, path, code)

    # ---- 输出 ----
    def cors(self):
        origin = self.headers.get('Origin')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')

    def send_json(self, code, obj, cache=None):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', cache or 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def fail(self, code, msg):
        self.send_json(code, {'ok': False, 'error': msg})

    def read_json(self):
        try:
            n = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            n = -1
        if n <= 0 or n > MAX_BODY:
            return None
        try:
            obj = json.loads(self.rfile.read(n).decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            return None
        return obj if isinstance(obj, dict) else None

    def client_ip(self):
        return self.client_address[0]

    def ip_tag(self, conn):
        secret = meta_get(conn, 'secret') or ''
        return hmac.new(secret.encode(), self.client_ip().encode(), hashlib.sha256).hexdigest()[:20]

    # ---- 路由 ----
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        u = urlsplit(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if not limiter.allow('get:' + self.client_ip(), 240, 60):
            return self.fail(429, '请求太频繁')
        if u.path == '/api/counts':
            return self.api_counts(q)
        if u.path == '/api/comments':
            return self.api_list(q)
        if u.path == '/api/admin/list':
            return self.admin(self.admin_list, q)
        if u.path in ('/admin', '/admin/'):
            return self.admin_page()
        if u.path == '/healthz':
            return self.send_json(200, {'ok': True})
        self.fail(404, '没有这个地址')

    def do_POST(self):
        u = urlsplit(self.path)
        if u.path == '/api/comments':
            return self.api_post()
        if u.path == '/api/admin/login':
            return self.admin_login()
        if u.path == '/api/admin/logout':
            return self.admin(self.admin_logout, None)
        if u.path == '/api/admin/act':
            return self.admin(self.admin_act, None)
        self.fail(404, '没有这个地址')

    # ---- 公开接口 ----
    def api_counts(self, q):
        ch = q.get('ch', '')
        if not CH_RE.match(ch):
            return self.fail(400, '章节不对')
        with db() as conn:
            rows = conn.execute("SELECT key, COUNT(*) n FROM comments WHERE ch=? AND status='approved' GROUP BY key", (ch,)).fetchall()
        self.send_json(200, {'ok': True, 'counts': {r['key']: r['n'] for r in rows}}, cache='public, max-age=30')

    def api_list(self, q):
        key = q.get('key', '')
        if not KEY_RE.match(key):
            return self.fail(400, '句子标识不对')
        with db() as conn:
            rows = conn.execute("SELECT id, name, text, t FROM comments WHERE key=? AND status='approved' ORDER BY t DESC LIMIT 300", (key,)).fetchall()
        self.send_json(200, {'ok': True, 'items': [dict(r) for r in rows]}, cache='public, max-age=15')

    def api_post(self):
        if self.headers.get('Origin') not in ORIGINS:
            return self.fail(403, '来源不对')
        body = self.read_json()
        if body is None:
            return self.fail(400, '格式不对')
        key, ch, anchor = str(body.get('key', '')), str(body.get('ch', '')), str(body.get('anchor', ''))
        if not KEY_RE.match(key) or not CH_RE.match(ch) or not key.startswith(ch + ':') or not ANCHOR_RE.match(anchor):
            return self.fail(400, '句子标识不对')
        text = clean_text(body.get('text'), MAX_TEXT, True)
        name = clean_text(body.get('name'), MAX_NAME, False)
        quote = clean_text(body.get('quote'), MAX_QUOTE, True)
        if not text:
            return self.fail(400, '内容不能为空')
        if body.get('website'):          # 隐藏字段，只有机器人会填
            return self.send_json(202, {'ok': True, 'status': 'pending', 'id': 0})
        ip = self.client_ip()
        if not limiter.allow('post:' + ip, 4, 300) or not limiter.allow('postday:' + ip, 30, 86400):
            return self.fail(429, '发得太快了，过一会儿再试')
        with db() as conn:
            tag = self.ip_tag(conn)
            if conn.execute('SELECT 1 FROM bans WHERE ip=?', (tag,)).fetchone():
                return self.send_json(202, {'ok': True, 'status': 'pending', 'id': 0})
            if conn.execute("SELECT COUNT(*) FROM comments WHERE status='pending'").fetchone()[0] >= MAX_PENDING:
                return self.fail(503, '待审核的评论太多了，晚点再来')
            cur = conn.execute(
                'INSERT INTO comments(key, ch, anchor, name, text, quote, status, ip, t) VALUES(?,?,?,?,?,?,?,?,?)',
                (key, ch, anchor, name, text, quote, 'pending', tag, now_ms()))
        self.send_json(202, {'ok': True, 'status': 'pending', 'id': cur.lastrowid})

    # ---- 管理 ----
    def admin(self, fn, arg):
        auth = self.headers.get('Authorization', '')
        token = auth[7:] if auth.startswith('Bearer ') else ''
        if not token:
            return self.fail(401, '请先登录')
        with db() as conn:
            row = conn.execute('SELECT expires FROM sessions WHERE hash=?', (sha(token),)).fetchone()
            if not row or row['expires'] < now_ms():
                return self.fail(401, '登录已过期')
        self.token = token
        return fn(arg) if arg is not None else fn()

    def admin_login(self):
        if not limiter.allow('login:' + self.client_ip(), 8, 900):
            return self.fail(429, '尝试次数太多，15 分钟后再试')
        body = self.read_json() or {}
        with db() as conn:
            stored = meta_get(conn, 'admin')
            if not stored or not check_password(str(body.get('password', '')), stored):
                return self.fail(403, '口令不对')
            token = secrets.token_urlsafe(32)
            conn.execute('DELETE FROM sessions WHERE expires<?', (now_ms(),))
            conn.execute('INSERT INTO sessions VALUES(?, ?)', (sha(token), now_ms() + SESSION_DAYS * 86400 * 1000))
        self.send_json(200, {'ok': True, 'token': token})

    def admin_logout(self):
        with db() as conn:
            conn.execute('DELETE FROM sessions WHERE hash=?', (sha(self.token),))
        self.send_json(200, {'ok': True})

    def admin_list(self, q):
        status = q.get('status', 'pending')
        if status not in ('pending', 'approved', 'rejected'):
            return self.fail(400, '状态不对')
        before = int(q['before']) if q.get('before', '').isdigit() else None
        order = 'ASC' if status == 'pending' else 'DESC'
        sql = 'SELECT c.*, (b.ip IS NOT NULL) banned FROM comments c LEFT JOIN bans b ON b.ip=c.ip WHERE c.status=?'
        args = [status]
        if before is not None:
            sql += ' AND c.id < ?' if order == 'DESC' else ' AND c.id > ?'
            args.append(before)
        sql += f' ORDER BY c.id {order} LIMIT 100'
        with db() as conn:
            rows = [dict(r) for r in conn.execute(sql, args).fetchall()]
            stats = {r['status']: r['n'] for r in conn.execute('SELECT status, COUNT(*) n FROM comments GROUP BY status')}
        for r in rows:
            r['ip'] = r['ip'][:6]
            r['banned'] = bool(r['banned'])
        self.send_json(200, {'ok': True, 'items': rows, 'stats': stats})

    def admin_act(self):
        body = self.read_json() or {}
        ids = [int(i) for i in body.get('ids', []) if isinstance(i, int)][:200]
        action = body.get('action')
        if not ids or action not in ('approve', 'reject', 'delete', 'ban', 'unban'):
            return self.fail(400, '操作不对')
        marks = ','.join('?' * len(ids))
        with db() as conn:
            if action in ('approve', 'reject'):
                conn.execute(f'UPDATE comments SET status=?, reviewed=? WHERE id IN ({marks})',
                             ['approved' if action == 'approve' else 'rejected', now_ms(), *ids])
            elif action == 'delete':
                conn.execute(f'DELETE FROM comments WHERE id IN ({marks})', ids)
            else:
                tags = [r['ip'] for r in conn.execute(f'SELECT DISTINCT ip FROM comments WHERE id IN ({marks})', ids) if r['ip']]
                for tag in tags:
                    if action == 'ban':
                        conn.execute('INSERT OR IGNORE INTO bans VALUES(?, ?)', (tag, now_ms()))
                        conn.execute("UPDATE comments SET status='rejected', reviewed=? WHERE ip=? AND status='pending'", (now_ms(), tag))
                    else:
                        conn.execute('DELETE FROM bans WHERE ip=?', (tag,))
        self.send_json(200, {'ok': True})

    def admin_page(self):
        with open(os.path.join(HERE, 'admin.html'), 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header('X-Robots-Tag', 'noindex, nofollow')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        self.wfile.write(body)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, addr, handler, tls):
        super().__init__(addr, handler)
        self.tls = tls
        self.slots = threading.BoundedSemaphore(MAX_THREADS)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def finish_request(self, request, client_address):
        # TLS 握手放在各自的线程里做，慢客户端不会卡住其他连接
        request.settimeout(15)
        if self.tls:
            try:
                request = self.tls.wrap_socket(request, server_side=True)
            except (ssl.SSLError, OSError):
                return
        try:
            self.RequestHandlerClass(request, client_address, self)
        finally:
            try:
                request.close()
            except OSError:
                pass


def tls_context():
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(TLS_CERT, TLS_KEY)

    # 证书每隔几天自动续期一次，这里发现文件变了就重新加载
    def watch():
        last = os.path.getmtime(TLS_CERT)
        while True:
            time.sleep(300)
            try:
                m = os.path.getmtime(TLS_CERT)
                if m != last:
                    ctx.load_cert_chain(TLS_CERT, TLS_KEY)
                    last = m
                    sys.stderr.write('certificate reloaded\n')
            except (OSError, ssl.SSLError) as e:
                sys.stderr.write(f'certificate reload failed: {e}\n')
    threading.Thread(target=watch, daemon=True).start()
    return ctx


def serve():
    init_db()
    tls = tls_context() if USE_TLS else None
    srv = Server(('', PORT), Handler, tls)
    sys.stderr.write(f'listening on :{PORT} tls={bool(tls)}\n')
    srv.serve_forever()


def set_password():
    init_db()
    pw = getpass.getpass('新的管理口令（至少 10 位，输入时不显示）：')
    if len(pw) < 10:
        sys.exit('口令太短了，至少 10 位。')
    if getpass.getpass('再输一遍：') != pw:
        sys.exit('两次输入不一样，没有修改。')
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO meta VALUES('admin', ?)", (hash_password(pw),))
        conn.execute('DELETE FROM sessions')
    print('管理口令已设置。之前登录过的管理页需要重新登录。')


def backup():
    init_db()
    folder = os.path.join(DATA, 'backup')
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, time.strftime('comments-%Y%m%d.db'))
    dst = sqlite3.connect(dest)
    try:
        with db() as src:
            src.backup(dst)
    finally:
        dst.close()
    cutoff = time.time() - 14 * 86400
    for f in os.listdir(folder):
        p = os.path.join(folder, f)
        if f.startswith('comments-') and os.path.getmtime(p) < cutoff:
            os.remove(p)
    print('backup ok:', dest)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'serve'
    {'serve': serve, 'set-password': set_password, 'backup': backup}.get(cmd, lambda: sys.exit(__doc__))()
