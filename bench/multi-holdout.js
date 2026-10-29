/*
 * HELD-OUT LABELED TEST SET: MULTI-TASK SPLITTING
 *
 * Written independently as a held-out set: the author did not look at the
 * algorithm source (js/algos.js, js/app.js), the tuning fixtures, or the other
 * bench scripts. Every label reflects what a normal MBA student would expect
 * when typing, pasting or dictating one message that holds several tasks.
 * Use it only to measure generalization. Do not tune against it.
 *
 * Each case: { text, expected: [ { title, priority, dueDate, reminderISO, category } ] }
 * one expected entry per task the user meant, in order.
 *
 * Plain ES2017 CommonJS (Node 13 compatible).
 */
'use strict';

// Wednesday, 16 September 2026, 9:00 am (America/Chicago).
// Calendar: Thu 09-17 (tomorrow), Fri 09-18, Sat 09-19, Sun 09-20,
// Mon 09-21, Tue 09-22, Wed 09-23 (next Wednesday).
var NOW = '2026-09-16T09:00:00';

var CATEGORIES = ['Items to Buy', 'Chores / Job Hunt', 'Homework'];

var BUY = 'Items to Buy';
var CHORE = 'Chores / Job Hunt';
var HW = 'Homework';

function t(title, category, dueDate, reminderISO, priority) {
    return {
        title: title,
        priority: priority || 'med',
        dueDate: dueDate || null,
        reminderISO: reminderISO || null,
        category: category
    };
}

var CASES = [
    /* ---------------- multi-task messages ---------------- */

    // plain comma list
    { text: 'buy milk, call mom, renew passport',
      expected: [t('Buy milk', BUY), t('Call mom', CHORE), t('Renew passport', CHORE)] },

    // leading date with colon applies to all
    { text: 'tomorrow: buy milk, call mom',
      expected: [t('Buy milk', BUY, '2026-09-17'), t('Call mom', CHORE, '2026-09-17')] },

    // dictated with then / also
    { text: 'buy milk then call mom also pay rent',
      expected: [t('Buy milk', BUY), t('Call mom', CHORE), t('Pay rent', CHORE)] },

    { text: 'email the recruiter then buy groceries then start the finance reading',
      expected: [t('Email the recruiter', CHORE), t('Buy groceries', BUY), t('Start the finance reading', HW)] },

    { text: 'pay phone bill also buy dog food',
      expected: [t('Pay phone bill', CHORE), t('Buy dog food', BUY)] },

    // semicolons
    { text: 'submit finance problem set by friday; update resume; buy printer ink',
      expected: [t('Submit finance problem set', HW, '2026-09-18'), t('Update resume', CHORE), t('Buy printer ink', BUY)] },

    { text: 'buy bread and butter; call the bank; finish ethics reflection',
      expected: [t('Buy bread and butter', BUY), t('Call the bank', CHORE), t('Finish ethics reflection', HW)] },

    // pasted dash list
    { text: '- buy eggs\n- email recruiter at Bain\n- read case for strategy class',
      expected: [t('Buy eggs', BUY), t('Email recruiter at Bain', CHORE), t('Read case for strategy class', HW)] },

    // star list
    { text: '* return amazon package\n* buy phone charger\n* study for midterm',
      expected: [t('Return amazon package', CHORE), t('Buy phone charger', BUY), t('Study for midterm', HW)] },

    // bullet list
    { text: '• pay electricity bill\n• buy toothpaste\n• finish accounting homework',
      expected: [t('Pay electricity bill', CHORE), t('Buy toothpaste', BUY), t('Finish accounting homework', HW)] },

    // numbered "1." list, multi-line
    { text: '1. draft cover letter for McKinsey\n2. buy coffee beans\n3. read chapter 5 for marketing',
      expected: [t('Draft cover letter for McKinsey', CHORE), t('Buy coffee beans', BUY), t('Read chapter 5 for marketing', HW)] },

    // numbered "1)" list, multi-line
    { text: '1) apply to Amazon internship\n2) buy new headphones\n3) watch lecture recording for ops',
      expected: [t('Apply to Amazon internship', CHORE), t('Buy new headphones', BUY), t('Watch lecture recording for ops', HW)] },

    // numbered list on one line
    { text: '1. buy bread 2. call landlord 3. finish stats quiz',
      expected: [t('Buy bread', BUY), t('Call landlord', CHORE), t('Finish stats quiz', HW)] },

    { text: '1) call landlord at 5 2) buy detergent',
      expected: [t('Call landlord', CHORE, '2026-09-16', '2026-09-16T17:00:00'), t('Buy detergent', BUY)] },

    // headers alone on a line
    { text: 'Homework:\n- finance case writeup\n- marketing reading\nItems to Buy:\n- paper towels\n- shampoo',
      expected: [t('Finance case writeup', HW), t('Marketing reading', HW), t('Paper towels', BUY), t('Shampoo', BUY)] },

    { text: 'Items to Buy:\n- gift for Sarah\n- printer paper\nHomework:\n- email professor about extension',
      expected: [t('Gift for Sarah', BUY), t('Printer paper', BUY), t('Email professor about extension', HW)] },

    // header before colon on the same line
    { text: 'Items to Buy: batteries, light bulbs, dish soap',
      expected: [t('Batteries', BUY), t('Light bulbs', BUY), t('Dish soap', BUY)] },

    { text: 'Chores / Job Hunt: apply to Google, do laundry, follow up with recruiter',
      expected: [t('Apply to Google', CHORE), t('Do laundry', CHORE), t('Follow up with recruiter', CHORE)] },

    { text: 'Homework: read HBS case, finish quant quiz\nItems to Buy: highlighters, sticky notes',
      expected: [t('Read HBS case', HW), t('Finish quant quiz', HW), t('Highlighters', BUY), t('Sticky notes', BUY)] },

    { text: 'Homework: finance quiz friday, marketing essay monday',
      expected: [t('Finance quiz', HW, '2026-09-18'), t('Marketing essay', HW, '2026-09-21')] },

    // leading date + times
    { text: 'friday: dentist appointment at 3, pick up dry cleaning',
      expected: [t('Dentist appointment', CHORE, '2026-09-18', '2026-09-18T15:00:00'), t('Pick up dry cleaning', CHORE, '2026-09-18')] },

    { text: 'monday: coffee chat with alum at 9, finish accounting problem set',
      expected: [t('Coffee chat with alum', CHORE, '2026-09-21', '2026-09-21T09:00:00'), t('Finish accounting problem set', HW, '2026-09-21')] },

    { text: 'tomorrow: pick up package at 11am, coffee chat with Deloitte at 4pm, buy protein bars',
      expected: [
          t('Pick up package', CHORE, '2026-09-17', '2026-09-17T11:00:00'),
          t('Coffee chat with Deloitte', CHORE, '2026-09-17', '2026-09-17T16:00:00'),
          t('Buy protein bars', BUY, '2026-09-17')
      ] },

    // item's own date beats the leading date
    { text: 'tomorrow: buy milk, submit essay on monday',
      expected: [t('Buy milk', BUY, '2026-09-17'), t('Submit essay', HW, '2026-09-21')] },

    // leading weekday equal to today -> next week
    { text: 'wednesday: submit expense report, buy birthday card',
      expected: [t('Submit expense report', CHORE, '2026-09-23'), t('Buy birthday card', BUY, '2026-09-23')] },

    { text: 'thursday: send thank-you email to interviewer, finish marketing slides',
      expected: [t('Send thank-you email to interviewer', CHORE, '2026-09-17'), t('Finish marketing slides', HW, '2026-09-17')] },

    // leading date alone on its own line, then a list
    { text: 'Tomorrow:\n- buy bananas\n- call insurance company\n- prep for case interview',
      expected: [t('Buy bananas', BUY, '2026-09-17'), t('Call insurance company', CHORE, '2026-09-17'), t('Prep for case interview', CHORE, '2026-09-17')] },

    // per-item dates in a pasted list
    { text: '- finance homework due friday\n- buy groceries saturday\n- call mom sunday',
      expected: [t('Finance homework', HW, '2026-09-18'), t('Buy groceries', BUY, '2026-09-19'), t('Call mom', CHORE, '2026-09-20')] },

    // explicit dates per item
    { text: 'oct 2: submit visa paperwork; oct 5: return library books',
      expected: [t('Submit visa paperwork', CHORE, '2026-10-02'), t('Return library books', CHORE, '2026-10-05')] },

    // time with no date means today
    { text: 'call bank at 10am, buy stamps',
      expected: [t('Call bank', CHORE, '2026-09-16', '2026-09-16T10:00:00'), t('Buy stamps', BUY)] },

    // priorities
    { text: 'pay rent urgent, buy snacks low priority, finish ops homework',
      expected: [t('Pay rent', CHORE, null, null, 'high'), t('Buy snacks', BUY, null, null, 'low'), t('Finish ops homework', HW)] },

    { text: 'update LinkedIn profile high priority, buy umbrella',
      expected: [t('Update LinkedIn profile', CHORE, null, null, 'high'), t('Buy umbrella', BUY)] },

    { text: 'tomorrow: urgent pay credit card bill, buy coffee',
      expected: [t('Pay credit card bill', CHORE, '2026-09-17', null, 'high'), t('Buy coffee', BUY, '2026-09-17')] },

    // "and" inside items does not split
    { text: 'buy salt and pepper, pick up kids and groceries, call mom',
      expected: [t('Buy salt and pepper', BUY), t('Pick up kids and groceries', CHORE), t('Call mom', CHORE)] },

    // comma inside a date does not split
    { text: 'buy concert tickets, pay rent by october 1, 2026, call dad',
      expected: [t('Buy concert tickets', BUY), t('Pay rent', CHORE, '2026-10-01'), t('Call dad', CHORE)] },

    { text: 'pay tuition by march 20, 2027; buy notebooks',
      expected: [t('Pay tuition', CHORE, '2027-03-20'), t('Buy notebooks', BUY)] },

    /* ---------------- single-task messages (must stay ONE task) ---------------- */

    { text: 'buy salt and pepper',
      expected: [t('Buy salt and pepper', BUY)] },

    { text: 'pick up kids and groceries',
      expected: [t('Pick up kids and groceries', CHORE)] },

    { text: 'pay parking ticket by march 20, 2027',
      expected: [t('Pay parking ticket', CHORE, '2027-03-20')] },

    { text: 'submit cover letter to Goldman on sept 30, 2026',
      expected: [t('Submit cover letter to Goldman', CHORE, '2026-09-30')] },

    { text: '1:1 with manager tomorrow at 2',
      expected: [t('1:1 with manager', CHORE, '2026-09-17', '2026-09-17T14:00:00')] },

    { text: 'do problems 1-20 for stats',
      expected: [t('Do problems 1-20 for stats', HW)] },

    { text: 'read chapters 3 and 4 for finance',
      expected: [t('Read chapters 3 and 4 for finance', HW)] },

    { text: 'email professor about the group project and the deadline',
      expected: [t('Email professor about the group project and the deadline', HW)] },

    { text: 'call mom at 6',
      expected: [t('Call mom', CHORE, '2026-09-16', '2026-09-16T18:00:00')] },

    { text: 'buy shampoo and conditioner urgent',
      expected: [t('Buy shampoo and conditioner', BUY, null, null, 'high')] },

    { text: 'Homework: finish accounting quiz',
      expected: [t('Finish accounting quiz', HW)] }
];

module.exports = { NOW: NOW, CATEGORIES: CATEGORIES, CASES: CASES };
