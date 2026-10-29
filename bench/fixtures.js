/* Labeled data for the A/B benchmark. Labels are what a person would
   expect, written before version B was tuned. Dates assume the fixed
   clock NOW (Wednesday 2026-03-04 10:00, America/Chicago). */

const NOW = '2026-03-04T10:00:00';

/* ==================== Bucketing ==================== */

const DEFAULT_CATS = ['Items to Buy', 'Chores / Job Hunt', 'Homework'];
const DEFAULT_EXISTING = require('../data/default-tasks.js');

const CUSTOM_CATS = ['Groceries', 'Work', 'Fitness', 'Home'];
const CUSTOM_EXISTING = [
    ['Eggs', 'Groceries'], ['Spinach', 'Groceries'], ['Greek yogurt', 'Groceries'],
    ['Prepare Q3 slides', 'Work'], ['1:1 with manager', 'Work'], ['Reply to client emails', 'Work'],
    ['Leg day at gym', 'Fitness'], ['Run 5k', 'Fitness'], ['Yoga class', 'Fitness'],
    ['Fix leaky faucet', 'Home'], ['Vacuum living room', 'Home'], ['Water the plants', 'Home']
].map(function (p, i) { return { id: 'c' + i, title: p[0], category: p[1], description: '' }; });

const BUCKET_CASES = [
    /* Default categories */
    ['buy bread', 'Items to Buy'],
    ['get almond milk', 'Items to Buy'],
    ['order a phone charger', 'Items to Buy'],
    ['new running shoes', 'Items to Buy'],
    ['pick up toothpaste', 'Items to Buy'],
    ['laptop stand', 'Items to Buy'],
    ['paper towels', 'Items to Buy'],
    ['printer ink', 'Items to Buy'],
    ['birthday card for mom', 'Items to Buy'],
    ['sunscreen', 'Items to Buy'],
    ['rice and lentils', 'Items to Buy'],
    ['apply to Google internship', 'Chores / Job Hunt'],
    ['update my resume', 'Chores / Job Hunt'],
    ['call the landlord about the leak', 'Chores / Job Hunt'],
    ['pay electricity bill', 'Chores / Job Hunt'],
    ['do laundry', 'Chores / Job Hunt'],
    ['schedule dentist appointment', 'Chores / Job Hunt'],
    ['renew driver license', 'Chores / Job Hunt'],
    ['clean the kitchen', 'Chores / Job Hunt'],
    ['follow up with recruiter', 'Chores / Job Hunt'],
    ['submit job application at Amazon', 'Chores / Job Hunt'],
    ['fix bike tire', 'Chores / Job Hunt'],
    ['take out the trash', 'Chores / Job Hunt'],
    ['prepare for interview with Meta', 'Chores / Job Hunt'],
    ['finish calculus problem set', 'Homework'],
    ['read chapter 5 for history', 'Homework'],
    ['write essay on climate change', 'Homework'],
    ['study for chemistry midterm', 'Homework'],
    ['accounting quiz prep', 'Homework'],
    ['submit lab report', 'Homework'],
    ['physics homework 3', 'Homework'],
    ['review lecture notes', 'Homework'],
    ['group project meeting', 'Homework'],
    ['register for spring classes', 'Homework'],
    /* Custom categories (a user who renamed everything) */
    ['buy milk', 'Groceries', 'custom'],
    ['bananas and apples', 'Groceries', 'custom'],
    ['get chicken breast', 'Groceries', 'custom'],
    ['pick up bread', 'Groceries', 'custom'],
    ['olive oil', 'Groceries', 'custom'],
    ['coffee beans', 'Groceries', 'custom'],
    ['send invoice to client', 'Work', 'custom'],
    ['team standup notes', 'Work', 'custom'],
    ['finish the quarterly report', 'Work', 'custom'],
    ['schedule meeting with design team', 'Work', 'custom'],
    ['review pull request', 'Work', 'custom'],
    ['email manager about deadline', 'Work', 'custom'],
    ['run 10k on saturday', 'Fitness', 'custom'],
    ['chest and back workout', 'Fitness', 'custom'],
    ['swim laps', 'Fitness', 'custom'],
    ['stretch for 15 minutes', 'Fitness', 'custom'],
    ['book a spin class', 'Fitness', 'custom'],
    ['go to the gym', 'Fitness', 'custom'],
    ['clean the bathroom', 'Home', 'custom'],
    ['mow the lawn', 'Home', 'custom'],
    ['change air filter', 'Home', 'custom'],
    ['do the dishes', 'Home', 'custom'],
    ['replace light bulb in hallway', 'Home', 'custom'],
    ['water the garden', 'Home', 'custom']
].map(function (c) {
    const custom = c[2] === 'custom';
    return {
        text: c[0], expected: c[1],
        categories: custom ? CUSTOM_CATS : DEFAULT_CATS,
        existing: custom ? CUSTOM_EXISTING : DEFAULT_EXISTING,
        set: custom ? 'custom' : 'default'
    };
});

/* ==================== Search ==================== */

const SEARCH_TASKS = [
    ['1', 'Airpods', 'Items to Buy', 'Compare prices on Amazon'],
    ['2', 'Sesame seeds', 'Items to Buy', ''],
    ['3', 'Chia seeds', 'Items to Buy', ''],
    ['4', 'Gond katira', 'Items to Buy', ''],
    ['5', 'Comb', 'Items to Buy', ''],
    ['6', 'Bucket and mug', 'Items to Buy', ''],
    ['7', 'Handkerchief', 'Items to Buy', ''],
    ['8', 'Make the 20 transfer', 'Chores / Job Hunt', 'Transfer before bank closes'],
    ['9', 'Apply for credit card', 'Chores / Job Hunt', ''],
    ['10', 'Remove WiFi', 'Chores / Job Hunt', ''],
    ['11', 'August lunch colloquium register', 'Homework', ''],
    ['12', 'Read chapter 5', 'Homework', 'History textbook'],
    ['13', 'Pay electricity bill', 'Chores / Job Hunt', 'Due on the 15th'],
    ['14', 'Buy running shoes', 'Items to Buy', ''],
    ['15', 'Email professor about extension', 'Homework', ''],
    ['16', 'Call bank about card', 'Chores / Job Hunt', ''],
    ['17', 'Calculus problem set', 'Homework', 'Problems 1-20'],
    ['18', 'Order phone charger', 'Items to Buy', 'USB-C, 2 pack']
].map(function (r) { return { id: r[0], title: r[1], category: r[2], description: r[3], tip: '' }; });

const SEARCH_CASES = [
    ['seeds', ['2', '3']],
    ['seed', ['2', '3']],
    ['buy seeds', ['2', '3']],
    ['credit card', ['9']],
    ['card', ['9', '16']],
    ['bank', ['8', '16']],
    ['transfer bank', ['8']],
    ['amazon', ['1']],
    ['homework', ['11', '12', '15', '17']],
    ['chapter 5', ['12']],
    ['email', ['15']],
    ['usb-c', ['18']],
    ['AIRPODS', ['1']],
    ['pods', ['1']],
    ['call', ['16']],
    ['bill', ['13']],
    ['problem', ['17']],
    ['shoes running', ['14']],
    ['mug bucket', ['6']],
    ['wifi', ['10']],
    ['lunch', ['11']],
    ['zzz', []],
    ['pay', ['13']],
    ['phone charger', ['18']],
    ['history', ['12']],
    ['comb', ['5']],
    ['extension', ['15']]
].map(function (c) { return { query: c[0], expected: c[1] }; });

/* ==================== Voice ==================== */

const LATE = '2026-03-04T23:30:00'; /* DST starts 2026-03-08 in the US */

const VOICE_CASES = [
    ['buy milk tomorrow', 'Buy milk', 'med', '2026-03-05', null],
    ['call mom at 5pm', 'Call mom', 'med', '2026-03-04', '2026-03-04T17:00:00'],
    ['urgent pay rent by friday', 'Pay rent', 'high', '2026-03-06', null],
    ['submit report high priority', 'Submit report', 'high', null, null],
    ['water plants whenever', 'Water plants', 'low', null, null],
    ['dentist appointment on 3/12 at 9am', 'Dentist appointment', 'med', '2026-03-12', '2026-03-12T09:00:00'],
    ['meeting with professor at 4', 'Meeting with professor', 'med', '2026-03-04', '2026-03-04T16:00:00'],
    ['finish essay in 3 days', 'Finish essay', 'med', '2026-03-07', null],
    ['book flights march 20th', 'Book flights', 'med', '2026-03-20', null],
    ['read this book tonight', 'Read this book', 'med', '2026-03-04', null],
    ['pick up kids at school at 3:30pm', 'Pick up kids at school', 'med', '2026-03-04', '2026-03-04T15:30:00'],
    ['buy low fat milk', 'Buy low fat milk', 'med', null, null],
    ['go to high school reunion saturday', 'Go to high school reunion', 'med', '2026-03-07', null],
    ['send important email to boss asap', 'Send important email to boss', 'high', null, null],
    ['doctor appointment next monday', 'Doctor appointment', 'med', '2026-03-09', null],
    ['call landlord day after tomorrow', 'Call landlord', 'med', '2026-03-06', null],
    ['gym at noon', 'Gym', 'med', '2026-03-04', '2026-03-04T12:00:00'],
    ['submit timesheet by 11am today', 'Submit timesheet', 'med', '2026-03-04', '2026-03-04T11:00:00'],
    ['laundry', 'Laundry', 'med', null, null],
    ['buy groceries before 6pm', 'Buy groceries', 'med', '2026-03-04', '2026-03-04T18:00:00'],
    ['renew passport by may 2', 'Renew passport', 'med', '2026-05-02', null],
    ['finish slides wednesday', 'Finish slides', 'med', '2026-03-11', null],
    ['pay rent in 5 days', 'Pay rent', 'med', '2026-03-09', null, LATE],
    ['call bob in 1 day', 'Call bob', 'med', '2026-03-05', null],
    ['review notes before the exam tomorrow at 8am', 'Review notes before the exam', 'med', '2026-03-05', '2026-03-05T08:00:00'],
    ['low priority organize desk', 'Organize desk', 'low', null, null],
    ['medium priority email recruiter', 'Email recruiter', 'med', null, null],
    ['call mom at 7', 'Call mom', 'med', '2026-03-04', '2026-03-04T19:00:00'],
    ['meet advisor at 10', 'Meet advisor', 'med', '2026-03-04', '2026-03-04T10:00:00'],
    ['submit form 4/15', 'Submit form', 'med', '2026-04-15', null],
    ['order cake for 12/25', 'Order cake', 'med', '2026-12-25', null],
    ['pay tuition 1/2', 'Pay tuition', 'med', '2027-01-02', null],
    ['workout at 6:45am tomorrow', 'Workout', 'med', '2026-03-05', '2026-03-05T06:45:00'],
    ['buy 2 notebooks', 'Buy 2 notebooks', 'med', null, null],
    ['it may rain so bring an umbrella', 'It may rain so bring an umbrella', 'med', null, null],
    ['finish homework by 9 tonight', 'Finish homework', 'med', '2026-03-04', '2026-03-04T21:00:00'],
    ['team sync at 2:30', 'Team sync', 'med', '2026-03-04', '2026-03-04T14:30:00'],
    ['finish math homework at 11:59pm in 2 days', 'Finish math homework', 'med', '2026-03-06', '2026-03-06T23:59:00']
].map(function (c) {
    return {
        text: c[0], now: c[5] || NOW,
        expected: { title: c[1], priority: c[2], dueDate: c[3], reminderISO: c[4] }
    };
});

module.exports = {
    NOW: NOW,
    BUCKET_CASES: BUCKET_CASES,
    SEARCH_TASKS: SEARCH_TASKS,
    SEARCH_CASES: SEARCH_CASES,
    VOICE_CASES: VOICE_CASES
};
