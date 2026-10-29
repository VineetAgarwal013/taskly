/* Robustness evals that the accuracy benchmark doesn't cover:
   1. Fuzz: thousands of odd inputs through parser / bucketing / search —
      no crashes, and every output is well-formed.
   2. Impossible dates ("2/30") must not turn into a different real date.
   3. Search noise: how many tasks very short queries match.
   4. Save at scale: PUT /api/state time and payload size for big boards.
   5. Concurrent saves: two sessions of one account editing at once.

   node bench/robustness.js */
process.env.TZ = 'America/Chicago';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const B = require('../js/algos.js');
const F = require('./fixtures.js');

const out = [];
function report(name, verdict, detail) { out.push([verdict, name, detail]); }

/* ==================== 1. Fuzz ==================== */

function fuzz() {
    let seed = 42;
    const rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    const parts = ['buy', 'milk', 'at', '5', 'pm', 'tomorrow', 'by', 'friday', '13/45', '2/30', '0/0', '99:99',
        'urgent', 'high', 'priority', 'in', '999', 'days', 'noon', '🎉', 'ñandú', '""', '\\', '{}', '<script>',
        'may', '31', 'february', '0', '-', '/', ':', '.', '!!!', 'next', 'week', 'a.m.', '12', 'am', '\n', '\t'];
    const cats = F.BUCKET_CASES[0].categories;
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    const REM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/;
    let crashes = 0, malformed = 0;
    const examples = [];
    const N = 5000;
    for (let i = 0; i < N; i++) {
        const len = 1 + Math.floor(rnd() * 8);
        const words = [];
        for (let j = 0; j < len; j++) words.push(pick(parts));
        const text = i % 50 === 0 ? 'x'.repeat(10000) : words.join(' ');
        try {
            const p = B.parseSpeech(text, F.NOW);
            const bad = (p.dueDate !== null && !DATE.test(p.dueDate)) ||
                (p.reminderISO !== null && !REM.test(p.reminderISO)) ||
                ['high', 'med', 'low'].indexOf(p.priority) === -1 ||
                (p.reminderISO && +p.reminderISO.slice(11, 13) > 23) ||
                typeof p.title !== 'string';
            const c = B.classifyLocal(text, cats, []);
            const s = B.compileSearch(text)({ title: text, description: '', category: '', tip: '' });
            if (bad || cats.indexOf(c) === -1 || s !== true) {
                malformed++;
                if (examples.length < 3) examples.push(JSON.stringify(text.slice(0, 40)) + ' → ' + JSON.stringify(p));
            }
        } catch (e) {
            crashes++;
            if (examples.length < 3) examples.push(JSON.stringify(text.slice(0, 40)) + ' threw ' + e.message);
        }
    }
    report('Fuzz: ' + N + ' random/odd inputs through parser, bucketing, search',
        crashes || malformed ? 'FAIL' : 'PASS',
        crashes + ' crashes, ' + malformed + ' malformed outputs' + (examples.length ? '\n      e.g. ' + examples.join('\n      e.g. ') : ''));
}

/* ==================== 2. Impossible dates ==================== */

function impossibleDates() {
    const cases = ['pay rent 2/30', 'dentist 4/31', 'party june 31', 'renew lease feb 30', 'call 6/31 at 5pm'];
    const wrong = [];
    cases.forEach(function (t) {
        const p = B.parseSpeech(t, F.NOW);
        if (p.dueDate) wrong.push('"' + t + '" → ' + p.dueDate);
    });
    report('Impossible calendar dates are rejected, not rolled into the next month',
        wrong.length ? 'FAIL' : 'PASS', wrong.length ? wrong.join('; ') : cases.length + '/' + cases.length + ' left without a date');
}

/* ==================== 3. Search noise ==================== */

function searchNoise() {
    const tasks = F.SEARCH_TASKS;
    const rows = ['a', 'e', 'th', 'ca', 'pa'].map(function (q) {
        const n = tasks.filter(B.compileSearch(q)).length;
        return '"' + q + '" ' + n + '/' + tasks.length;
    });
    report('Search noise: tasks matched by 1–2 letter queries (lower is better)', 'INFO', rows.join(', '));
}

/* ==================== 4 & 5. Server: scale and concurrency ==================== */

function freePort() {
    return new Promise(function (resolve) {
        const s = net.createServer().listen(0, function () { const p = s.address().port; s.close(function () { resolve(p); }); });
    });
}

function req(port, method, url, body, token) {
    return new Promise(function (resolve, reject) {
        const payload = body === undefined ? null : JSON.stringify(body);
        const headers = {};
        if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
        if (token) headers.Authorization = 'Bearer ' + token;
        const t0 = process.hrtime.bigint();
        const r = http.request({ host: '127.0.0.1', port: port, method: method, path: url, headers: headers }, function (res) {
            let t = '';
            res.on('data', function (c) { t += c; });
            res.on('end', function () {
                let j = null; try { j = JSON.parse(t); } catch (e) { }
                resolve({ status: res.statusCode, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6, bytes: payload ? Buffer.byteLength(payload) : 0 });
            });
        });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}

function board(n, prefix) {
    const tasks = [];
    for (let i = 0; i < n; i++) {
        tasks.push({ id: prefix + i, title: 'Task ' + i + ' finish the reading for class', description: 'Some notes about task ' + i,
            category: ['Items to Buy', 'Chores / Job Hunt', 'Homework'][i % 3], priority: 'med', dueDate: '2026-03-0' + (1 + i % 9),
            createdAt: '2026-03-01T10:00:00Z', completed: false, archived: false });
    }
    return { categories: ['Items to Buy', 'Chores / Job Hunt', 'Homework'], tasks: tasks, settings: {} };
}

async function server() {
    const DB = path.join(os.tmpdir(), 'taskly-robust-' + process.pid + '.db');
    const port = await freePort();
    const child = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: Object.assign({}, process.env, { PORT: String(port), TASKLY_DB: DB, GEMINI_API_KEY: '' }),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise(function (resolve) {
        let log = '';
        child.stdout.on('data', function (c) { log += c; if (/running at/.test(log)) resolve(); });
    });
    try {
        const reg = await req(port, 'POST', '/api/auth/register', { username: 'robust', password: 'secret1' });
        const tokenA = reg.json.token;

        /* 4. Scale */
        const rows = [];
        let slowest = 0;
        for (const n of [100, 1000, 5000]) {
            const r = await req(port, 'PUT', '/api/state', { data: board(n, 'n' + n + '-') }, tokenA);
            const g = await req(port, 'GET', '/api/state', undefined, tokenA);
            const ok = r.status === 200 && g.json.data.tasks.length === n;
            slowest = Math.max(slowest, r.ms);
            rows.push(n + ' tasks: save ' + r.ms.toFixed(0) + ' ms, load ' + g.ms.toFixed(0) + ' ms, ' + (r.bytes / 1024).toFixed(0) + ' KB per save' + (ok ? '' : ' (DATA MISMATCH)'));
        }
        report('Save/load at scale (every edit re-sends the whole board)', slowest > 1000 ? 'WARN' : 'PASS', rows.join('\n      '));

        /* 5. Concurrency: laptop and phone both open, each adds one task. */
        const login = await req(port, 'POST', '/api/auth/login', { username: 'robust', password: 'secret1' });
        const tokenB = login.json.token;
        const base = board(3, 'base-');
        await req(port, 'PUT', '/api/state', { data: base }, tokenA);
        const laptop = JSON.parse(JSON.stringify(base));
        const phone = JSON.parse(JSON.stringify(base));
        laptop.tasks.push({ id: 'from-laptop', title: 'Added on laptop', category: 'Homework', priority: 'med' });
        phone.tasks.push({ id: 'from-phone', title: 'Added on phone', category: 'Homework', priority: 'med' });
        await req(port, 'PUT', '/api/state', { data: laptop }, tokenA);
        await req(port, 'PUT', '/api/state', { data: phone }, tokenB);
        const after = await req(port, 'GET', '/api/state', undefined, tokenA);
        const ids = after.json.data.tasks.map(function (t) { return t.id; });
        const lost = ['from-laptop', 'from-phone'].filter(function (id) { return ids.indexOf(id) === -1; });
        report('Two devices editing at once keep both changes', lost.length ? 'FAIL' : 'PASS',
            lost.length ? 'lost: ' + lost.join(', ') + ' (last save overwrites the whole board)' : 'both tasks kept');
    } finally {
        child.kill('SIGTERM');
        await new Promise(function (r) { child.on('exit', r); });
        try { fs.unlinkSync(DB); } catch (e) { }
    }
}

(async function main() {
    fuzz();
    impossibleDates();
    searchNoise();
    await server();
    out.forEach(function (r) { console.log(r[0].padEnd(5) + ' ' + r[1] + '\n      ' + r[2]); });
    process.exitCode = out.some(function (r) { return r[0] === 'FAIL'; }) ? 1 : 0;
})();
