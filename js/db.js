/* ==========================================================================
   Taskly AI — Database Layer (localStorage, fully user-namespaced)
   --------------------------------------------------------------------------
   Every account's data lives under its own key: taskly_data_<username>.
   Sessions are tracked in taskly_current_user. The default "Vineet" account
   is seeded with the original personal database, and brand-new accounts get
   a lightweight onboarding template instead.
   ========================================================================== */
window.TasklyDB = (function () {
    const USERS_KEY = 'taskly_users_v1';
    const SESSION_KEY = 'taskly_current_user';
    const DATA_KEY = function (user) { return 'taskly_data_' + user; };

    /* Default profile shipped with the app (seeded with the original data). */
    const VINEET_USERNAME = 'Vineet';
    const VINEET_PASSWORD = 'Vineet';

    /* ==================== Account registry ==================== */

    function getUsers() {
        try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
        catch (e) { return []; }
    }

    function saveUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    /* Deterministic per-user salted hash (plaintext is never stored). */
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

    /* ==================== Data seeds ==================== */

    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    /* The original personal database (categories + tasks with priorities
       and deadlines preserved exactly as they were). */
    function seedVineetData() {
        return {
            categories: ['Items to Buy', 'Chores / Job Hunt', 'Homework'],
            tasks: (window.SEED_TASKS || []).slice().map(function (t) {
                return {
                    id: t.id,
                    title: t.title,
                    description: t.description || '',
                    category: t.category,
                    priority: t.priority || 'med',
                    createdDate: todayStr(),
                    createdAt: new Date().toISOString(),
                    dueDate: t.dueDate || null,
                    reminder: null,
                    completed: false,
                    completedAt: null,
                    archived: false,
                    tip: ''
                };
            })
        };
    }

    /* Lightweight first-run template for brand-new accounts: minimal dummy
       categories + sample tasks that guide basic app usage. */
    function seedOnboardingData() {
        const created = new Date().toISOString();
        const stamp = Date.now();
        const mk = function (id, title, tip, category, priority) {
            return {
                id: id + '-' + stamp,
                title: title,
                description: '',
                category: category,
                priority: priority,
                createdDate: todayStr(),
                createdAt: created,
                dueDate: null,
                reminder: null,
                completed: false,
                completedAt: null,
                archived: false,
                tip: tip
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

    /* Creates the account row (registry only, no data) for a username. */
    function createAccount(username, password) {
        const salt = makeSalt();
        const users = getUsers();
        users.push({ username: username, salt: salt, hash: hashPassword(password, salt) });
        saveUsers(users);
    }

    /* ==================== Public API ==================== */

    /* Seeds the built-in "Vineet" account with the original database the
       first time the app runs. Safe to call repeatedly — it no-ops once the
       account (and its namespaced data) already exist. */
    function ensureDefaultUser() {
        const users = getUsers();
        const exists = users.some(function (u) { return u.username === VINEET_USERNAME; });
        if (!exists) {
            createAccount(VINEET_USERNAME, VINEET_PASSWORD);
        }
        if (!loadData(VINEET_USERNAME)) {
            saveData(VINEET_USERNAME, seedVineetData());
        }
    }

    /* Guarantees a username has usable data: seeds the onboarding template
       for brand-new (or data-less) accounts. Returns the data object. */
    function ensureData(username) {
        const existing = loadData(username);
        if (existing) return existing;
        const data = seedOnboardingData();
        saveData(username, data);
        return data;
    }

    /* Creates a new account + its isolated, onboarding-seeded namespace. */
    function register(username, password) {
        const users = getUsers();
        if (users.some(function (u) { return u.username === username; })) {
            return { ok: false, error: 'That username is already taken' };
        }
        createAccount(username, password);
        ensureData(username);
        return { ok: true };
    }

    /* Authenticates and opens the user's own namespaced database. */
    function login(username, password) {
        ensureDefaultUser();
        const users = getUsers();
        const user = users.find(function (u) { return u.username === username; });
        if (!user) return { ok: false, error: 'User not found — create an account first' };
        if (hashPassword(password, user.salt) !== user.hash) {
            return { ok: false, error: 'Incorrect password' };
        }
        ensureData(username);
        localStorage.setItem(SESSION_KEY, username);
        return { ok: true, user: username };
    }

    /* Clears the active session; the user's namespaced data is untouched. */
    function logout() {
        localStorage.removeItem(SESSION_KEY);
    }

    /* Active session username (null when signed out). */
    function getSession() {
        return localStorage.getItem(SESSION_KEY) || null;
    }

    function hasUsers() {
        return getUsers().length > 0;
    }

    /* Reads the user's private database — never another user's. */
    function loadData(username) {
        try {
            const raw = localStorage.getItem(DATA_KEY(username));
            const data = raw ? JSON.parse(raw) : null;
            if (data && (!data.tasks || !data.categories)) return null;
            return data;
        } catch (e) { return null; }
    }

    /* Writes back to the user's private namespace only. */
    function saveData(username, data) {
        localStorage.setItem(DATA_KEY(username), JSON.stringify(data));
    }

    return {
        register: register,
        login: login,
        logout: logout,
        getSession: getSession,
        hasUsers: hasUsers,
        ensureDefaultUser: ensureDefaultUser,
        ensureData: ensureData,
        loadData: loadData,
        saveData: saveData
    };
})();