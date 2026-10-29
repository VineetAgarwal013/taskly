/*
 * HELD-OUT LABELED TEST SET
 *
 * Written independently as a held-out set: the author did not look at the
 * algorithm source (js/algos.js), the tuning fixtures (bench/fixtures.js), or
 * the other bench scripts. Every label reflects what a normal user would
 * expect, not what any algorithm outputs. Use it only to measure
 * generalization. Do not tune against it.
 *
 * Plain ES2017 CommonJS (Node 13 compatible).
 */
'use strict';

var DEFAULT_TASKS = require('../data/default-tasks.js');

/* ------------------------------------------------------------------ */
/* 1. BUCKET_CASES: auto-categorisation                                */
/* ------------------------------------------------------------------ */

var DEFAULT_CATS = ['Items to Buy', 'Chores / Job Hunt', 'Homework'];

var CUSTOM_CATS = ['Shopping', 'Office', 'Health', 'Family'];
var CUSTOM_EXISTING = [
    { id: 'c1', title: 'Buy dish soap', category: 'Shopping', description: '' },
    { id: 'c2', title: 'New sneakers', category: 'Shopping', description: '' },
    { id: 'c3', title: 'Paper towels and trash bags', category: 'Shopping', description: '' },
    { id: 'c4', title: 'Send weekly status update', category: 'Office', description: '' },
    { id: 'c5', title: 'Book conference room', category: 'Office', description: '' },
    { id: 'c6', title: 'Review contract draft', category: 'Office', description: '' },
    { id: 'c7', title: 'Book annual physical', category: 'Health', description: '' },
    { id: 'c8', title: 'Gym 3x this week', category: 'Health', description: '' },
    { id: 'c9', title: 'Call grandma', category: 'Family', description: '' },
    { id: 'c10', title: "Plan Emma's birthday party", category: 'Family', description: '' },
    { id: 'c11', title: 'Parent teacher conference', category: 'Family', description: '' }
];

var CUSTOM2_CATS = ['Errands', 'Side Project', 'Wellness'];
var CUSTOM2_EXISTING = [
    { id: 'e1', title: 'Drop off dry cleaning', category: 'Errands', description: '' },
    { id: 'e2', title: 'Post office - mail package', category: 'Errands', description: '' },
    { id: 'e3', title: 'Set up GitHub repo', category: 'Side Project', description: '' },
    { id: 'e4', title: 'Design landing page', category: 'Side Project', description: '' },
    { id: 'e5', title: 'Write API docs', category: 'Side Project', description: '' },
    { id: 'e6', title: 'Meditate 10 min', category: 'Wellness', description: '' },
    { id: 'e7', title: 'Yoga class', category: 'Wellness', description: '' }
];

function d(text, expected) {
    return { text: text, expected: expected, categories: DEFAULT_CATS, existing: DEFAULT_TASKS, set: 'default' };
}
function c(text, expected) {
    return { text: text, expected: expected, categories: CUSTOM_CATS, existing: CUSTOM_EXISTING, set: 'custom' };
}
function c2(text, expected) {
    return { text: text, expected: expected, categories: CUSTOM2_CATS, existing: CUSTOM2_EXISTING, set: 'custom2' };
}

var BUCKET_CASES = [
    // --- default set ---
    d('airpods case', 'Items to Buy'),
    d('new phone charger', 'Items to Buy'),
    d('paper towels', 'Items to Buy'),
    d('Nike running shoes', 'Items to Buy'),
    d('get basmati rice', 'Items to Buy'),
    d('toothpaste', 'Items to Buy'),
    d('yoga mat', 'Items to Buy'),
    d('HDMI cable', 'Items to Buy'),
    d('protein powder', 'Items to Buy'),
    d('ghee', 'Items to Buy'),
    d('update linkedin', 'Chores / Job Hunt'),
    d('apply to google swe internship', 'Chores / Job Hunt'),
    d('pay electricity bill', 'Chores / Job Hunt'),
    d('do laundry', 'Chores / Job Hunt'),
    d('renew drivers license', 'Chores / Job Hunt'),
    d('follow up w/ recruiter', 'Chores / Job Hunt'),
    d('cancel netflix sub', 'Chores / Job Hunt'),
    d('prep for amazon interview', 'Chores / Job Hunt'),
    d('calc pset 4', 'Homework'),
    d('read ch 7 for bio', 'Homework'),
    d('CS 310 project milestone', 'Homework'),
    d('study for orgo midterm', 'Homework'),
    d('history essay draft', 'Homework'),

    // --- custom set: Shopping / Office / Health / Family ---
    c('costco run', 'Shopping'),
    c('AA batteries', 'Shopping'),
    c('target - shampoo + conditioner', 'Shopping'),
    c('prep Q4 deck', 'Office'),
    c('expense report', 'Office'),
    c('reply to Jim re: budget', 'Office'),
    c('1:1 with manager', 'Office'),
    c('dentist cleaning', 'Health'),
    c('schedule flu shot', 'Health'),
    c('go for a 5k run', 'Health'),
    c('pick kids up from soccer', 'Family'),
    c('call dad', 'Family'),
    c('help Max w/ science fair', 'Family'),
    c('anniversary dinner w/ wife', 'Family'),

    // --- custom2 set: Errands / Side Project / Wellness ---
    c2('return amazon package at UPS', 'Errands'),
    c2('car wash', 'Errands'),
    c2('get keys copied', 'Errands'),
    c2('deposit check at bank', 'Errands'),
    c2('deploy to vercel', 'Side Project'),
    c2('fix login bug', 'Side Project'),
    c2('add dark mode', 'Side Project'),
    c2('write launch blog post', 'Side Project'),
    c2('journal before bed', 'Wellness'),
    c2('stretch 15 min', 'Wellness'),
    c2('drink more water', 'Wellness'),
    c2('sleep by 11', 'Wellness')
];

/* ------------------------------------------------------------------ */
/* 2. SEARCH                                                           */
/* ------------------------------------------------------------------ */

var SEARCH_TASKS = [
    { id: 's1', title: 'Buy almond milk', category: 'Groceries', description: "Unsweetened, from Trader Joe's", tip: '' },
    { id: 's2', title: 'Pick up eggs and bread', category: 'Groceries', description: '', tip: '' },
    { id: 's3', title: 'Olive oil', category: 'Groceries', description: 'Extra virgin, large bottle', tip: '' },
    { id: 's4', title: 'Coffee beans', category: 'Groceries', description: 'Whole bean, medium roast', tip: '' },
    { id: 's5', title: 'Finish Q3 report', category: 'Work', description: 'Send draft to manager by Friday', tip: '' },
    { id: 's6', title: 'Update resume', category: 'Work', description: 'Add the new project and certifications', tip: '' },
    { id: 's7', title: 'Prepare slides for client meeting', category: 'Work', description: 'Use the new template', tip: '' },
    { id: 's8', title: "Reply to Dave's email", category: 'Work', description: 'About the budget numbers', tip: '' },
    { id: 's9', title: 'Fix leaking kitchen faucet', category: 'Home', description: 'Buy a new washer at Home Depot', tip: '' },
    { id: 's10', title: 'Clean the garage', category: 'Home', description: '', tip: '' },
    { id: 's11', title: 'Change air filter', category: 'Home', description: 'HVAC filter 16x25', tip: '' },
    { id: 's12', title: 'Mow the lawn', category: 'Home', description: 'Before Saturday', tip: '' },
    { id: 's13', title: 'Schedule dentist appointment', category: 'Health', description: 'Cleaning overdue', tip: '' },
    { id: 's14', title: 'Refill prescription', category: 'Health', description: 'CVS pharmacy', tip: '' },
    { id: 's15', title: 'Book annual physical', category: 'Health', description: "Call Dr. Patel's office", tip: '' },
    { id: 's16', title: 'Go for a run', category: 'Health', description: '5k around the park', tip: '' },
    { id: 's17', title: 'Call mom', category: 'Home', description: 'Her birthday is next week', tip: '' },
    { id: 's18', title: 'Order printer ink', category: 'Work', description: 'HP 63 black cartridge', tip: '' },
    { id: 's19', title: 'Pay electricity bill', category: 'Home', description: 'Due on the 15th', tip: '' },
    { id: 's20', title: 'Buy birthday gift for mom', category: 'Home', description: 'Maybe a scarf', tip: '' }
];

var SEARCH_CASES = [
    { query: 'milk', expected: ['s1'] },
    { query: 'mom', expected: ['s17', 's20'] },
    { query: 'dentist', expected: ['s13'] },
    { query: 'health', expected: ['s13', 's14', 's15', 's16'] },       // category name only
    { query: 'groceries', expected: ['s1', 's2', 's3', 's4'] },        // category name only
    { query: 'report q3', expected: ['s5'] },                          // reversed word order
    { query: 'Q3 REPORT!', expected: ['s5'] },                         // case + punctuation
    { query: 'resum', expected: ['s6'] },                              // partial word
    { query: 'appoint', expected: ['s13'] },                           // partial word
    { query: 'buy', expected: ['s1', 's9', 's20'] },                   // title + description
    { query: 'kitchen faucet', expected: ['s9'] },
    { query: 'work email', expected: ['s8'] },                         // category + title
    { query: 'home bill', expected: ['s19'] },                         // category + title
    { query: 'mom birthday', expected: ['s17', 's20'] },               // title + description
    { query: 'pharmacy', expected: ['s14'] },                          // description only
    { query: 'dave', expected: ['s8'] },                               // possessive in title
    { query: "trader joe's", expected: ['s1'] },
    { query: 'ink printer', expected: ['s18'] },
    { query: 'clean', expected: ['s10', 's13'] },                      // prefix of "Cleaning"
    { query: 'friday', expected: ['s5'] },
    { query: 'vacation', expected: [] }                                // no results
];

/* ------------------------------------------------------------------ */
/* 3. VOICE_CASES: spoken quick-add, America/Chicago                   */
/* ------------------------------------------------------------------ */

var WED = '2026-06-17T09:00:00'; // Wednesday, June 17 2026, 9:00 am
var FRI = '2026-06-19T14:00:00'; // Friday, June 19 2026, 2:00 pm
var MON = '2026-11-02T18:30:00'; // Monday, November 2 2026, 6:30 pm (after DST ends)

function v(text, now, title, priority, dueDate, reminderISO) {
    return { text: text, now: now, expected: { title: title, priority: priority, dueDate: dueDate, reminderISO: reminderISO } };
}

var VOICE_CASES = [
    // plain titles, no dates
    v('call mom', WED, 'Call mom', 'med', null, null),
    v('buy 3 lemons', WED, 'Buy 3 lemons', 'med', null, null),
    v('read chapter 5 for history', WED, 'Read chapter 5 for history', 'med', null, null),
    v('practice piano for 30 minutes', FRI, 'Practice piano for 30 minutes', 'med', null, null),

    // priority words
    v('pay rent urgent', WED, 'Pay rent', 'high', null, null),
    v('email professor asap', WED, 'Email professor', 'high', null, null),
    v('water the plants low priority', WED, 'Water the plants', 'low', null, null),
    v('clean out the garage whenever', WED, 'Clean out the garage', 'low', null, null),
    v('high priority finish tax forms by monday', WED, 'Finish tax forms', 'high', '2026-06-22', null),
    v('urgent call landlord about the leak', MON, 'Call landlord about the leak', 'high', null, null),

    // "high" / "low" in a non-priority sense
    v('pick up high chair from target', WED, 'Pick up high chair from target', 'med', null, null),
    v('buy low fat milk', WED, 'Buy low fat milk', 'med', null, null),

    // relative days / weekdays
    v('submit the report tomorrow', WED, 'Submit the report', 'med', '2026-06-18', null),
    v('return library books by friday', WED, 'Return library books', 'med', '2026-06-19', null),
    v('meeting with design team wednesday', WED, 'Meeting with design team', 'med', '2026-06-24', null), // same weekday -> +7
    v('fix the bike and clean the shed saturday', WED, 'Fix the bike and clean the shed', 'med', '2026-06-20', null),
    v('send invoice this friday', WED, 'Send invoice', 'med', '2026-06-19', null),
    v('doctor appointment next tuesday at 11', WED, 'Doctor appointment', 'med', '2026-06-23', '2026-06-23T11:00:00'),
    v('renew passport in 3 days', WED, 'Renew passport', 'med', '2026-06-20', null),
    v('book flights in 2 weeks', WED, 'Book flights', 'med', '2026-07-01', null),
    v('call plumber monday', MON, 'Call plumber', 'med', '2026-11-09', null),                    // same weekday -> +7
    v('renew gym membership in 30 days', MON, 'Renew gym membership', 'med', '2026-12-02', null),
    v('pay electric bill next friday', FRI, 'Pay electric bill', 'med', '2026-06-26', null),
    v('laundry sunday low priority', FRI, 'Laundry', 'low', '2026-06-21', null),

    // month names and numeric dates
    v("mom's birthday on july 4", WED, "Mom's birthday", 'med', '2026-07-04', null),
    v('pay credit card bill 7/4', WED, 'Pay credit card bill', 'med', '2026-07-04', null),
    v('dentist cleaning 3/15', WED, 'Dentist cleaning', 'med', '2027-03-15', null),               // past -> next year
    v('renew car registration by march 3', WED, 'Renew car registration', 'med', '2027-03-03', null),
    v('schedule oil change on december 1st', WED, 'Schedule oil change', 'med', '2026-12-01', null),
    v('buy thanksgiving turkey on november 20', MON, 'Buy thanksgiving turkey', 'med', '2026-11-20', null),

    // times
    v('call the bank at 2', WED, 'Call the bank', 'med', '2026-06-17', '2026-06-17T14:00:00'),
    v('team standup at 10', WED, 'Team standup', 'med', '2026-06-17', '2026-06-17T10:00:00'),
    v('lunch with sarah at noon', WED, 'Lunch with sarah', 'med', '2026-06-17', '2026-06-17T12:00:00'),
    v('pick up dry cleaning at 12', WED, 'Pick up dry cleaning', 'med', '2026-06-17', '2026-06-17T12:00:00'),
    v('take out the trash at 9 tonight', WED, 'Take out the trash', 'med', '2026-06-17', '2026-06-17T21:00:00'),
    v('pick up kids from school at 3:30', WED, 'Pick up kids from school', 'med', '2026-06-17', '2026-06-17T15:30:00'),
    v('order pizza at 7:45 pm', WED, 'Order pizza', 'med', '2026-06-17', '2026-06-17T19:45:00'),
    v('dentist appointment friday at 3', WED, 'Dentist appointment', 'med', '2026-06-19', '2026-06-19T15:00:00'),
    v('wake up early for flight tomorrow at 5 am', WED, 'Wake up early for flight', 'med', '2026-06-18', '2026-06-18T05:00:00'),
    v('submit expense report by 4', FRI, 'Submit expense report', 'med', '2026-06-19', '2026-06-19T16:00:00'),
    v('submit timesheet tomorrow at 8', MON, 'Submit timesheet', 'med', '2026-11-03', '2026-11-03T08:00:00'),

    // harder spoken times
    v('call grandma at quarter past 4', WED, 'Call grandma', 'med', '2026-06-17', '2026-06-17T16:15:00'),
    v('gym at half past 6 tomorrow', WED, 'Gym', 'med', '2026-06-18', '2026-06-18T18:30:00')
];

module.exports = {
    BUCKET_CASES: BUCKET_CASES,
    SEARCH_TASKS: SEARCH_TASKS,
    SEARCH_CASES: SEARCH_CASES,
    VOICE_CASES: VOICE_CASES
};
