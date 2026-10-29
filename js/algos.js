/* Taskly algorithms — works in the browser (window.TasklyAlgos) and in Node
   (module.exports) so bench/ can A/B test them against the originals.
   - compileSearch: multi-word search over title, description, category, tip
   - classifyLocal: offline bucketing (keyword groups + learned from tasks)
   - parseSpeech:   priority / due date / reminder / clean title from text */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.TasklyAlgos = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    function normalize(s) {
        return String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    }

    /* ==================== Search ==================== */

    /* Every query word must appear somewhere in the task (any order), so
       "buy seeds" finds "Sesame seeds" in "Items to Buy". Words of 3+
       letters also match mid-word ("pods" → "Airpods"); 1–2 letter words
       must start a word, so typing "a" doesn't match nearly everything. */
    const hayCache = new WeakMap();

    /* Normalized text per task, recomputed only when the task's text changes. */
    function haystack(t) {
        const raw = t.title + '\u0000' + (t.description || '') + '\u0000' + (t.category || '') + '\u0000' + (t.tip || '');
        const hit = hayCache.get(t);
        if (hit && hit.raw === raw) return hit.hay;
        const hay = normalize(raw);
        hayCache.set(t, { raw: raw, hay: hay });
        return hay;
    }

    function compileSearch(query) {
        const tokens = normalize(query).split(' ').filter(Boolean).map(function (w) {
            return w.length < 3 ? ' ' + w : w;
        });
        if (!tokens.length) return function () { return true; };
        return function (t) {
            const hay = ' ' + haystack(t);
            for (let i = 0; i < tokens.length; i++) {
                if (hay.indexOf(tokens[i]) === -1) return false;
            }
            return true;
        };
    }

    /* ==================== Bucketing ==================== */

    const STOP = new Set(('a an the to for of on in at by with and or my me i is it this that from up about ' +
        'get do go make new some out off into our your his her their be am are was will can need want ' +
        'pick take put set start finish complete before after next today tomorrow').split(' '));

    /* Keyword groups. A category is linked to a group when its name
       contains one of the group's aliases ("Items to Buy" → grocery +
       shopping, "Home" → chores), so renamed categories still work. */
    const GROUPS = [
        {
            aliases: ['grocery', 'food', 'buy', 'shopping', 'shop', 'item'],
            words: 'milk bread egg banana apple chicken rice lentil oil olive coffee bean cereal fruit vegetable yogurt ' +
                'cheese butter flour sugar spinach meat fish snack juice tea pasta onion tomato potato beef salt almond seed'
        },
        {
            aliases: ['buy', 'shopping', 'shop', 'item', 'purchase', 'store', 'order'],
            words: 'buy purchase order charger cable headphone laptop phone stand shoe ink printer towel toothpaste ' +
                'sunscreen shampoo soap card gift birthday battery'
        },
        {
            aliases: ['homework', 'school', 'study', 'class', 'course', 'college', 'university', 'assignment', 'academic'],
            words: 'homework assignment study class lecture exam midterm final quiz essay chapter read reading math ' +
                'calculus physics chemistry biology history accounting lab project register colloquium course ' +
                'professor syllabus thesis semester problem'
        },
        {
            aliases: ['job', 'career', 'hunt', 'internship'],
            words: 'apply application resume cv interview recruiter internship job linkedin offer cover networking referral'
        },
        {
            aliases: ['chore', 'home', 'house', 'household', 'errand', 'admin'],
            words: 'laundry clean dish trash garbage vacuum mow lawn fix repair bill pay rent landlord bank transfer ' +
                'dentist doctor appointment renew license wifi remove cancel membership call filter bulb garden plant'
        },
        {
            aliases: ['work', 'office', 'business', 'client'],
            words: 'meeting standup report invoice client manager deadline slide presentation review pull request ' +
                'deploy sprint quarterly team colleague boss spreadsheet'
        },
        {
            aliases: ['fitness', 'gym', 'health', 'exercise', 'workout', 'sport'],
            words: 'gym workout run jog swim lap yoga stretch lift squat cardio spin 5k 10k hike training pushup plank'
        }
    ].map(function (g) {
        return { aliases: g.aliases, words: new Set(g.words.split(' ')) };
    });

    function stem(w) {
        if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
        if (w.length > 4 && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
        if (w.length > 3 && /s$/.test(w) && !/(ss|us)$/.test(w)) return w.slice(0, -1);
        return w;
    }

    function keywords(text) {
        return normalize(text).split(' ').filter(function (w) {
            return w.length > 1 && !STOP.has(w);
        }).map(stem);
    }

    /* Scores each category: +3 per word of its own name, +2 per keyword of a
       linked group, +1 per word already used by a task in that category.
       No signal at all → first category (the original default). */
    function classifyLocal(text, categories, tasks) {
        if (!categories || !categories.length) return null;
        const words = keywords(text);
        let best = categories[0];
        let bestScore = 0;
        categories.forEach(function (cat) {
            const nameWords = new Set(keywords(cat));
            const groups = GROUPS.filter(function (g) {
                return g.aliases.some(function (a) { return nameWords.has(a); });
            });
            const learned = new Set();
            (tasks || []).forEach(function (t) {
                if (t.category === cat) keywords(t.title + ' ' + (t.description || '')).forEach(function (w) { learned.add(w); });
            });
            let score = 0;
            words.forEach(function (w) {
                if (nameWords.has(w)) score += 3;
                if (groups.some(function (g) { return g.words.has(w); })) score += 2;
                if (learned.has(w)) score += 1;
            });
            if (score > bestScore) { best = cat; bestScore = score; }
        });
        return best;
    }

    /* ==================== Speech / quick-add parsing ==================== */

    const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const LEAD = '(?:\\b(?:by|at|around|before|on|due|for)\\s+)?';

    const PRIORITY_RULES = [
        { re: /\b(?:top|high|highest)\s+priority\b|\bpriority\s+high\b/, priority: 'high' },
        { re: /\b(?:low|lowest)\s+priority\b|\bpriority\s+low\b/, priority: 'low' },
        { re: /\b(?:medium|normal|moderate)\s+priority\b|\bpriority\s+medium\b/, priority: 'med' },
        { re: /\b(?:urgent|urgently|asap|immediately)\b/, priority: 'high' },
        { re: /\b(?:whenever|no rush)\b/, priority: 'low' },
        { re: /\bimportant\b/, priority: 'high', keep: true }
    ];

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function ymd(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    /* Calendar-day offset; immune to daylight-saving shifts. */
    function plusDays(now, n) {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    }

    /* A month/day with no year means the next occurrence of it. */
    function upcoming(now, month, day) {
        /* Reject impossible dates (2/30, 4/31) instead of letting Date roll
           them into the next month. Feb 29 is allowed. */
        if (day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return null;
        const today = plusDays(now, 0);
        let d = new Date(now.getFullYear(), month - 1, day);
        if (d < today) d = new Date(now.getFullYear() + 1, month - 1, day);
        return d;
    }

    function parseSpeech(statement, nowArg) {
        const now = nowArg ? new Date(nowArg) : new Date();
        const src = ' ' + String(statement).toLowerCase().replace(/[!?,;]+|\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ') + ' ';
        const cuts = [];
        const take = function (m) { if (m) cuts.push([m.index, m.index + m[0].length]); return m; };

        let priority = 'med';
        let priorityDetected = false;
        for (let i = 0; i < PRIORITY_RULES.length; i++) {
            const m = src.match(PRIORITY_RULES[i].re);
            if (m) {
                priority = PRIORITY_RULES[i].priority;
                priorityDetected = true;
                if (!PRIORITY_RULES[i].keep) take(m);
                break;
            }
        }

        /* Time: "5pm", "at 3:30 pm", "noon", or a bare "at 4" / "by 9 tonight"
           (bare 1-7 → afternoon/evening, 8-11 → morning). */
        let time = null;
        let m = take(src.match(new RegExp(LEAD + '\\b(\\d{1,2})(?::(\\d{2}))?\\s*([ap])\\.?m\\.?(?=\\s)')));
        if (m) {
            let h = +m[1] % 12;
            if (m[3] === 'p') h += 12;
            time = { hour: h, minute: m[2] ? +m[2] : 0 };
        } else if ((m = take(src.match(new RegExp(LEAD + '\\b(noon|midnight)\\b'))))) {
            time = { hour: m[1] === 'noon' ? 12 : 0, minute: 0 };
        } else if ((m = take(src.match(/\b(?:by|at|around|before)\s+(\d{1,2})(?::(\d{2}))?(?:\s+(tonight|in the evening|in the morning))?(?=\s)(?!\s*(?:days?|weeks?|minutes?|hours?|mins?|hrs?)\b)/)))) {
            let h = +m[1];
            if (h <= 23) {
                if (m[3] === 'in the morning') { if (h === 12) h = 0; }
                else if (m[3]) { if (h < 12) h += 12; }
                else if (h >= 1 && h <= 7) h += 12;
                time = { hour: h, minute: m[2] ? +m[2] : 0 };
            }
        }

        /* Date: explicit (US month/day, month name) wins over relative words. */
        let due = null;
        let badDate = false;
        m = take(src.match(new RegExp(LEAD + '\\b(\\d{1,2})[\\/\\-](\\d{1,2})\\b')));
        if (m) {
            let month = +m[1], day = +m[2];
            if (month > 12 && day <= 12) { const t = month; month = day; day = t; }
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) due = upcoming(now, month, day);
            badDate = !due;
        }
        if (!due) {
            m = take(src.match(new RegExp(LEAD + '\\b(' + MONTHS.join('|') + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b')));
            if (m && +m[2] >= 1 && +m[2] <= 31) due = upcoming(now, MONTHS.indexOf(m[1]) + 1, +m[2]);
            if (m) badDate = !due;
        }
        const rel = [
            [new RegExp(LEAD + '\\bday after tomorrow\\b'), function () { return 2; }],
            [new RegExp(LEAD + '\\btomorrow\\b'), function () { return 1; }],
            [new RegExp(LEAD + '\\b(?:today|tonight)\\b'), function () { return 0; }],
            [/\bin\s+(\d{1,3}|a|one)\s+days?\b/, function (x) { return /^\d/.test(x[1]) ? +x[1] : 1; }],
            [/\b(?:in\s+(?:a|one)\s+week|next\s+week)\b/, function () { return 7; }]
        ];
        for (let i = 0; i < rel.length; i++) {
            const r = src.match(rel[i][0]);
            if (r) {
                take(r);
                if (!due) due = plusDays(now, rel[i][1](r));
                break;
            }
        }
        m = src.match(new RegExp('(?:\\b(?:by|on|due|for|this|next)\\s+)?\\b(' + DAYS.join('|') + ')\\b'));
        if (m) {
            take(m);
            if (!due) {
                let diff = (DAYS.indexOf(m[1]) - now.getDay() + 7) % 7;
                if (diff === 0) diff = 7;
                due = plusDays(now, diff);
            }
        }

        /* A time alone means today — unless the date said was impossible. */
        const dueDate = due ? ymd(due) : (time && !badDate ? ymd(now) : null);
        const reminderISO = time && dueDate ? dueDate + 'T' + pad(time.hour) + ':' + pad(time.minute) + ':00' : null;

        let title = src.split('');
        cuts.forEach(function (c) { for (let i = c[0]; i < c[1]; i++) title[i] = ' '; });
        title = title.join('')
            .replace(/\s+/g, ' ')
            .replace(/^\s*(?:on|at|by|due|and|for)\b\s*/i, '')
            .replace(/\s+(?:on|at|by|for|the|with|this|and|due)\s*$/i, '')
            .trim();
        if (title) title = title.charAt(0).toUpperCase() + title.slice(1);

        return { title: title, priority: priority, priorityDetected: priorityDetected, dueDate: dueDate, reminderISO: reminderISO };
    }

    return {
        normalize: normalize,
        compileSearch: compileSearch,
        classifyLocal: classifyLocal,
        parseSpeech: parseSpeech
    };
}));
