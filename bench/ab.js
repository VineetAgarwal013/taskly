/* A/B benchmark: original algorithms (bench/baseline.js) vs current ones
   (js/algos.js, api/_gemini.js) on the labeled data in bench/fixtures.js.

   node bench/ab.js            search, bucketing, voice (offline)
   node bench/ab.js --gemini   also compares Gemini prompt A vs B (real API calls)
   node bench/ab.js --holdout  use bench/holdout.js, written independently of B */
process.env.TZ = 'America/Chicago';

const fs = require('fs');
const path = require('path');
const A = require('./baseline.js');
const B = require('../js/algos.js');
const HOLDOUT = process.argv.indexOf('--holdout') !== -1;
const F = require(HOLDOUT ? './holdout.js' : './fixtures.js');

const RealDate = Date;

/* Runs fn with the global clock frozen at iso (version A reads the real clock). */
function atTime(iso, fn) {
    const fixed = new RealDate(iso).getTime();
    function FakeDate() {
        if (!(this instanceof FakeDate)) return new RealDate(fixed).toString();
        const args = Array.prototype.slice.call(arguments);
        return args.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(args)))() : new RealDate(fixed);
    }
    FakeDate.now = function () { return fixed; };
    FakeDate.UTC = RealDate.UTC;
    FakeDate.parse = RealDate.parse;
    FakeDate.prototype = RealDate.prototype;
    global.Date = FakeDate;
    try { return fn(); } finally { global.Date = RealDate; }
}

function pct(n, d) { return d ? (100 * n / d).toFixed(1) + '%' : 'n/a'; }

function table(title, rows) {
    console.log('\n' + title);
    const widths = rows[0].map(function (_, i) {
        return Math.max.apply(null, rows.map(function (r) { return String(r[i]).length; }));
    });
    rows.forEach(function (r, ri) {
        console.log('  ' + r.map(function (c, i) { return String(c).padEnd(widths[i]); }).join('   '));
        if (ri === 0) console.log('  ' + widths.map(function (w) { return '-'.repeat(w); }).join('   '));
    });
}

const verbose = process.argv.indexOf('-v') !== -1;
const summary = {};

/* ==================== Search ==================== */

function runSearch() {
    function score(matchFn) {
        let tp = 0, fp = 0, fn = 0, exact = 0;
        const misses = [];
        F.SEARCH_CASES.forEach(function (c) {
            const got = F.SEARCH_TASKS.filter(function (t) { return matchFn(t, c.query); }).map(function (t) { return t.id; });
            const exp = new Set(c.expected);
            const g = new Set(got);
            got.forEach(function (id) { if (exp.has(id)) tp++; else fp++; });
            c.expected.forEach(function (id) { if (!g.has(id)) fn++; });
            if (got.length === exp.size && got.every(function (id) { return exp.has(id); })) exact++;
            else misses.push(c.query + ' → got [' + got.join(',') + '] want [' + c.expected.join(',') + ']');
        });
        return { precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1), exact: exact, misses: misses };
    }
    const sa = score(function (t, q) { return A.matchesSearch(t, q.trim()); });
    const sb = score(function (t, q) { return B.compileSearch(q)(t); });

    /* Speed: 5,000 synthetic tasks, one full board filter per query
       (what a render does). */
    const big = [];
    for (let i = 0; i < 5000; i++) {
        const base = F.SEARCH_TASKS[i % F.SEARCH_TASKS.length];
        big.push({ id: 'x' + i, title: base.title + ' ' + i, description: base.description, category: base.category, tip: '' });
    }
    function speed(makeFilter) {
        const reps = 20;
        const t0 = process.hrtime.bigint();
        for (let r = 0; r < reps; r++) {
            F.SEARCH_CASES.forEach(function (c) { big.filter(makeFilter(c.query)); });
        }
        return Number(process.hrtime.bigint() - t0) / 1e6 / (reps * F.SEARCH_CASES.length);
    }
    const msA = speed(function (q) { return function (t) { return A.matchesSearch(t, q); }; });
    const msB = speed(function (q) { return B.compileSearch(q); });

    table('SEARCH (' + F.SEARCH_CASES.length + ' labeled queries, 5,000-task speed test)', [
        ['', 'A (original)', 'B (new)'],
        ['exact result sets', sa.exact + '/' + F.SEARCH_CASES.length, sb.exact + '/' + F.SEARCH_CASES.length],
        ['precision', pct(sa.precision, 1), pct(sb.precision, 1)],
        ['recall', pct(sa.recall, 1), pct(sb.recall, 1)],
        ['ms per query (5k tasks)', msA.toFixed(2), msB.toFixed(2)]
    ]);
    if (verbose) {
        console.log('  A misses:\n    ' + sa.misses.join('\n    '));
        console.log('  B misses:\n    ' + (sb.misses.join('\n    ') || '(none)'));
    }
    summary.search = { A: sa, B: sb, msA: msA, msB: msB };
}

/* ==================== Bucketing (offline keyword fallback) ==================== */

function runBucketing() {
    function score(fn) {
        const bySet = {};
        const misses = [];
        let ok = 0;
        F.BUCKET_CASES.forEach(function (c) {
            const got = fn(c);
            bySet[c.set] = bySet[c.set] || { ok: 0, n: 0 };
            bySet[c.set].n++;
            if (got === c.expected) { ok++; bySet[c.set].ok++; }
            else misses.push('"' + c.text + '" → ' + got + ' (want ' + c.expected + ')');
        });
        return { ok: ok, bySet: bySet, misses: misses };
    }
    const ba = score(function (c) { return A.classifyTask(c.text, c.categories); });
    const bb = score(function (c) { return B.classifyLocal(c.text, c.categories, c.existing); });
    const n = F.BUCKET_CASES.length;
    table('BUCKETING, offline fallback (' + n + ' labeled tasks)', [
        ['', 'A (original)', 'B (new)'],
        ['overall accuracy', ba.ok + '/' + n + ' ' + pct(ba.ok, n), bb.ok + '/' + n + ' ' + pct(bb.ok, n)],
        ['default categories', ba.bySet.default.ok + '/' + ba.bySet.default.n, bb.bySet.default.ok + '/' + bb.bySet.default.n],
        ['custom categories', ba.bySet.custom.ok + '/' + ba.bySet.custom.n, bb.bySet.custom.ok + '/' + bb.bySet.custom.n]
    ]);
    if (verbose) {
        console.log('  A misses:\n    ' + ba.misses.join('\n    '));
        console.log('  B misses:\n    ' + (bb.misses.join('\n    ') || '(none)'));
    }
    summary.bucket = { A: ba, B: bb };
}

/* ==================== Voice parser ==================== */

function runVoice() {
    const FIELDS = ['title', 'priority', 'dueDate', 'reminderISO'];
    function score(fn) {
        const fieldOk = { title: 0, priority: 0, dueDate: 0, reminderISO: 0 };
        let allOk = 0;
        const misses = [];
        F.VOICE_CASES.forEach(function (c) {
            const got = atTime(c.now, function () { return fn(c); });
            let all = true;
            FIELDS.forEach(function (f) {
                const g = f === 'title' ? String(got.title).toLowerCase() : got[f];
                const e = f === 'title' ? c.expected.title.toLowerCase() : c.expected[f];
                if (g === e) fieldOk[f]++;
                else { all = false; misses.push('"' + c.text + '" ' + f + ': got ' + JSON.stringify(got[f]) + ' want ' + JSON.stringify(c.expected[f])); }
            });
            if (all) allOk++;
        });
        return { fieldOk: fieldOk, allOk: allOk, misses: misses };
    }
    const va = score(function (c) { return A.parseSpeech(c.text); });
    const vb = score(function (c) { return B.parseSpeech(c.text, c.now); });
    const n = F.VOICE_CASES.length;
    const rows = [['', 'A (original)', 'B (new)'],
        ['fully correct sentences', va.allOk + '/' + n, vb.allOk + '/' + n]];
    FIELDS.forEach(function (f) { rows.push([f, va.fieldOk[f] + '/' + n, vb.fieldOk[f] + '/' + n]); });
    table('VOICE / QUICK-ADD PARSER (' + n + ' labeled sentences)', rows);
    if (verbose) {
        console.log('  A misses:\n    ' + va.misses.join('\n    '));
        console.log('  B misses:\n    ' + (vb.misses.join('\n    ') || '(none)'));
    }
    summary.voice = { A: va, B: vb };
}

/* ==================== Gemini prompt A vs B ==================== */

function loadEnvKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
    try {
        const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*(.*)$/m);
        return m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
    } catch (e) { return ''; }
}

async function runGemini() {
    const G = require('../api/_gemini.js');
    const apiKey = loadEnvKey();
    if (!apiKey) { console.log('\nGEMINI: skipped (no GEMINI_API_KEY)'); return; }
    const paceArg = process.argv.find(function (a) { return a.indexOf('--pace=') === 0; });
    const pace = paceArg ? +paceArg.slice(7) : 6500;
    const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    /* One call at a time, spaced out for the free tier's per-minute limit;
       a 429/503 waits 30 s and retries (up to 3 times). */
    async function call(text, categories, variant, now) {
        for (let attempt = 0; ; attempt++) {
            await wait(pace);
            const t0 = Date.now();
            try {
                const r = await G.classify(text, categories, { apiKey: apiKey, variant: variant, now: now });
                return { r: r, ms: Date.now() - t0 };
            } catch (e) {
                if (attempt < 3 && /HTTP (429|503)/.test(e.message)) { await wait(30000); continue; }
                throw e;
            }
        }
    }
    function quant(lat, p) { return lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : NaN; }

    async function runVariant(variant) {
        const lat = [];
        let ok = 0, raw = 0, failures = 0;
        const errors = [], misses = [];
        for (const c of F.BUCKET_CASES) {
            try {
                const x = await call(c.text, c.categories, variant);
                lat.push(x.ms);
                if (x.r.rawCategory === c.expected) raw++;
                if (x.r.category === c.expected) ok++;
                else misses.push('"' + c.text + '" → ' + x.r.rawCategory + ' (want ' + c.expected + ')');
            } catch (e) {
                failures++;
                if (errors.length < 3) errors.push(String(e.message).slice(0, 160));
            }
        }
        lat.sort(function (x, y) { return x - y; });
        return { ok: ok, raw: raw, failures: failures, errors: errors, misses: misses, p50: quant(lat, 0.5), p95: quant(lat, 0.95) };
    }

    const n = F.BUCKET_CASES.length;
    console.log('\nGEMINI: ' + (n * 2 + F.VOICE_CASES.length) + ' calls to ' + G.MODEL + ', one every ' + (pace / 1000) + ' s…');
    const ga = await runVariant('A');
    const gb = await runVariant('B');
    table('BUCKETING, Gemini prompt (' + n + ' labeled tasks, model ' + G.MODEL + ')', [
        ['', 'prompt A (original)', 'prompt B (new)'],
        ['category correct, as returned', ga.raw + '/' + n, gb.raw + '/' + n],
        ['after snapping to a real category', ga.ok + '/' + n, gb.ok + '/' + n],
        ['request/parse failures', ga.failures, gb.failures],
        ['latency p50 / p95 (ms)', ga.p50 + ' / ' + ga.p95, gb.p50 + ' / ' + gb.p95]
    ]);
    [['A', ga], ['B', gb]].forEach(function (p) {
        if (p[1].errors.length) console.log('  prompt ' + p[0] + ' errors: ' + p[1].errors.join(' | '));
        if (verbose) console.log('  prompt ' + p[0] + ' misses:\n    ' + (p[1].misses.join('\n    ') || '(none)'));
    });

    /* AI vs offline parser on the voice sentences (shipped prompt A). */
    const FIELDS = ['title', 'priority', 'dueDate', 'reminderISO'];
    const aiOk = { title: 0, priority: 0, dueDate: 0, reminderISO: 0 };
    let aiAll = 0, aiFail = 0;
    const aiMisses = [];
    for (const c of F.VOICE_CASES) {
        try {
            const x = await call(c.text, ['Items to Buy', 'Chores / Job Hunt', 'Homework'], 'A', new RealDate(c.now));
            const got = { title: String(x.r.title || '').toLowerCase(), priority: x.r.priority, dueDate: x.r.dueDate || null, reminderISO: x.r.reminder || null };
            let all = true;
            FIELDS.forEach(function (f) {
                const e = f === 'title' ? c.expected.title.toLowerCase() : c.expected[f];
                if (got[f] === e) aiOk[f]++;
                else { all = false; aiMisses.push('"' + c.text + '" ' + f + ': got ' + JSON.stringify(got[f]) + ' want ' + JSON.stringify(e)); }
            });
            if (all) aiAll++;
        } catch (e) { aiFail++; }
    }
    const vn = F.VOICE_CASES.length;
    const vb = summary.voice.B;
    const rows = [['', 'offline parser (B)', 'Gemini (prompt A)'], ['fully correct sentences', vb.allOk + '/' + vn, aiAll + '/' + vn]];
    FIELDS.forEach(function (f) { rows.push([f, vb.fieldOk[f] + '/' + vn, aiOk[f] + '/' + vn]); });
    rows.push(['request failures', '0', aiFail]);
    table('VOICE / QUICK-ADD: offline parser vs Gemini (' + vn + ' sentences)', rows);
    if (verbose) console.log('  Gemini misses:\n    ' + (aiMisses.join('\n    ') || '(none)'));
    summary.gemini = { A: ga, B: gb, voice: { allOk: aiAll, fieldOk: aiOk, failures: aiFail } };
    fs.writeFileSync(path.join(__dirname, 'gemini-results' + (HOLDOUT ? '-holdout' : '') + '.json'), JSON.stringify(summary.gemini, null, 2));
}

(async function main() {
    console.log('Fixtures: ' + (HOLDOUT ? 'bench/holdout.js (held out)' : 'bench/fixtures.js'));
    runSearch();
    runBucketing();
    runVoice();
    if (process.argv.indexOf('--gemini') !== -1) await runGemini();

    /* Regression gate: B must not lose to A on any offline metric. */
    const s = summary;
    const regressions = [];
    if (s.search.B.exact < s.search.A.exact || s.search.B.recall < s.search.A.recall) regressions.push('search');
    if (s.bucket.B.ok < s.bucket.A.ok) regressions.push('bucketing');
    if (s.voice.B.allOk < s.voice.A.allOk) regressions.push('voice');
    console.log('\n' + (regressions.length ? 'REGRESSION in: ' + regressions.join(', ') : 'OK: B is at least as good as A on every offline metric'));
    process.exitCode = regressions.length ? 1 : 0;
})();
