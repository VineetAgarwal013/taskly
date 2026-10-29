const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.TASKLY_DB ? path.resolve(process.env.TASKLY_DB) : path.join(ROOT, 'taskly.db');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 5 * 1024 * 1024;

const env = loadEnv();
const API_KEY = env.GEMINI_API_KEY || '';
const SEED_TASKS = require('./data/default-tasks.js');
const Gemini = require('./api/_gemini.js');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

/* ==========================================================================
   SQLite storage (sql.js — WASM build of SQLite, persisted to taskly.db)
   ========================================================================== */

let db = null;
let persistTimer = null;

function openDB() {
    const SQL = initSqlJs({ locateFile: function () { return path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'); } });
    return SQL.then(function (SQL) {
        let database = null;
        try {
            const buf = fs.readFileSync(DB_FILE);
            database = new SQL.Database(buf);
        } catch (e) {
            database = new SQL.Database();
        }
        database.run('PRAGMA foreign_keys = ON');
        database.run(
            'CREATE TABLE IF NOT EXISTS users (' +
                'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
                'username TEXT NOT NULL UNIQUE, ' +
                'password_hash TEXT NOT NULL, ' +
                'salt TEXT NOT NULL, ' +
                'created_at INTEGER NOT NULL)'
        );
        database.run(
            'CREATE TABLE IF NOT EXISTS sessions (' +
                'token TEXT PRIMARY KEY, ' +
                'user_id INTEGER NOT NULL, ' +
                'created_at INTEGER NOT NULL)'
        );
        database.run(
            'CREATE TABLE IF NOT EXISTS categories (' +
                'user_id INTEGER NOT NULL, ' +
                'name TEXT NOT NULL, ' +
                'position INTEGER NOT NULL, ' +
                'PRIMARY KEY (user_id, name))'
        );
        database.run(
            'CREATE TABLE IF NOT EXISTS tasks (' +
                'id TEXT NOT NULL, ' +
                'user_id INTEGER NOT NULL, ' +
                'title TEXT NOT NULL, ' +
                'description TEXT NOT NULL DEFAULT \'\', ' +
                'tip TEXT NOT NULL DEFAULT \'\', ' +
                'category TEXT NOT NULL DEFAULT \'\', ' +
                'priority TEXT NOT NULL DEFAULT \'none\', ' +
                'created_date TEXT, ' +
                'created_at TEXT, ' +
                'due_date TEXT, ' +
                'reminder TEXT, ' +
                'completed INTEGER NOT NULL DEFAULT 0, ' +
                'archived INTEGER NOT NULL DEFAULT 0, ' +
                'completed_at INTEGER, ' +
                'PRIMARY KEY (id, user_id))'
        );
        database.run(
            'CREATE TABLE IF NOT EXISTS settings (' +
                'user_id INTEGER NOT NULL, ' +
                'key TEXT NOT NULL, ' +
                'value TEXT NOT NULL, ' +
                'PRIMARY KEY (user_id, key))'
        );
        database.run('DELETE FROM sessions WHERE created_at < ?', [Date.now() - SESSION_TTL_MS]);
        return database;
    });
}

/* Debounced write-back of the in-memory SQLite image to taskly.db */
function persistNow() {
    if (!db) return;
    try { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); } catch (e) {
        console.error('Failed to persist taskly.db:', e.message);
    }
}

function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 120);
}

/* ==================== Auth helpers ==================== */

function hashPassword(password, salt) {
    return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    db.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', [token, userId, Date.now()]);
    persistSoon();
    return token;
}

function getUserIdFromReq(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const rows = selectAll('SELECT user_id, created_at FROM sessions WHERE token = ?', [m[1]]);
    if (!rows.length) return null;
    if (rows[0].created_at < Date.now() - SESSION_TTL_MS) {
        db.run('DELETE FROM sessions WHERE token = ?', [m[1]]);
        persistSoon();
        return null;
    }
    return rows[0].user_id;
}

/* ==================== Data mapping ==================== */

function selectAll(sql, params) {
    const res = db.exec(sql, params || []);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(function (row) {
        const o = {};
        cols.forEach(function (c, i) { o[c] = row[i]; });
        return o;
    });
}

function rowToTask(r) {
    return {
        id: r.id,
        title: r.title,
        description: r.description,
        tip: r.tip,
        category: r.category,
        priority: r.priority,
        createdDate: r.created_date,
        createdAt: r.created_at,
        dueDate: r.due_date,
        reminder: r.reminder,
        completed: !!r.completed,
        archived: !!r.archived,
        completedAt: r.completed_at
    };
}

function taskToRow(userId, t) {
    return [
        String(t.id || ''), userId, String(t.title || ''),
        String(t.description || ''), String(t.tip || ''),
        String(t.category || ''), String(t.priority || 'none'),
        t.createdDate || null, t.createdAt || null,
        t.dueDate || null, t.reminder || null,
        t.completed ? 1 : 0, t.archived ? 1 : 0,
        t.completedAt != null ? t.completedAt : null
    ];
}

function insertTask(userId, t) {
    db.run(
        'INSERT INTO tasks (id, user_id, title, description, tip, category, priority, created_date, created_at, due_date, reminder, completed, archived, completed_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        taskToRow(userId, t)
    );
}

function getState(userId) {
    const categories = selectAll('SELECT name FROM categories WHERE user_id = ? ORDER BY position ASC', [userId])
        .map(function (r) { return r.name; });
    const tasks = selectAll('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC', [userId])
        .map(rowToTask);
    const settings = {};
    selectAll('SELECT key, value FROM settings WHERE user_id = ?', [userId]).forEach(function (r) {
        try { settings[r.key] = JSON.parse(r.value); } catch (e) { settings[r.key] = r.value; }
    });
    return { categories: categories, tasks: tasks, settings: settings };
}

function saveState(userId, payload) {
    const cats = Array.isArray(payload.categories) ? payload.categories.slice(0, 200) : [];
    const tasks = Array.isArray(payload.tasks) ? payload.tasks.slice(0, 5000) : [];
    const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
    db.run('BEGIN');
    try {
        db.run('DELETE FROM categories WHERE user_id = ?', [userId]);
        db.run('DELETE FROM tasks WHERE user_id = ?', [userId]);
        db.run('DELETE FROM settings WHERE user_id = ?', [userId]);
        cats.forEach(function (name, i) {
            db.run('INSERT INTO categories (user_id, name, position) VALUES (?, ?, ?)', [userId, String(name), i]);
        });
        tasks.forEach(function (t) { insertTask(userId, t); });
        Object.keys(settings).forEach(function (k) {
            db.run('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)', [userId, String(k), JSON.stringify(settings[k])]);
        });
        db.run('COMMIT');
    } catch (e) {
        db.run('ROLLBACK');
        throw e;
    }
    persistSoon();
}

/* One-time migration: imports a legacy localStorage snapshot (tasks,
   categories, device settings) the first time an account has no data. */
function importSnapshot(userId, snap) {
    if (!snap || typeof snap !== 'object') return;
    const tasks = Array.isArray(snap.tasks) ? snap.tasks : [];
    const cats = Array.isArray(snap.categories) ? snap.categories : [];
    if (cats.length) {
        cats.forEach(function (name, i) {
            db.run('INSERT INTO categories (user_id, name, position) VALUES (?, ?, ?)', [userId, String(name), i]);
        });
    }
    tasks.forEach(function (t) { insertTask(userId, t); });
    if (snap.settings && typeof snap.settings === 'object') {
        ['theme', 'sidebar_collapsed', 'shortcuts_seen'].forEach(function (k) {
            if (snap.settings[k] !== undefined && snap.settings[k] !== null) {
                db.run('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)', [userId, k, JSON.stringify(snap.settings[k])]);
            }
        });
    }
    persistSoon();
}

function taskCount(userId) {
    const res = db.exec('SELECT COUNT(*) AS c FROM tasks WHERE user_id = ?', [userId]);
    return res.length ? res[0].values[0][0] : 0;
}

function hasCategories(userId) {
    return !!selectAll('SELECT name FROM categories WHERE user_id = ? LIMIT 1', [userId]).length;
}

/* Seeds default data for a brand-new (or migrated) account. */
function seedDataFor(userId, username) {
    const created = new Date().toISOString();
    if (username === 'Vineet') {
        ['Items to Buy', 'Chores / Job Hunt', 'Homework'].forEach(function (name, i) {
            db.run('INSERT INTO categories (user_id, name, position) VALUES (?, ?, ?)', [userId, name, i]);
        });
        SEED_TASKS.forEach(function (t) {
            insertTask(userId, {
                id: t.id, title: t.title, description: t.description || '', tip: '',
                category: t.category, priority: t.priority || 'med',
                createdDate: todayStr(), createdAt: created,
                dueDate: t.dueDate || null, reminder: null,
                completed: false, completedAt: null, archived: false
            });
        });
    } else {
        const stamp = Date.now();
        const mk = function (id, title, tip, category, priority) {
            return {
                id: id + '-' + stamp, title: title, description: '', tip: tip,
                category: category, priority: priority,
                createdDate: todayStr(), createdAt: created,
                dueDate: null, reminder: null,
                completed: false, completedAt: null, archived: false
            };
        };
        ['🎯 Getting Started', '💡 Pro Tips', '📁 Sample Project'].forEach(function (name, i) {
            db.run('INSERT INTO categories (user_id, name, position) VALUES (?, ?, ?)', [userId, name, i]);
        });
        [
            mk('gs-1', 'Welcome to Taskly AI 👋', 'Check the box — it animates into the Archive', '🎯 Getting Started', 'high'),
            mk('gs-2', 'Add your first task', 'Type in the dock below and press Enter', '🎯 Getting Started', 'med'),
            mk('tp-1', 'Use priorities', '!!! High · !! Medium · ! Low', '💡 Pro Tips', 'med'),
            mk('tp-2', 'Set a deadline', 'Pick a date in the dock’s deadline menu', '💡 Pro Tips', 'low'),
            mk('sp-1', 'Plan your week', 'Drag cards between columns', '📁 Sample Project', 'low'),
            mk('sp-2', 'Organize with categories', 'Use “+ Add Category” in the sidebar', '📁 Sample Project', 'low')
        ].forEach(function (t) { insertTask(userId, t); });
    }
    persistSoon();
}

/* First-login data bootstrap: a legacy snapshot wins (migration), otherwise
   the account gets its default seed. Never overwrites existing data. */
function ensureUserData(userId, username, snapshot) {
    if (taskCount(userId) > 0 || hasCategories(userId)) return;
    if (snapshot) importSnapshot(userId, snapshot);
    else seedDataFor(userId, username);
}

/* ==================== Seeds ==================== */

function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* The built-in account: only the row is created at boot; its data is seeded
   lazily on first login (legacy snapshot first, default seed as fallback). */
function ensureVineetAccount() {
    if (selectAll('SELECT id FROM users WHERE username = ?', ['Vineet']).length) return;
    const salt = crypto.randomBytes(16).toString('hex');
    db.run('INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)',
        ['Vineet', hashPassword('Vineet', salt), salt, Date.now()]);
    persistSoon();
}

/* ==========================================================================
   HTTP handling
   ========================================================================== */

function loadEnv() {
    const out = {};
    try {
        const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
        text.split(/\r?\n/).forEach(function (line) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        });
    } catch (e) { }
    return out;
}

function serveStatic(req, res) {
    let pathname = decodeURIComponent(req.url.split('?')[0]);
    if (pathname === '/') pathname = '/index.html';
    const rel = pathname.replace(/^\/+/, '');
    /* Allowlist: only the page and its asset folders. Everything else
       (taskly.db, .env, server.js, node_modules, bench/) stays private. */
    const top = rel.split('/')[0];
    if (rel !== 'index.html' && ['css', 'js', 'data', 'img'].indexOf(top) === -1) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    const filePath = path.resolve(path.join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    fs.readFile(filePath, function (err, data) {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    });
}

function readBody(req, res, done) {
    let body = '';
    let tooLarge = false;
    req.on('data', function (c) {
        if (tooLarge) return;
        body += c;
        if (body.length > MAX_BODY) {
            /* Respond once, then drop the connection; 'end' must not
               run the handler (it would answer a second time). */
            tooLarge = true;
            body = '';
            res.writeHead(413, { 'Content-Type': 'text/plain', 'Connection': 'close' });
            res.end('Payload too large', function () { req.destroy(); });
        }
    });
    req.on('end', function () {
        if (tooLarge) return;
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (e) { }
        done(parsed);
    });
    req.on('error', function () {
        res.writeHead(400);
        res.end('Bad request');
    });
}

function sendJSON(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

/* ==================== Auth endpoints ==================== */

function handleRegister(req, res, body) {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!/^[A-Za-z0-9 _.-]{2,30}$/.test(username)) {
        sendJSON(res, 400, { ok: false, error: 'Username must be 2-30 characters (letters, numbers, spaces, _ . -)' });
        return;
    }
    if (password.length < 4) {
        sendJSON(res, 400, { ok: false, error: 'Password must be at least 4 characters' });
        return;
    }
    if (selectAll('SELECT id FROM users WHERE username = ?', [username]).length) {
        sendJSON(res, 409, { ok: false, error: 'That username is already taken' });
        return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    db.run('INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)',
        [username, hashPassword(password, salt), salt, Date.now()]);
    const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    ensureUserData(id, username, body.snapshot);
    const token = createSession(id);
    sendJSON(res, 201, { ok: true, token: token, user: username, data: getState(id) });
}

function handleLogin(req, res, body) {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const users = selectAll('SELECT id, password_hash, salt FROM users WHERE username = ?', [username]);
    if (!users.length) {
        sendJSON(res, 401, { ok: false, error: 'User not found — create an account first' });
        return;
    }
    const user = users[0];
    const expected = hashPassword(password, user.salt);
    const actual = user.password_hash;
    if (expected.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))) {
        sendJSON(res, 401, { ok: false, error: 'Incorrect password' });
        return;
    }
    /* Data bootstrap: legacy snapshot first (migration), default seed
       otherwise. Never overwrites existing data. */
    ensureUserData(user.id, username, body.snapshot);
    const token = createSession(user.id);
    sendJSON(res, 200, { ok: true, token: token, user: username, data: getState(user.id) });
}

function handleLogout(req, res, userId) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (m) {
        db.run('DELETE FROM sessions WHERE token = ?', [m[1]]);
        persistSoon();
    }
    sendJSON(res, 200, { ok: true });
}

/* ==================== Gemini classify (api/_gemini.js) ==================== */

function handleClassify(req, res) {
    readBody(req, res, function (body) {
        if (!API_KEY) {
            sendJSON(res, 200, { ok: false, error: 'missing_key', message: 'Add your GEMINI_API_KEY to the .env file and restart the server.' });
            return;
        }
        const text = String(body.text || '').trim();
        const categories = Array.isArray(body.categories) && body.categories.length
            ? body.categories
            : ['Items to Buy', 'Chores / Job Hunt', 'Homework'];
        if (text.length < 3) {
            sendJSON(res, 400, { ok: false, error: 'text_too_short' });
            return;
        }
        Gemini.classify(text, categories, { apiKey: API_KEY }).then(function (result) {
            sendJSON(res, 200, { ok: true, result: result });
        }).catch(function (err) {
            sendJSON(res, 200, { ok: false, error: 'gemini_error', message: String(err.message || err) });
        });
    });
}

/* ==================== Boot ==================== */

/* Listen only once SQLite is open, so no request ever sees db === null. */
openDB().then(function (database) {
    db = database;
    ensureVineetAccount();
    console.log('SQLite: ' + DB_FILE + (fs.existsSync(DB_FILE) ? ' (loaded)' : ' (created)'));
    startServer();
}).catch(function (err) {
    console.error('Failed to open SQLite database:', err.message);
    process.exit(1);
});

process.on('SIGINT', function () {
    persistNow();
    process.exit();
});
process.on('SIGTERM', function () {
    persistNow();
    process.exit();
});
process.on('exit', persistNow);

function startServer() {
    http.createServer(function (req, res) {
        const u = req.url.split('?')[0];
        const authUserId = getUserIdFromReq(req);

        if (req.method === 'POST' && u === '/api/classify') { handleClassify(req, res); return; }
        if (req.method === 'POST' && u === '/api/auth/register') { readBody(req, res, function (b) { handleRegister(req, res, b); }); return; }
        if (req.method === 'POST' && u === '/api/auth/login') { readBody(req, res, function (b) { handleLogin(req, res, b); }); return; }
        if (req.method === 'POST' && u === '/api/auth/logout') { handleLogout(req, res, authUserId); return; }
        if (req.method === 'GET' && u === '/api/bootstrap') {
            sendJSON(res, 200, { ok: true, hasUsers: !!selectAll('SELECT id FROM users LIMIT 1').length });
            return;
        }
        if (req.method === 'GET' && u === '/api/state') {
            if (!authUserId) { sendJSON(res, 401, { ok: false, error: 'unauthorized' }); return; }
            const user = selectAll('SELECT username FROM users WHERE id = ?', [authUserId])[0];
            if (!user) { sendJSON(res, 401, { ok: false, error: 'unauthorized' }); return; }
            sendJSON(res, 200, { ok: true, user: user.username, data: getState(authUserId) });
            return;
        }
        if (req.method === 'PUT' && u === '/api/state') {
            if (!authUserId) { sendJSON(res, 401, { ok: false, error: 'unauthorized' }); return; }
            readBody(req, res, function (b) {
                try {
                    saveState(authUserId, b.data || {});
                    sendJSON(res, 200, { ok: true });
                } catch (e) {
                    sendJSON(res, 500, { ok: false, error: 'save_failed', message: String(e.message || e) });
                }
            });
            return;
        }
        serveStatic(req, res);
    }).listen(PORT, function () {
        console.log('Taskly running at http://localhost:' + PORT);
        console.log(API_KEY ? 'Gemini API: key loaded' : 'Gemini API: WARNING - add GEMINI_API_KEY to .env');
    });
}
