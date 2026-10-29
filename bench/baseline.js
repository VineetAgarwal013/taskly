/* Version A: verbatim copies of the pre-benchmark algorithms, so the
   A/B runner always compares against the original behaviour.
   - matchesSearch / classifyTask: js/app.js (state passed in explicitly)
   - parseSpeech: js/voice.js (reads the real clock; bench fakes Date) */

function matchesSearch(t, search) {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.title.toLowerCase().indexOf(q) !== -1 ||
        (t.description || '').toLowerCase().indexOf(q) !== -1;
}

function classifyTask(text, categories) {
    const lower = text.toLowerCase();
    const hwKeywords = ['homework', 'assignment', 'study', 'class', 'read', 'essay', 'math', 'accounting', 'quiz', 'exam', 'paper', 'register', 'colloquium', 'school', 'course', 'project'];
    if (hwKeywords.some(function (kw) { return lower.includes(kw); }) && categories.indexOf('Homework') !== -1) {
        return 'Homework';
    }
    const choreKeywords = ['apply', 'job', 'resume', 'transfer', 'card', 'wifi', 'clean', 'fix', 'interview', 'pay', 'call', 'email', 'errand', 'laundry', 'bank', 'credit', 'send', 'remove'];
    if (choreKeywords.some(function (kw) { return lower.includes(kw); }) && categories.indexOf('Chores / Job Hunt') !== -1) {
        return 'Chores / Job Hunt';
    }
    return categories[0];
}

const PRIO_HIGH_PHRASE = /\b(high priority|urgent|asap|immediate|important)\b/;
const PRIO_MED_PHRASE = /\b(medium priority|moderate)\b/;
const PRIO_LOW_PHRASE = /\b(low priority|whenever)\b/;
const PRIO_HIGH_WORD = /\b(high|urgent|asap|immediate|important)\b/;
const PRIO_MED_WORD = /\b(medium|moderate|normal)\b/;
const PRIO_LOW_WORD = /\b(low|whenever)\b/;
const TIME_RE = /(?:by|at|around|before|~)?\s*(\d{1,2})(?::(\d{1,2}))?\s*(a\.?m\.?|p\.?m\.?)/i;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function regexEscape(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectPriority(source) {
    if (PRIO_HIGH_PHRASE.test(source)) return 'high';
    if (PRIO_MED_PHRASE.test(source)) return 'med';
    if (PRIO_LOW_PHRASE.test(source)) return 'low';
    if (/\bpriority\b/.test(source) || /urgent|asap|immediate|important|moderate|whenever/.test(source)) return 'med';
    if (PRIO_HIGH_WORD.test(source)) return 'high';
    if (PRIO_MED_WORD.test(source)) return 'med';
    if (PRIO_LOW_WORD.test(source)) return 'low';
    return 'med';
}

function detectTime(source) {
    const tm = source.match(TIME_RE);
    if (!tm) return null;
    let h = +tm[1];
    const m = tm[2] ? +tm[2] : 0;
    const ap = (tm[3] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    if (h > 23) h = h % 24;
    return { hour: h, minute: m, phrase: tm[0] };
}

function detectDay(source) {
    if (/day\s+after\s+tomorrow/.test(source)) return { offset: 2, phrase: 'day after tomorrow', weekday: null };
    if (/\btomorrow\b/.test(source)) return { offset: 1, phrase: 'tomorrow', weekday: null };
    if (/\btonight\b/.test(source)) return { offset: 0, phrase: 'tonight', weekday: null };
    if (/\btoday\b/.test(source)) return { offset: 0, phrase: 'today', weekday: null };
    const dm = source.match(/\bin\s+(\d{1,3})\s+days?\b/);
    if (dm) return { offset: +dm[1], phrase: dm[0], weekday: null };
    for (let i = 0; i < DAYS.length; i++) {
        if (new RegExp('\\b' + DAYS[i] + '\\b').test(source)) {
            return { offset: null, phrase: DAYS[i], weekday: DAYS[i] };
        }
    }
    return null;
}

function detectExplicitDate(source) {
    const dm = source.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (dm) {
        let day = +dm[1], month = +dm[2];
        if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const now = new Date();
            let year = now.getFullYear();
            const d = new Date(year, month - 1, day);
            if (d < new Date(year, now.getMonth(), now.getDate())) year += 1;
            return { date: ymd(new Date(year, month - 1, day)), phrase: dm[0] };
        }
    }
    const mp = source.match(new RegExp('\\b(' + MONTHS.join('|') + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b'));
    if (mp) {
        const month = MONTHS.indexOf(mp[1]) + 1;
        const day = +mp[2];
        if (day >= 1 && day <= 31) {
            const now = new Date();
            let year = now.getFullYear();
            const d = new Date(year, month - 1, day);
            if (d < new Date(year, now.getMonth(), now.getDate())) year += 1;
            return { date: ymd(new Date(year, month - 1, day)), phrase: mp[0] };
        }
    }
    return null;
}

function parseSpeech(statement) {
    const source = ' ' + String(statement).toLowerCase().replace(/[.!?]+/g, ' ') + ' ';
    const priority = detectPriority(source);
    const time = detectTime(source);
    const day = detectDay(source);
    const explicit = detectExplicitDate(source);

    let dueDate = null;
    if (explicit) dueDate = explicit.date;
    else if (day && day.offset !== null) dueDate = ymd(new Date(Date.now() + day.offset * 86400000));
    else if (day && day.weekday) {
        const now = new Date();
        const target = DAYS.indexOf(day.weekday);
        let diff = (target - now.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        dueDate = ymd(d);
    }

    if (time && !dueDate) dueDate = ymd(new Date());

    let reminderISO = null;
    if (time && dueDate) {
        reminderISO = dueDate + 'T' + pad(time.hour) + ':' + pad(time.minute) + ':00';
    }

    let title = source;
    if (time) title = title.replace(new RegExp(regexEscape(time.phrase), 'g'), ' ');
    if (explicit) title = title.replace(new RegExp(regexEscape(explicit.phrase), 'g'), ' ');
    title = title
        .replace(/day\s+after\s+tomorrow/g, ' ')
        .replace(/\btomorrow\b/g, ' ')
        .replace(/\btonight\b/g, ' ')
        .replace(/\btoday\b/g, ' ')
        .replace(/\bin\s+\d{1,3}\s+days?\b/g, ' ')
        .replace(/\bthis\s+week\b/g, ' ')
        .replace(/\bthis\b/g, ' ');
    if (day && day.weekday) {
        title = title.replace(new RegExp('\\b' + day.weekday + '\\b', 'g'), ' ');
    }
    title = title
        .replace(/\b(high|medium|low)\s+priority\b/g, ' ')
        .replace(/\b(high|urgent|asap|immediate|important|medium|moderate|normal|low|whenever|by|at|around|before)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^(on|at|by|for|the|with|this|and)\b\s*/gi, '')
        .replace(/\s+(on|at|by|for|the|with|this|and)\b\s*$/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/^[,;\s]+|[,;\s]+$/g, ' ');

    title = title.trim();
    if (title) title = title.charAt(0).toUpperCase() + title.slice(1);

    return { title: title, priority: priority, dueDate: dueDate, reminderISO: reminderISO };
}

module.exports = { matchesSearch: matchesSearch, classifyTask: classifyTask, parseSpeech: parseSpeech };
