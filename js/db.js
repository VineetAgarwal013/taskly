/* ==========================================================================
   Taskly AI — Data Layer (dual mode)
   --------------------------------------------------------------------------
   REMOTE MODE (default): all data lives in the server-side SQLite database
   (taskly.db), accessed through /api/*. The browser only keeps the session
   token. Login/register send a one-time legacy snapshot for migration.

   LOCAL MODE (fallback): when no /api/* is reachable (e.g. the static
   deployment on Vercel without a backend), everything persists in
   localStorage — user-namespaced keys, hashed passwords, per-user settings.

   The mode is auto-detected once per page load.
   ========================================================================== */
window.TasklyDB = (function () {
    const TOKEN_KEY = 'taskly_session_token';
    const SESSION_KEY = 'taskly_current_user';
    const USERS_KEY = 'taskly_users_v1';
    const DATA_KEY = function (user) { return 'taskly_data_' + user; };
    const SETTINGS_KEY = function (user) { return 'taskly_settings_' + user; };
    const VINEET_USERNAME = 'Vineet';
    const VINEET_PASSWORD = 'Vineet';

    const MODE_REMOTE = 'remote';
    const MODE_LOCAL = 'local';
    let mode = null;
    let modePromise = null;

    /* ==================== Mode detection ==================== */

    function detectMode() {
        if (mode) return Promise.resolve(mode);
        if (!modePromise) {
            modePromise = fetch('/api/bootstrap', { method: 'GET' }).then(function (res) {
                return res.json().then(function (json) {
                    if (!res.ok || !json.ok) throw new Error('api down');
                });
            }).then(function () {
                mode = MODE_REMOTE;
            }).catch(function () {
                mode = MODE_LOCAL;
            });
        }
        return modePromise.then(function () { return mode; });
    }

    /* ==================== Remote (SQLite via server API) ==================== */

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function api(path, opts) {
        opts = opts || {};
        const headers = { 'Content-Type': 'application/json' };
        const token = getToken();
        if (token) headers['Authorization'] = 'Bearer ' + token;
        return fetch(path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
        }).then(function (res) {
            return res.text().then(function (text) {
                let json = {};
                try { json = JSON.parse(text); } catch (e) { }
                json._status = res.status;
                return json;
            });
        });
    }

    function storeRemoteSession(username, token) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(SESSION_KEY, username);
    }

    /* Legacy localStorage snapshot for the one-time SQLite migration. */
    function legacySnapshot(username) {
        const out = { settings: {} };
        let hasAnything = false;
        try {
            const raw = localStorage.getItem(DATA_KEY(username));
            const data = raw ? JSON.parse(raw) : null;
            if (data && Array.isArray(data.tasks)) {
                out.categories = Array.isArray(data.categories) ? data.categories : [];
                out.tasks = data.tasks;
                hasAnything = hasAnything || data.tasks.length > 0;
            }
        } catch (e) { }
        ['theme', 'sidebar_collapsed', 'shortcuts_seen'].forEach(function (k) {
            const v = localStorage.getItem(k);
            if (v !== null) {
                out.settings[k] = v;
                hasAnything = true;
            }
        });
        return hasAnything ? out : null;
    }

    function remoteBootstrap() {
        return api('/api/bootstrap');
    }

    function remoteLogin(username, password) {
        return api('/api/auth/login', {
            method: 'POST',
            body: { username: username, password: password, snapshot: legacySnapshot(username) }
        }).then(function (res) {
            if (res.ok) storeRemoteSession(res.user, res.token);
            return res;
        });
    }

    function remoteRegister(username, password) {
        return api('/api/auth/register', {
            method: 'POST',
            body: { username: username, password: password, snapshot: legacySnapshot(username) }
        }).then(function (res) {
            if (res.ok) storeRemoteSession(res.user, res.token);
            return res;
        });
    }

    function remoteLogout() {
        api('/api/auth/logout', { method: 'POST' });
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(SESSION_KEY);
    }

    function remoteRestoreSession() {
        if (!getToken()) return Promise.resolve(null);
        return api('/api/state').then(function (res) {
            if (!res.ok) {
                localStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem(SESSION_KEY);
                return null;
            }
            localStorage.setItem(SESSION_KEY, res.user);
            return { user: res.user, data: res.data };
        });
    }

    function remoteSaveState(payload) {
        return api('/api/state', { method: 'PUT', body: { data: payload } }).then(function (res) {
            if (!res.ok) throw new Error('Save failed (' + res._status + ')');
            return res;
        });
    }

    /* ==================== Local (localStorage fallback) ==================== */

    function getUsers() {
        try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
        catch (e) { return []; }
    }

    function saveUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function makeSalt() {
        return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }

    function hashPassword(password, salt) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        const s = salt + ':' + password;
        for (let i = 0; i < s.length; i++) {
            const ch = s.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
            h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
            h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        }
        return (h2 >>> 0).toString(16) + '-' + (h1 >>> 0).toString(16);
    }

    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function seedDataFor(username) {
        const created = new Date().toISOString();
        if (username === VINEET_USERNAME) {
            return {
                categories: ['Items to Buy', 'Chores / Job Hunt', 'Homework'],
                tasks: (window.SEED_TASKS || []).slice().map(function (t) {
                    return {
                        id: t.id, title: t.title, description: t.description || '',
                        category: t.category, priority: t.priority || 'med',
                        createdDate: todayStr(), createdAt: created,
                        dueDate: t.dueDate || null, reminder: null,
                        completed: false, completedAt: null, archived: false, tip: ''
                    };
                })
            };
        }
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
        return {
            categories: ['🎯 Getting Started', '💡 Pro Tips', '📁 Sample Project'],
            tasks: [
                mk('gs-1', 'Welcome to Taskly AI 👋', 'Check the box — it animates into the Archive', '🎯 Getting Started', 'high'),
                mk('gs-2', 'Add your first task', 'Type in the dock below and press Enter', '🎯 Getting Started', 'med'),
                mk('tp-1', 'Use priorities', '!!! High · !! Medium · ! Low', '💡 Pro Tips', 'med'),
                mk('tp-2', 'Set a deadline', 'Pick a date in the dock’s deadline menu', '💡 Pro Tips', 'low'),
                mk('sp-1', 'Plan your week', 'Drag cards between columns', '📁 Sample Project', 'low'),
                mk('sp-2', 'Organize with categories', 'Use “+ Add Category” in the sidebar', '📁 Sample Project', 'low')
            ]
        };
    }

    function ensureVineetAccount() {
        const users = getUsers();
        if (!users.some(function (u) { return u.username === VINEET_USERNAME; })) {
            const salt = makeSalt();
            users.push({ username: VINEET_USERNAME, salt: salt, hash: hashPassword(VINEET_PASSWORD, salt) });
            saveUsers(users);
        }
    }

    function loadLocalData(username) {
        try {
            const raw = localStorage.getItem(DATA_KEY(username));
            const data = raw ? JSON.parse(raw) : null;
            if (data && (!data.tasks || !data.categories)) return null;
            return data;
        } catch (e) { return null; }
    }

    function loadLocalSettings(username) {
        let settings = {};
        try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY(username))) || {}; }
        catch (e) { }
        if (settings.theme === undefined && localStorage.getItem('theme') !== null) settings.theme = localStorage.getItem('theme');
        if (settings.sidebar_collapsed === undefined && localStorage.getItem('sidebar_collapsed') !== null) settings.sidebar_collapsed = localStorage.getItem('sidebar_collapsed');
        if (settings.shortcuts_seen === undefined && localStorage.getItem('taskly_shortcuts_seen') !== null) settings.shortcuts_seen = localStorage.getItem('taskly_shortcuts_seen');
        return settings;
    }

    function localState(username) {
        const data = loadLocalData(username);
        if (!data) return null;
        return {
            categories: data.categories,
            tasks: data.tasks,
            settings: loadLocalSettings(username)
        };
    }

    function localBootstrap() {
        ensureVineetAccount();
        return Promise.resolve({ ok: true, hasUsers: getUsers().length > 0 });
    }

    function localLogin(username, password) {
        ensureVineetAccount();
        const user = getUsers().find(function (u) { return u.username === username; });
        if (!user) return Promise.resolve({ ok: false, error: 'User not found — create an account first' });
        if (hashPassword(password, user.salt) !== user.hash) {
            return Promise.resolve({ ok: false, error: 'Incorrect password' });
        }
        if (!loadLocalData(username)) {
            localStorage.setItem(DATA_KEY(username), JSON.stringify(seedDataFor(username)));
        }
        localStorage.setItem(SESSION_KEY, username);
        return Promise.resolve({ ok: true, user: username, data: localState(username) });
    }

    function localRegister(username, password) {
        const users = getUsers();
        if (users.some(function (u) { return u.username === username; })) {
            return Promise.resolve({ ok: false, error: 'That username is already taken' });
        }
        const salt = makeSalt();
        users.push({ username: username, salt: salt, hash: hashPassword(password, salt) });
        saveUsers(users);
        localStorage.setItem(DATA_KEY(username), JSON.stringify(seedDataFor(username)));
        localStorage.setItem(SESSION_KEY, username);
        return Promise.resolve({ ok: true, user: username, data: localState(username) });
    }

    function localLogout() {
        localStorage.removeItem(SESSION_KEY);
    }

    function localRestoreSession() {
        const username = localStorage.getItem(SESSION_KEY);
        if (!username) return Promise.resolve(null);
        ensureVineetAccount();
        const data = localState(username);
        if (!data) {
            localStorage.setItem(DATA_KEY(username), JSON.stringify(seedDataFor(username)));
            return Promise.resolve({ user: username, data: localState(username) });
        }
        return Promise.resolve({ user: username, data: data });
    }

    function localSaveState(payload) {
        const username = localStorage.getItem(SESSION_KEY);
        if (username) {
            localStorage.setItem(DATA_KEY(username), JSON.stringify({
                categories: payload.categories,
                tasks: payload.tasks
            }));
            localStorage.setItem(SETTINGS_KEY(username), JSON.stringify(payload.settings || {}));
            if (payload.settings && payload.settings.theme) localStorage.setItem('theme', payload.settings.theme);
            if (payload.settings && payload.settings.sidebar_collapsed !== undefined) localStorage.setItem('sidebar_collapsed', payload.settings.sidebar_collapsed ? '1' : '0');
            if (payload.settings && payload.settings.shortcuts_seen !== undefined) localStorage.setItem('taskly_shortcuts_seen', payload.settings.shortcuts_seen ? 'true' : 'false');
        }
        return Promise.resolve({ ok: true });
    }

    /* ==================== Public API (mode-aware) ==================== */

    function bootstrap() {
        return detectMode().then(function (m) {
            return m === MODE_REMOTE ? remoteBootstrap() : localBootstrap();
        });
    }

    function login(username, password) {
        return detectMode().then(function (m) {
            return m === MODE_REMOTE ? remoteLogin(username, password) : localLogin(username, password);
        });
    }

    function register(username, password) {
        return detectMode().then(function (m) {
            return m === MODE_REMOTE ? remoteRegister(username, password) : localRegister(username, password);
        });
    }

    function logout() {
        return detectMode().then(function (m) {
            if (m === MODE_REMOTE) remoteLogout();
            else localLogout();
        });
    }

    function restoreSession() {
        return detectMode().then(function (m) {
            return m === MODE_REMOTE ? remoteRestoreSession() : localRestoreSession();
        });
    }

    function saveState(payload) {
        return detectMode().then(function (m) {
            return m === MODE_REMOTE ? remoteSaveState(payload) : localSaveState(payload);
        });
    }

    function getSession() {
        return localStorage.getItem(SESSION_KEY) || null;
    }

    return {
        bootstrap: bootstrap,
        login: login,
        register: register,
        logout: logout,
        restoreSession: restoreSession,
        saveState: saveState,
        getSession: getSession
    };
})();