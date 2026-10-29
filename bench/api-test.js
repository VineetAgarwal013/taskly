/* End-to-end API check: boots server.js on a spare port against a scratch
   SQLite file (never the real taskly.db), exercises every endpoint, then
   calls the Vercel function api/classify.js with a fake req/res.

   node bench/api-test.js */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..');
const DB = path.join(os.tmpdir(), 'taskly-api-test-' + process.pid + '.db');

function freePort() {
    return new Promise(function (resolve) {
        const s = net.createServer().listen(0, function () {
            const p = s.address().port;
            s.close(function () { resolve(p); });
        });
    });
}

function request(port, method, url, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
        const headers = {};
        let payload = null;
        if (opts.raw !== undefined) payload = opts.raw;
        else if (opts.body !== undefined) payload = JSON.stringify(opts.body);
        if (payload !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
        if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
        const req = http.request({ host: '127.0.0.1', port: port, method: method, path: url, headers: headers }, function (res) {
            let text = '';
            res.on('data', function (c) { text += c; });
            res.on('end', function () {
                let json = null;
                try { json = JSON.parse(text); } catch (e) { }
                resolve({ status: res.statusCode, json: json, text: text });
            });
        });
        req.on('error', function (e) {
            /* The server may drop the socket mid-upload after answering 413. */
            if (opts.allowReset) resolve({ status: 'reset' }); else reject(e);
        });
        if (payload !== null) req.write(payload);
        req.end();
    });
}

const results = [];
async function check(name, fn) {
    try { await fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name + ' — ' + e.message]); }
}

async function main() {
    const port = await freePort();
    const server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: Object.assign({}, process.env, { PORT: String(port), TASKLY_DB: DB }),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    server.stdout.on('data', function (c) { log += c; });
    server.stderr.on('data', function (c) { log += c; });
    await new Promise(function (resolve, reject) {
        const t = setTimeout(function () { reject(new Error('server did not start:\n' + log)); }, 10000);
        /* Wait for the last startup line, which says whether the Gemini key loaded. */
        server.stdout.on('data', function () { if (/Gemini API:/.test(log)) { clearTimeout(t); resolve(); } });
    });
    const hasKey = /key loaded/.test(log);
    const R = function (m, u, o) { return request(port, m, u, o); };
    const user = 'apitest' + Date.now().toString(36);
    let token = null;

    await check('GET /api/bootstrap → ok, Vineet account exists', async function () {
        const r = await R('GET', '/api/bootstrap');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.json.ok, true);
        assert.strictEqual(r.json.hasUsers, true);
    });
    await check('register rejects a bad username (400)', async function () {
        const r = await R('POST', '/api/auth/register', { body: { username: 'x', password: 'secret' } });
        assert.strictEqual(r.status, 400);
    });
    await check('register rejects a short password (400)', async function () {
        const r = await R('POST', '/api/auth/register', { body: { username: user, password: 'abc' } });
        assert.strictEqual(r.status, 400);
    });
    await check('register creates account with the three empty starter lists (201)', async function () {
        const r = await R('POST', '/api/auth/register', { body: { username: user, password: 'secret1' } });
        assert.strictEqual(r.status, 201);
        assert.ok(r.json.token);
        assert.deepStrictEqual(r.json.data.categories, ['Jobs', 'Personal Tasks', 'Homework']);
        assert.strictEqual(r.json.data.tasks.length, 0);
    });
    await check('register rejects a duplicate username (409)', async function () {
        const r = await R('POST', '/api/auth/register', { body: { username: user, password: 'secret1' } });
        assert.strictEqual(r.status, 409);
    });
    await check('login rejects a wrong password (401)', async function () {
        const r = await R('POST', '/api/auth/login', { body: { username: user, password: 'nope123' } });
        assert.strictEqual(r.status, 401);
    });
    await check('login rejects an unknown user (401)', async function () {
        const r = await R('POST', '/api/auth/login', { body: { username: 'nobody-' + user, password: 'x' } });
        assert.strictEqual(r.status, 401);
    });
    await check('login succeeds and returns a token', async function () {
        const r = await R('POST', '/api/auth/login', { body: { username: user, password: 'secret1' } });
        assert.strictEqual(r.status, 200);
        token = r.json.token;
        assert.ok(token);
    });
    await check('GET /api/state without a token → 401', async function () {
        const r = await R('GET', '/api/state');
        assert.strictEqual(r.status, 401);
    });
    await check('PUT then GET /api/state round-trips tasks, categories, settings', async function () {
        const data = {
            categories: ['Groceries', 'Work'],
            tasks: [{ id: 't1', title: 'Buy milk', category: 'Groceries', priority: 'high', dueDate: '2026-03-05', completed: false, archived: false, createdAt: '2026-03-04T10:00:00Z' }],
            settings: { theme: 'light', catSort: { Work: 'priority' } }
        };
        const put = await R('PUT', '/api/state', { token: token, body: { data: data } });
        assert.strictEqual(put.status, 200);
        const get = await R('GET', '/api/state', { token: token });
        assert.strictEqual(get.status, 200);
        assert.deepStrictEqual(get.json.data.categories, data.categories);
        assert.strictEqual(get.json.data.tasks.length, 1);
        assert.strictEqual(get.json.data.tasks[0].title, 'Buy milk');
        assert.strictEqual(get.json.data.tasks[0].priority, 'high');
        assert.strictEqual(get.json.data.settings.theme, 'light');
        assert.deepStrictEqual(get.json.data.settings.catSort, { Work: 'priority' });
    });
    await check('oversized body → a single 413 and the server stays up', async function () {
        const r = await R('PUT', '/api/state', { token: token, raw: 'x'.repeat(6 * 1024 * 1024), allowReset: true });
        assert.ok(r.status === 413 || r.status === 'reset', 'got ' + r.status);
        const after = await R('GET', '/api/bootstrap');
        assert.strictEqual(after.status, 200);
        assert.ok(!/ERR_HTTP_HEADERS_SENT|Cannot set headers/.test(log), 'double response logged');
    });
    await check('POST /api/classify rejects too-short text (400)', async function () {
        const r = await R('POST', '/api/classify', { body: { text: 'hi' } });
        if (!hasKey) { assert.strictEqual(r.json.error, 'missing_key'); return; }
        assert.strictEqual(r.status, 400);
    });
    await check('POST /api/classify with a real task (live Gemini call)', async function () {
        if (!hasKey) throw new Error('skipped: no GEMINI_API_KEY in .env');
        const r = await R('POST', '/api/classify', { body: { text: 'finish calculus problem set by friday', categories: ['Items to Buy', 'Chores / Job Hunt', 'Homework'] } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.json.ok, true, JSON.stringify(r.json).slice(0, 300));
        assert.strictEqual(r.json.result.category, 'Homework');
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.json.result.dueDate), 'dueDate ' + r.json.result.dueDate);
    });
    await check('POST /api/classify list mode rejects an empty list (400)', async function () {
        const r = await R('POST', '/api/classify', { body: { items: [] } });
        if (!hasKey) { assert.strictEqual(r.json.error, 'missing_key'); return; }
        assert.strictEqual(r.status, 400);
    });
    await check('POST /api/classify list mode: one call returns one result per item (live Gemini)', async function () {
        if (!hasKey) throw new Error('skipped: no GEMINI_API_KEY in .env');
        const items = ['buy printer ink', 'study for midterm friday', 'tomorrow: call mom at 5'];
        const r = await R('POST', '/api/classify', { body: { items: items, categories: ['Items to Buy', 'Chores / Job Hunt', 'Homework'] } });
        assert.strictEqual(r.json.ok, true, JSON.stringify(r.json).slice(0, 300));
        assert.strictEqual(r.json.results.length, 3);
        assert.strictEqual(r.json.results[1].category, 'Homework');
    });
    await check('logout invalidates the token', async function () {
        const out = await R('POST', '/api/auth/logout', { token: token });
        assert.strictEqual(out.status, 200);
        const r = await R('GET', '/api/state', { token: token });
        assert.strictEqual(r.status, 401);
    });
    await check('static: index.html and js are served', async function () {
        assert.strictEqual((await R('GET', '/')).status, 200);
        assert.strictEqual((await R('GET', '/js/algos.js')).status, 200);
    });
    await check('static: .env, taskly.db, server code and path traversal are blocked', async function () {
        assert.notStrictEqual((await R('GET', '/.env')).status, 200);
        assert.notStrictEqual((await R('GET', '/taskly.db')).status, 200);
        assert.notStrictEqual((await R('GET', '/server.js')).status, 200);
        assert.notStrictEqual((await R('GET', '/bench/api-test.js')).status, 200);
        assert.notStrictEqual((await R('GET', '/node_modules/sql.js/package.json')).status, 200);
        assert.notStrictEqual((await R('GET', '/../../etc/passwd')).status, 200);
        assert.notStrictEqual((await R('GET', '/%2e%2e/%2e%2e/etc/passwd')).status, 200);
    });

    server.kill('SIGTERM');
    await new Promise(function (r) { server.on('exit', r); });

    await check('server wrote only to the scratch DB', function () {
        assert.ok(fs.existsSync(DB));
    });

    /* Vercel function with a minimal req/res stand-in. */
    function vercelCall(method, body, env) {
        const saved = process.env.GEMINI_API_KEY;
        if (env && 'GEMINI_API_KEY' in env) {
            if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY; else delete process.env.GEMINI_API_KEY;
        }
        return new Promise(function (resolve) {
            const req = new EventEmitter();
            req.method = method;
            req.destroy = function () { };
            const res = {
                code: 0,
                status: function (c) { this.code = c; return this; },
                json: function (o) { resolve({ status: this.code, json: o }); }
            };
            delete require.cache[require.resolve('../api/classify.js')];
            require('../api/classify.js')(req, res);
            process.nextTick(function () {
                if (body !== undefined) req.emit('data', JSON.stringify(body));
                req.emit('end');
            });
        }).then(function (r) {
            if (saved === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved;
            return r;
        });
    }
    await check('Vercel api/classify.js: GET → 405', async function () {
        const r = await vercelCall('GET');
        assert.strictEqual(r.status, 405);
    });
    await check('Vercel api/classify.js: no key → missing_key', async function () {
        const r = await vercelCall('POST', { text: 'buy milk' }, { GEMINI_API_KEY: '' });
        assert.strictEqual(r.json.error, 'missing_key');
    });
    await check('Vercel api/classify.js: live classify', async function () {
        const key = (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*(.*)$/m) || [])[1];
        if (!key) throw new Error('skipped: no GEMINI_API_KEY in .env');
        const r = await vercelCall('POST', { text: 'buy airpods', categories: ['Items to Buy', 'Chores / Job Hunt', 'Homework'] },
            { GEMINI_API_KEY: key.replace(/^["']|["']$/g, '').trim() });
        assert.strictEqual(r.json.ok, true, JSON.stringify(r.json).slice(0, 300));
        assert.strictEqual(r.json.result.category, 'Items to Buy');
    });

    try { fs.unlinkSync(DB); } catch (e) { }

    results.forEach(function (r) { console.log(r[0] + '  ' + r[1]); });
    const failed = results.filter(function (r) { return r[0] === 'FAIL'; }).length;
    console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
    process.exitCode = failed ? 1 : 0;
}

main().catch(function (e) {
    try { fs.unlinkSync(DB); } catch (x) { }
    console.error(e);
    process.exit(1);
});
