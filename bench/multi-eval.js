/* Multi-task messages A/B: one message holding several tasks.
   A = the original behaviour (the whole message becomes ONE task, parsed
   by the original parser/bucketer); B = Algos.parseTaskList.
   Data: bench/multi-holdout.js, written independently of B.

   node bench/multi-eval.js [-v] */
process.env.TZ = 'America/Chicago';

const A = require('./baseline.js');
const B = require('../js/algos.js');
const M = require('./multi-holdout.js');

const RealDate = Date;
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

const FIELDS = ['title', 'priority', 'dueDate', 'reminderISO', 'category'];
const verbose = process.argv.indexOf('-v') !== -1;
const seedTasks = require('../data/default-tasks.js');

function score(run) {
    let splitOk = 0, allOk = 0, items = 0;
    const fieldOk = { title: 0, priority: 0, dueDate: 0, reminderISO: 0, category: 0 };
    const misses = [];
    M.CASES.forEach(function (c) {
        const got = run(c);
        const exp = c.expected;
        const sameSplit = got.length === exp.length;
        if (sameSplit) splitOk++;
        else misses.push('"' + c.text.replace(/\n/g, '⏎') + '" → ' + got.length + ' tasks, want ' + exp.length);
        let all = sameSplit;
        exp.forEach(function (e, i) {
            items++;
            const g = got[i];
            FIELDS.forEach(function (f) {
                const gv = g ? (f === 'title' ? String(g.title).toLowerCase() : g[f]) : undefined;
                const ev = f === 'title' ? e.title.toLowerCase() : e[f];
                if (g && gv === ev) fieldOk[f]++;
                else {
                    all = false;
                    if (sameSplit) misses.push('"' + c.text.replace(/\n/g, '⏎') + '" #' + (i + 1) + ' ' + f + ': got ' + JSON.stringify(g ? g[f] : null) + ' want ' + JSON.stringify(e[f]));
                }
            });
        });
        if (all) allOk++;
    });
    return { splitOk: splitOk, allOk: allOk, fieldOk: fieldOk, items: items, misses: misses };
}

const a = score(function (c) {
    return atTime(M.NOW, function () {
        const p = A.parseSpeech(c.text);
        return [{ title: p.title, priority: p.priority, dueDate: p.dueDate, reminderISO: p.reminderISO, category: A.classifyTask(c.text, M.CATEGORIES) }];
    });
});
const b = score(function (c) {
    return atTime(M.NOW, function () { return B.parseTaskList(c.text, M.CATEGORIES, seedTasks, M.NOW); });
});

const n = M.CASES.length;
const multi = M.CASES.filter(function (c) { return c.expected.length > 1; }).length;
const pct = function (x, d) { return (100 * x / d).toFixed(1) + '%'; };
const rows = [
    ['', 'A (one task per message)', 'B (split + parse)'],
    ['messages split correctly', a.splitOk + '/' + n, b.splitOk + '/' + n],
    ['messages fully correct', a.allOk + '/' + n, b.allOk + '/' + n]
];
FIELDS.forEach(function (f) {
    rows.push(['item ' + f + ' correct', a.fieldOk[f] + '/' + a.items + ' ' + pct(a.fieldOk[f], a.items), b.fieldOk[f] + '/' + b.items + ' ' + pct(b.fieldOk[f], b.items)]);
});
console.log('MULTI-TASK MESSAGES (' + n + ' held-out messages: ' + multi + ' lists, ' + (n - multi) + ' single tasks; ' + b.items + ' tasks in total)');
const widths = rows[0].map(function (_, i) { return Math.max.apply(null, rows.map(function (r) { return String(r[i]).length; })); });
rows.forEach(function (r, ri) {
    console.log('  ' + r.map(function (c, i) { return String(c).padEnd(widths[i]); }).join('   '));
    if (ri === 0) console.log('  ' + widths.map(function (w) { return '-'.repeat(w); }).join('   '));
});
if (verbose) console.log('  B misses:\n    ' + (b.misses.join('\n    ') || '(none)'));
const regress = b.splitOk < a.splitOk || b.allOk < a.allOk;
console.log(regress ? 'REGRESSION: B worse than A' : 'OK: B is at least as good as A');
process.exitCode = regress ? 1 : 0;
