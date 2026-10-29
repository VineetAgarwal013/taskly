/* Multi-task splitting: one message → separate tasks, each with its own
   parsed date / time / priority / column.

   node bench/split-test.js */
process.env.TZ = 'America/Chicago';

const assert = require('assert');
const B = require('../js/algos.js');
const NOW = '2026-03-04T10:00:00'; /* Wednesday */

const SPLITS = [
    ['buy milk', ['buy milk']],
    ['call mom, pay rent friday, finish essay tomorrow 5pm', ['call mom', 'pay rent friday', 'finish essay tomorrow 5pm']],
    ['buy milk; call mom', ['buy milk', 'call mom']],
    ['buy milk\ncall mom\n\n- read chapter 4', ['buy milk', 'call mom', 'read chapter 4']],
    ['1. buy milk 2. call mom at 5 3. read chapter 4', ['buy milk', 'call mom at 5', 'read chapter 4']],
    ['1) apply to bain\n2) update resume', ['apply to bain', 'update resume']],
    ['- milk - eggs - bread', ['milk', 'eggs', 'bread']],
    ['• milk\n• eggs', ['milk', 'eggs']],
    ['email prof, then book room, and print slides', ['email prof', 'book room', 'print slides']],
    /* Must stay one task */
    ['renew passport by march 20, 2027', ['renew passport by march 20, 2027']],
    ['pick up kids and groceries', ['pick up kids and groceries']],
    ['1:1 with manager', ['1:1 with manager']],
    ['Problems 1-20 for calculus', ['Problems 1-20 for calculus']],
    ['make the 20 transfer', ['make the 20 transfer']],
    ['finish homework by 9 tonight.', ['finish homework by 9 tonight']],
    ['  ', []]
];

const PER_ITEM = [
    /* text → [title, priority, dueDate, reminderISO, column] for each piece */
    ['call mom at 5pm, urgent pay rent friday, finish calculus problem set tomorrow', [
        ['Call mom', 'med', '2026-03-04', '2026-03-04T17:00:00', 'Chores / Job Hunt'],
        ['Pay rent', 'high', '2026-03-06', null, 'Chores / Job Hunt'],
        ['Finish calculus problem set', 'med', '2026-03-05', null, 'Homework']
    ]],
    ['- printer ink\n- study for midterm 3/12\n- update resume low priority', [
        ['Printer ink', 'med', null, null, 'Items to Buy'],
        ['Study for midterm', 'med', '2026-03-12', null, 'Homework'],
        ['Update resume', 'low', null, null, 'Chores / Job Hunt']
    ]]
];

const cats = ['Items to Buy', 'Chores / Job Hunt', 'Homework'];
const existing = require('../data/default-tasks.js');
let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); pass++; } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

SPLITS.forEach(function (c) {
    check('split ' + JSON.stringify(c[0]), function () { assert.deepStrictEqual(B.splitTasks(c[0]), c[1]); });
});
PER_ITEM.forEach(function (c) {
    check('per-item parse ' + JSON.stringify(c[0]), function () {
        const got = B.splitTasks(c[0]).map(function (piece) {
            const p = B.parseSpeech(piece, NOW);
            return [p.title, p.priority, p.dueDate, p.reminderISO, B.classifyLocal(p.title, cats, existing)];
        });
        assert.deepStrictEqual(got, c[1]);
    });
});

console.log(pass + '/' + (pass + fail) + ' split checks passed');
process.exitCode = fail ? 1 : 0;
