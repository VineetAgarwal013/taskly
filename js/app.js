(function () {
    const $ = function (id) { return document.getElementById(id); };
    const DB = window.TasklyDB;
    const ICS = window.TasklyICS;
    const Voice = window.TasklyVoice;
    const Algos = window.TasklyAlgos;

    const state = {
        user: null,
        tasks: [],
        categories: [],
        pendingPriority: 'med',
        filter: null,
        search: '',
        sidebarCollapsed: false,
        customDate: null,
        customTime: null,
        catArchive: {},
        catSort: {},
        ai: { active: false, category: null, priority: null, dueDate: null, reminderISO: null }
    };

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const PRIO_LABEL = { high: '!!!', med: '!!', low: '!', none: '' };
    const PRIO_PILL = {
        high: 'border-red-500/30 bg-red-500/15 text-red-400',
        med: 'border-orange-500/30 bg-orange-500/15 text-orange-400',
        low: 'border-yellow-500/30 bg-yellow-500/15 text-yellow-400'
    };
    const DAY_MS = 2 * 24 * 60 * 60 * 1000;

    let micListening = false;
    let openMenu = null;
    let addingCat = false;
    let reminderOn = false;

    /* Ordered promise chain so SQLite saves never race each other. */
    let saveQueue = Promise.resolve();
    let shortcutsSeen = localStorage.getItem('taskly_shortcuts_seen') === 'true';

    /* Reminder pill toggle: keeps a boolean and reflects it on the button
       (default off-state styling lives in the HTML; these classes swap on). */
    const REMINDER_ON_CLASSES = ['border-blue-500', 'bg-blue-50', 'text-blue-600', 'font-semibold', 'shadow-sm', 'dark:border-blue-500/50', 'dark:bg-blue-950/40', 'dark:text-blue-400'];
    const REMINDER_OFF_CLASSES = ['border-slate-200', 'bg-slate-50', 'text-slate-600', 'font-medium', 'dark:border-white/10', 'dark:bg-zinc-800/50', 'dark:text-zinc-400'];

    function setReminderOn(on) {
        reminderOn = !!on;
        const btn = $('reminder-toggle');
        if (!btn) return;
        REMINDER_ON_CLASSES.forEach(function (c) { btn.classList.toggle(c, reminderOn); });
        REMINDER_OFF_CLASSES.forEach(function (c) { btn.classList.toggle(c, !reminderOn); });
        btn.setAttribute('aria-pressed', String(reminderOn));
        btn.textContent = reminderOn ? '🔔 Remind me: ON' : '🔔 Remind me';
        btn.title = 'Generates .ics file for Outlook, Apple, & Google Calendar' + (reminderOn ? ' (on)' : '');
    }

    function ymd(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function todayStr() {
        return ymd(new Date());
    }

    function addDays(n) {
        const d = new Date();
        d.setDate(d.getDate() + n);
        return ymd(d);
    }

    function fmtShort(ymd) {
        if (!ymd) return '';
        const parts = ymd.split('-').map(Number);
        return MONTHS[parts[1] - 1] + ' ' + parts[2];
    }

    function timeLabel(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        let h = d.getHours();
        const ap = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap;
    }

    function dueBadge(due) {
        if (!due) return null;
        const today = todayStr();
        if (due < today) return { label: 'Overdue', cls: 'overdue' };
        if (due === today) return { label: 'Today', cls: 'today' };
        if (due === addDays(1)) return { label: 'Tomorrow', cls: 'tomorrow' };
        return { label: fmtShort(due), cls: 'due' };
    }

    function prioWeight(p) {
        const w = { high: 0, med: 1, low: 2, none: 3 }[p];
        return w !== undefined ? w : 1;
    }

    function sortTasks(list, mode) {
        const sortBy = mode || 'due';
        return list.slice().sort(function (a, b) {
            let ka, kb;
            if (sortBy === 'priority') { ka = prioWeight(a.priority); kb = prioWeight(b.priority); }
            else if (sortBy === 'created') { ka = a.createdAt || ''; kb = b.createdAt || ''; }
            else { ka = a.dueDate || '9999-12-31'; kb = b.dueDate || '9999-12-31'; }
            if (ka !== kb) return ka < kb ? -1 : 1;
            const pw = prioWeight(a.priority) - prioWeight(b.priority);
            if (pw) return pw;
            return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
        });
    }

    /* Compiled once per query (see Algos.compileSearch): every word must
       match title, description, category, or tip, in any order. */
    let searchFn = null, searchFor = null;
    function matchesSearch(t) {
        if (!state.search) return true;
        if (searchFor !== state.search) { searchFn = Algos.compileSearch(state.search); searchFor = state.search; }
        return searchFn(t);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function makeId() {
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    }

    function showToast(msg) {
        const el = $('toast');
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(showToast._t);
        showToast._t = setTimeout(function () { el.hidden = true; }, 3500);
    }

    function setAIStatus(text, kind) {
        const el = $('ai-status');
        if (!text) { el.hidden = true; el.className = 'ai-status'; return; }
        el.textContent = text;
        el.className = 'ai-status ' + (kind || '');
        el.hidden = false;
    }

    function clearAIState() {
        state.ai = { active: false, category: null, priority: null, dueDate: null, reminderISO: null };
        highlightAITarget(null);
    }

    function highlightAITarget(category) {
        Array.prototype.forEach.call(document.querySelectorAll('.column'), function (col) {
            col.classList.toggle('ai-target', !!category && col.dataset.category === category);
        });
    }

    async function aiClassify(text) {
        if (window.location.protocol === 'file:') return null;
        try {
            const res = await fetch('/api/classify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, categories: state.categories })
            });
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    function sanitizeAIPriority(p) {
        return { high: 'high', med: 'med', low: 'low' }[String(p || '').toLowerCase()] || null;
    }

    function sanitizeAIDate(d) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : null;
    }

    function sanitizeAIReminder(r) {
        const s = String(r || '');
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s : null;
    }

    function setCustomOptionLabel() {
        const opt = $('deadline-select').querySelector('option[value="custom"]');
        if (!opt) return;
        if (state.customDate) {
            let label = '📅 ' + fmtShort(state.customDate);
            if (state.customTime) label += ' · ' + state.customTime;
            opt.textContent = label;
        } else {
            opt.textContent = '📅 Custom Date…';
        }
    }

    function applyAIFormUI() {
        const ai = state.ai;
        if (!ai.active) return;
        if (ai.priority) {
            state.pendingPriority = ai.priority;
            Array.prototype.forEach.call($('prio-group').querySelectorAll('.prio-btn'), function (b) {
                b.classList.toggle('active', b.dataset.priority === ai.priority);
            });
        }
        if (ai.dueDate) {
            if (ai.dueDate === addDays(0)) {
                $('deadline-select').value = 'today';
            } else if (ai.dueDate === addDays(1)) {
                $('deadline-select').value = 'tomorrow';
            } else {
                $('deadline-select').value = 'custom';
                state.customDate = ai.dueDate;
                state.customTime = null;
                setCustomOptionLabel();
            }
        }
        if (ai.category && state.categories.indexOf(ai.category) !== -1) {
            $('category-select').value = ai.category;
        }
        setReminderOn(!!ai.reminderISO);
        highlightAITarget(ai.category);
    }

    function aiSummary(r) {
        const parts = [];
        parts.push(r.category || 'task');
        parts.push((PRIO_LABEL[r.priority] || 'no') + ' priority');
        if (r.dueDate) parts.push('due ' + fmtShort(r.dueDate) + (r.dueDate === todayStr() ? ' (Today)' : ''));
        if (r.reminder) parts.push('⏰ ' + timeLabel(r.reminder));
        return '🎯 ' + parts.join(' · ');
    }

    /* Recent successful AI results, keyed by text + categories. */
    const aiCache = new Map();
    let aiSeq = 0;

    async function runAIClassify(text) {
        const seq = ++aiSeq;
        const key = text + '\u0000' + state.categories.join('\u0000');
        setAIStatus('Detecting…', 'busy');
        highlightAITarget(null);
        const data = aiCache.has(key) ? aiCache.get(key) : await aiClassify(text);
        /* A newer keystroke started another request — drop this stale one. */
        if (seq !== aiSeq || $('task-input').value.trim() !== text) return;
        if (!data || !data.ok || !data.result || !data.result.title) {
            applyLocalParse(text);
            return;
        }
        aiCache.set(key, data);
        if (aiCache.size > 50) aiCache.delete(aiCache.keys().next().value);
        const r = data.result;
        state.ai = {
            active: true,
            text: text,
            title: String(r.title).trim(),
            category: state.categories.indexOf(r.category) !== -1 ? r.category : null,
            priority: sanitizeAIPriority(r.priority) || state.pendingPriority,
            dueDate: sanitizeAIDate(r.dueDate),
            reminderISO: sanitizeAIReminder(r.reminder)
        };
        applyAIFormUI();
        setAIStatus(aiSummary({ ...state.ai, title: r.title }), 'ok');
    }

    /* Offline fallback: the local parser fills the same fields the AI would. */
    function applyLocalParse(text) {
        const p = Algos.parseSpeech(text);
        state.ai = {
            active: true,
            text: text,
            title: p.title,
            category: classifyTask(p.title || text),
            priority: p.priorityDetected ? p.priority : state.pendingPriority,
            dueDate: p.dueDate,
            reminderISO: p.reminderISO
        };
        applyAIFormUI();
        setAIStatus(aiSummary(state.ai) + ' (offline keywords)', 'off');
    }

    let aiTimer = null;
    function bindAIDetection() {
        $('task-input').addEventListener('input', function () {
            const text = this.value.trim();
            clearTimeout(aiTimer);
            if (text.length < 8) {
                clearAIState();
                setAIStatus(null);
                return;
            }
            aiTimer = setTimeout(function () { runAIClassify(text); }, 600);
        });
    }

    function saveState() {
        const payload = {
            categories: state.categories,
            tasks: state.tasks,
            settings: {
                theme: document.documentElement.getAttribute('data-theme') || 'dark',
                sidebar_collapsed: state.sidebarCollapsed,
                shortcuts_seen: shortcutsSeen,
                catArchive: state.catArchive,
                catSort: state.catSort
            }
        };
        saveQueue = saveQueue.catch(function () { }).then(function () { return DB.saveState(payload); });
        return saveQueue;
    }

    function purgeOldArchived() {
        const cutoff = Date.now() - DAY_MS;
        const before = state.tasks.length;
        state.tasks = state.tasks.filter(function (t) {
            return !(t.archived && t.completedAt && t.completedAt < cutoff);
        });
        if (state.tasks.length !== before) saveState();
    }

    function classifyTask(text) {
        return Algos.classifyLocal(text, state.categories, state.tasks);
    }

    function addTask(opts) {
        const task = {
            id: opts.id || makeId(),
            title: opts.title,
            description: opts.description || '',
            category: opts.category,
            priority: opts.priority || 'med',
            createdDate: todayStr(),
            createdAt: new Date().toISOString(),
            dueDate: opts.dueDate || null,
            reminder: opts.reminderISO || null,
            completed: false,
            completedAt: null,
            archived: false,
            tip: opts.tip || ''
        };
        state.tasks.push(task);
        saveState();
        renderAll();
        return task;
    }

    function closeAllMenus() {
        if (openMenu) {
            openMenu.remove();
            openMenu = null;
        }
        /* Hide every inline priority popover (click-away / Escape / menu switch) */
        document.querySelectorAll('.prio-pop').forEach(function (p) {
            p.classList.add('hidden');
            p.classList.remove('flex');
        });
    }

    /* Click-to-edit via contenteditable: toggles the attribute on the existing
       element (never swaps DOM), so long titles wrap naturally with identical
       typography and no clipping/horizontal scroll. Enter or blur commits
       (commit(value)), Escape reverts to the original text (commit(null)).
       The caller's commit callback is responsible for re-rendering. */
    function startInlineEdit(el, value, commit) {
        if (el.isContentEditable) return;
        const EDIT_CLASSES = ['outline-none', 'ring-2', 'ring-blue-500/40', 'dark:ring-blue-400/40', 'rounded', 'px-1', '-mx-1', 'bg-slate-100/50', 'dark:bg-white/5'];
        let done = false;
        const finish = function (commitIt) {
            if (done) return;
            done = true;
            const text = commitIt
                ? String(el.textContent || '').replace(/\s*\n\s*/g, ' ').trim()
                : value;
            el.contentEditable = 'false';
            el.spellcheck = false;
            EDIT_CLASSES.forEach(function (c) { el.classList.remove(c); });
            el.blur();
            commit(commitIt ? text : null);
        };
        const onKeydown = function (e) {
            /* Intercept every key so app shortcuts / board keys stay quiet */
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        };
        el.contentEditable = 'true';
        el.spellcheck = false;
        EDIT_CLASSES.forEach(function (c) { el.classList.add(c); });
        el.addEventListener('keydown', onKeydown);
        el.addEventListener('blur', function () { finish(true); });
        el.focus();
        /* Place the caret at the end of the text instead of selecting it all */
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function buildCard(task) {
        const card = document.createElement('div');
        /* Compact card: dynamic height so long titles wrap instead of
           truncating; checkbox pinned to the first text line. */
        card.className = 'task-card group relative flex h-auto min-h-[44px] cursor-grab select-none items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition-colors hover:bg-slate-50 dark:border-white/5 dark:bg-[#1c1c1f] dark:hover:bg-white/5 ' +
            (task.archived ? 'line-through opacity-50' : '');
        card.draggable = !task.archived;
        card.dataset.id = task.id;

        const badge = dueBadge(task.dueDate);
        const prio = PRIO_LABEL[task.priority];
        const prioPill = PRIO_PILL[task.priority];
        const duePill = badge ? ({
            overdue: 'border-red-500/30 bg-red-500/15 text-red-400',
            today: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
            tomorrow: 'border-sky-500/30 bg-sky-500/15 text-sky-400',
            due: 'border-[var(--border)] bg-[var(--surface-strong)] text-[var(--sub)]'
        })[badge.cls] : '';

        card.innerHTML =
            '<input type="checkbox" class="checkbox mt-0.5 shrink-0 cursor-pointer" ' + (task.completed ? 'checked' : '') + '>' +
            /* Full titles always visible: wrap to multiple lines, never ellipsis */
            '<div class="min-w-0 flex-1 whitespace-normal break-words text-sm font-medium leading-snug ' + (task.archived ? 'text-[var(--sub)]' : 'text-[var(--text)]') + '" data-edit="title" title="Click to edit">' + escapeHtml(task.title) + '</div>' +
            '<div class="flex shrink-0 items-center gap-1.5">' +
                /* Interactive priority badge: click to open the priority popover */
                '<span class="relative shrink-0">' +
                    '<button type="button" class="prio-badge cursor-pointer rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-transform hover:scale-105 ' + (prioPill || 'border-[var(--border)] bg-[var(--surface-strong)] text-[var(--sub)]') + '" data-prio="' + task.priority + '" title="Change priority">' + (prio || '—') + '</button>' +
                    (task.archived ? '' :
                    '<div class="prio-pop absolute right-0 top-full z-50 mt-1 hidden min-w-[120px] flex-col gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 dark:border-white/10 dark:bg-[#252529]">' +
                        '<button type="button" class="prio-opt flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10" data-prio="high"><span class="font-bold text-red-500">!!!</span> High' + (task.priority === 'high' ? '<span class="prio-check ml-auto text-[#007AFF]">✓</span>' : '') + '</button>' +
                        '<button type="button" class="prio-opt flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10" data-prio="med"><span class="font-bold text-amber-500">!!</span> Medium' + (task.priority === 'med' ? '<span class="prio-check ml-auto text-[#007AFF]">✓</span>' : '') + '</button>' +
                        '<button type="button" class="prio-opt flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10" data-prio="low"><span class="font-bold text-yellow-400">!</span> Low' + (task.priority === 'low' ? '<span class="prio-check ml-auto text-[#007AFF]">✓</span>' : '') + '</button>' +
                        '<button type="button" class="prio-opt flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10" data-prio="none"><span class="text-slate-400 dark:text-zinc-500">None</span>' + (task.priority === 'none' ? '<span class="prio-check ml-auto text-[#007AFF]">✓</span>' : '') + '</button>' +
                    '</div>') +
                '</span>' +
                (badge ? '<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' + duePill + '">' + escapeHtml(badge.label) + (badge.cls === 'due' ? ' · ' + escapeHtml(fmtShort(task.dueDate)) : '') + '</span>' : '') +
                (task.reminder ? '<span class="text-[11px] text-[var(--sub)]" title="Reminder">🔔</span>' : '') +
            '</div>' +
            '<div class="pointer-events-none flex shrink-0 items-center gap-1">' +
                '<button type="button" class="card-del pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md text-sm text-[var(--sub)] opacity-0 transition hover:bg-red-500/10 hover:text-[var(--danger)] group-hover:opacity-100" title="Delete task">×</button>' +
            '</div>';

        card.querySelector('.checkbox').addEventListener('change', function (e) {
            if (e.target.checked) {
                /* Apple Reminders pattern:
                   1. Immediate feedback — spring-filled checkbox + strikethrough.
                   2. Hold for 400ms so the completion registers.
                   3. Smooth collapse-out, then commit to Archive + Undo toast. */
                card.querySelector('[data-edit="title"]').classList.add('line-through', 'text-slate-400', 'dark:text-zinc-500');
                setTimeout(function () {
                    card.classList.add('task-exiting');
                    setTimeout(function () {
                        task.completed = true;
                        task.archived = true;
                        task.completedAt = Date.now();
                        saveState();
                        renderAll();
                        showUndoToast(task);
                    }, 300);
                }, 400);
            } else {
                task.completed = false;
                task.archived = false;
                task.completedAt = null;
                saveState();
                renderAll();
            }
        });

        /* Click-to-edit: task title inline (pencil icon or text click). */
        card.querySelector('[data-edit="title"]').addEventListener('click', function (e) {
            if (task.archived) return;
            e.stopPropagation();
            startInlineEdit(e.currentTarget, task.title, function (v) {
                const val = String(v || '').trim();
                if (val && val !== task.title) { task.title = val; saveState(); }
                renderAll();
            });
        });

        /* Interactive priority badge: opens the popover, selection updates the
           task in place (no full re-render) and re-marks the active option. */
        const badgeBtn = card.querySelector('.prio-badge');
        const prioPop = card.querySelector('.prio-pop');
        if (badgeBtn && prioPop) {
            badgeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!prioPop.classList.contains('hidden')) { closeAllMenus(); return; }
                closeAllMenus();
                prioPop.classList.remove('hidden');
                prioPop.classList.add('flex');
            });
            const PRIO_BADGE_BASE = 'prio-badge cursor-pointer rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-transform hover:scale-105 ';
            prioPop.querySelectorAll('.prio-opt').forEach(function (opt) {
                opt.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const p = opt.dataset.prio;
                    task.priority = p;
                    saveState();
                    badgeBtn.dataset.prio = p;
                    badgeBtn.textContent = PRIO_LABEL[p] || '—';
                    badgeBtn.className = PRIO_BADGE_BASE + (PRIO_PILL[p] || 'border-[var(--border)] bg-[var(--surface-strong)] text-[var(--sub)]');
                    prioPop.querySelectorAll('.prio-opt').forEach(function (o) {
                        const mark = o.querySelector('.prio-check');
                        if (mark) mark.remove();
                        if (o.dataset.prio === p) o.insertAdjacentHTML('beforeend', '<span class="prio-check text-[#007AFF]">✓</span>');
                    });
                    closeAllMenus();
                });
            });
        }

        card.querySelector('.card-del').addEventListener('click', function () {
            state.tasks = state.tasks.filter(function (t) { return t.id !== task.id; });
            saveState();
            renderAll();
        });

        card.addEventListener('dragstart', function (e) {
            if (e.target.isContentEditable) { e.preventDefault(); return; }
            card.classList.add('dragging');
            e.dataTransfer.setData('text/plain', task.id);
        });
        card.addEventListener('dragend', function () { card.classList.remove('dragging'); });

        return card;
    }

    function buildMiniItem(task) {
        const item = document.createElement('div');
        item.className = 'mini-item flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 py-2';
        item.innerHTML =
            '<input type="checkbox" class="checkbox shrink-0 cursor-pointer accent-[#007AFF]">' +
            '<span class="min-w-0 flex-1 whitespace-normal break-words text-[13px] text-[var(--text)]" data-edit="title" title="Click to edit">' + escapeHtml(task.title) + '</span>' +
            '<span class="rounded-md border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-400">' + escapeHtml(dueBadge(task.dueDate).label) + '</span>' +
            (PRIO_PILL[task.priority] ? '<span class="rounded-md border px-1.5 py-0.5 text-[10px] font-bold ' + PRIO_PILL[task.priority] + '">' + (PRIO_LABEL[task.priority] || '') + '</span>' : '') +
            '<button class="delete-btn ml-1 text-[var(--sub)] transition hover:text-[var(--danger)]" title="Delete">×</button>';

        item.querySelector('.checkbox').addEventListener('change', function (e) {
            if (e.target.checked) {
                task.completed = true;
                task.archived = true;
                task.completedAt = Date.now();
                saveState();
                renderAll();
            }
        });
        item.querySelector('span[data-edit="title"]').addEventListener('click', function (e) {
            e.stopPropagation();
            startInlineEdit(e.currentTarget, task.title, function (v) {
                const val = String(v || '').trim();
                if (val && val !== task.title) { task.title = val; saveState(); }
                renderAll();
            });
        });
        item.querySelector('.delete-btn').addEventListener('click', function () {
            state.tasks = state.tasks.filter(function (t) { return t.id !== task.id; });
            saveState();
            renderAll();
        });
        return item;
    }

    function openColumnMenu(col, cat) {
        closeAllMenus();
        const sort = state.catSort[cat] || 'due';
        const menu = document.createElement('div');
        menu.className = 'col-menu absolute right-0 top-12 z-30 w-52 rounded-xl border border-[var(--border)] bg-[var(--menu-bg)] p-1.5 shadow-2xl backdrop-blur-xl';
        menu.innerHTML =
            '<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--sub)]">Sort by</div>' +
            '<button type="button" class="menu-item" data-sort="due">🗓️ Due date' + (sort === 'due' ? '<span class="ml-auto text-[#007AFF]">✓</span>' : '') + '</button>' +
            '<button type="button" class="menu-item" data-sort="priority">⚡ Priority' + (sort === 'priority' ? '<span class="ml-auto text-[#007AFF]">✓</span>' : '') + '</button>' +
            '<button type="button" class="menu-item" data-sort="created">🕐 Created' + (sort === 'created' ? '<span class="ml-auto text-[#007AFF]">✓</span>' : '') + '</button>' +
            '<div class="my-1 h-px bg-[var(--border)]"></div>' +
            '<button type="button" class="menu-item clear-item text-[var(--danger)] hover:bg-red-500/10">🧹 Clear completed</button>';

        Array.prototype.forEach.call(menu.querySelectorAll('[data-sort]'), function (b) {
            b.addEventListener('click', function () {
                state.catSort[cat] = b.dataset.sort;
                renderAll();
            });
        });
        menu.querySelector('.clear-item').addEventListener('click', function () {
            if (!confirm('Delete all completed tasks in “' + cat + '”?')) return;
            state.tasks = state.tasks.filter(function (t) { return !(t.category === cat && t.archived); });
            saveState();
            renderAll();
        });

        col.appendChild(menu);
        openMenu = menu;
    }

    function renderColumns() {
        const board = $('board');
        board.innerHTML = '';

        const cats = state.filter
            ? state.categories.filter(function (c) { return c === state.filter; })
            : state.categories;

        let visible = 0;
        cats.forEach(function (cat) {
            const col = document.createElement('div');
            col.className = 'column relative flex w-[330px] min-w-0 max-h-[62vh] flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg shadow-black/10 backdrop-blur';
            col.dataset.category = cat;

            const active = sortTasks(state.tasks.filter(function (t) {
                return t.category === cat && !t.archived && matchesSearch(t);
            }), state.catSort[cat]);
            /* Completed/archived tasks are excluded while searching. */
            const archived = state.search ? [] : state.tasks.filter(function (t) {
                return t.category === cat && t.archived && matchesSearch(t);
            });

            /* During a search, hide columns that have zero matching tasks. */
            if (state.search && active.length === 0) return;
            visible++;

            const total = active.length + archived.length;
            const pct = total ? Math.round(archived.length / total * 100) : 0;
            const showDone = !!state.catArchive[cat];

            col.innerHTML =
                '<div class="mb-3 shrink-0">' +
                    '<div class="flex items-center gap-2">' +
                        '<h3 class="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--text)]">' + escapeHtml(cat) + '</h3>' +
                        '<span class="whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface-strong)] px-2 py-0.5 text-[11px] text-[var(--sub)]">' + active.length + ' tasks</span>' +
                        '<button type="button" class="col-menu-btn flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-strong)] text-[var(--sub)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--text)]" title="Column options">⋮</button>' +
                    '</div>' +
                    '<div class="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">' +
                        '<div class="h-full rounded-full bg-gradient-to-r from-[#007AFF] to-emerald-400 transition-all duration-500" style="width:' + pct + '%"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="task-list flex flex-1 flex-col gap-2 overflow-y-auto pr-1"></div>';

            const listEl = col.querySelector('.task-list');
            /* Click the category name in the column header to rename inline. */
            col.querySelector('h3').addEventListener('click', function (e) {
                e.stopPropagation();
                startInlineEdit(e.currentTarget, cat, function (v) { commitRename(cat, v); });
            });
            active.forEach(function (task) { listEl.appendChild(buildCard(task)); });

            if (active.length === 0) {
                const drop = document.createElement('button');
                drop.type = 'button';
                drop.className = 'drop-zone mt-2 w-full cursor-pointer rounded-xl border-2 border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--sub)] transition hover:border-[#007AFF]/60 hover:bg-[#007AFF]/5 hover:text-[#007AFF]';
                drop.textContent = '+ Drag task here or click to add';
                drop.addEventListener('click', function () {
                    $('category-select').value = cat;
                    $('task-input').focus();
                });
                col.appendChild(drop);
            }

            /* Inline "Show completed" divider at the bottom of the column */
            if (archived.length) {
                const divider = document.createElement('button');
                divider.type = 'button';
                divider.className = 'done-divider mt-3 w-full cursor-pointer select-none border-t border-dashed border-[var(--border)] pt-2 pb-1 text-center text-[10px] font-semibold tracking-wide text-[var(--sub)] opacity-70 transition hover:opacity-100';
                divider.textContent = showDone
                    ? '--- Hide completed ^ ---'
                    : '--- Show completed (' + archived.length + ') ∨ ---';
                divider.addEventListener('click', function () {
                    state.catArchive[cat] = !state.catArchive[cat];
                    renderAll();
                });
                col.appendChild(divider);
            }

            /* Completed items expand below the divider, dimmed + struck through */
            if (showDone && archived.length) {
                const doneList = document.createElement('div');
                doneList.className = 'completed-list mt-2 flex max-h-[30vh] shrink-0 flex-col gap-2 overflow-y-auto';
                archived.slice().reverse().forEach(function (task) { doneList.appendChild(buildCard(task)); });
                col.appendChild(doneList);
            }

            col.querySelector('.col-menu-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                if (openMenu && openMenu.classList.contains('col-menu')) closeAllMenus();
                else openColumnMenu(col, cat);
            });

            col.addEventListener('dragover', function (e) {
                e.preventDefault();
                col.classList.add('drag-over');
            });
            col.addEventListener('dragleave', function () { col.classList.remove('drag-over'); });
            col.addEventListener('drop', function (e) {
                e.preventDefault();
                col.classList.remove('drag-over');
                const taskId = e.dataTransfer.getData('text/plain');
                const task = state.tasks.find(function (t) { return t.id === taskId; });
                if (task && task.category !== cat) {
                    task.category = cat;
                    saveState();
                    renderAll();
                }
            });

            board.appendChild(col);
        });

        /* Search with zero visible columns → friendly empty state. */
        if (state.search && visible === 0) {
            board.innerHTML = '<div class="w-full py-16 text-center text-sm text-[var(--sub)]">No tasks match “' + escapeHtml(state.search) + '”</div>';
        }
    }

    function renderOverdue() {
        const section = $('overdue-section');
        const list = $('overdue-list');
        const overdue = sortTasks(state.tasks.filter(function (t) {
            return !t.archived && t.dueDate && t.dueDate < todayStr() && matchesSearch(t);
        }));
        section.hidden = overdue.length === 0;
        list.innerHTML = '';
        overdue.forEach(function (task) { list.appendChild(buildMiniItem(task)); });
    }

    function buildSidebarRow(opts) {
        const row = document.createElement('div');
        row.className = 'sidebar-row group relative flex cursor-pointer select-none items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-sm text-[var(--text)] transition hover:bg-[var(--surface-strong)]' +
            (opts.active ? ' active' : '');
        row.title = opts.label;
        row.innerHTML =
            '<span class="side-emoji shrink-0 text-sm">' + opts.emoji + '</span>' +
            '<span class="side-tip">' + escapeHtml(opts.label) + '</span>' +
            '<span class="side-label min-w-0 flex-1 truncate"' + (opts.editable ? ' title="Click to rename"' : '') + '>' + escapeHtml(opts.label) + '</span>' +
            '<span class="side-count shrink-0 rounded-full bg-[var(--surface-strong)] px-2 py-0.5 text-[11px] text-[var(--sub)]">' + opts.count + '</span>';
        if (opts.onClick) row.addEventListener('click', opts.onClick);
        /* Clicking the category name itself renames it inline (no popup). */
        if (opts.editable && opts.onEdit) {
            row.querySelector('.side-label').addEventListener('click', function (e) {
                e.stopPropagation();
                opts.onEdit(this);
            });
        }
        return row;
    }

    function deleteCategory(cat) {
        if (state.categories.length <= 1) {
            showToast('You must keep at least one category');
            return;
        }
        if (!confirm('Delete category “' + cat + '”? Its tasks move to “' + state.categories[0] + '”.')) return;
        state.tasks.forEach(function (t) { if (t.category === cat) t.category = state.categories[0]; });
        state.categories.splice(state.categories.indexOf(cat), 1);
        delete state.catArchive[cat];
        delete state.catSort[cat];
        if (state.filter === cat) state.filter = null;
        saveState();
        renderAll();
    }

    function commitAddCategory(name) {
        const v = String(name || '').trim();
        addingCat = false;
        if (!v) { renderSidebar(); return; }
        if (state.categories.indexOf(v) !== -1) {
            showToast('Category already exists');
            renderSidebar();
            return;
        }
        state.categories.push(v);
        saveState();
        renderAll();
    }

    function buildAddCatRow() {
        const wrap = document.createElement('div');
        wrap.className = 'shrink-0';
        if (addingCat) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'field w-full';
            input.placeholder = 'New category name…';
            input.maxLength = 40;
            input.autocomplete = 'off';
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') commitAddCategory(input.value);
                else if (e.key === 'Escape') { addingCat = false; renderSidebar(); }
            });
            input.addEventListener('blur', function () {
                if (addingCat) { addingCat = false; renderSidebar(); }
            });
            wrap.appendChild(input);
            setTimeout(function () { input.focus(); }, 0);
        } else {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'add-cat-btn flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2 text-sm text-[var(--sub)] transition hover:border-[#007AFF]/60 hover:bg-[#007AFF]/5 hover:text-[#007AFF]';
            btn.textContent = '+ Add Category';
            btn.addEventListener('click', function () { addingCat = true; renderSidebar(); });
            wrap.appendChild(btn);
        }
        return wrap;
    }

    function commitRename(oldName, newName) {
        const v = String(newName || '').trim();
        if (!v || v === oldName) { renderSidebar(); return; }
        if (state.categories.indexOf(v) !== -1) {
            showToast('Category already exists');
            renderSidebar();
            return;
        }
        const idx = state.categories.indexOf(oldName);
        if (idx === -1) { renderSidebar(); return; }
        state.categories[idx] = v;
        state.tasks.forEach(function (t) { if (t.category === oldName) t.category = v; });
        if (state.catArchive[oldName] !== undefined) {
            state.catArchive[v] = state.catArchive[oldName];
            delete state.catArchive[oldName];
        }
        if (state.catSort[oldName] !== undefined) {
            state.catSort[v] = state.catSort[oldName];
            delete state.catSort[oldName];
        }
        if (state.filter === oldName) state.filter = v;
        saveState();
        renderAll();
    }

    function renderSidebar() {
        const list = $('sidebar-list');
        list.innerHTML = '';
        const totalActive = state.tasks.filter(function (t) { return !t.archived; }).length;

        const allRow = buildSidebarRow({
            emoji: '🗂️',
            label: 'All tasks',
            count: totalActive,
            active: state.filter === null,
            onClick: function () { state.filter = null; renderAll(); }
        });
        list.appendChild(allRow);

        state.categories.forEach(function (cat) {
            const n = state.tasks.filter(function (t) { return t.category === cat && !t.archived; }).length;
            const row = buildSidebarRow({
                emoji: '📁',
                label: cat,
                count: n,
                active: state.filter === cat,
                editable: true,
                onEdit: function (label) {
                    startInlineEdit(label, cat, function (v) { commitRename(cat, v); });
                },
                onClick: function () { state.filter = cat; renderAll(); }
            });
            /* Single minimal hover action: delete (×) only. */
            row.innerHTML +=
                '<span class="side-actions absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--card)] p-0.5 opacity-0 transition-opacity group-hover:opacity-100">' +
                    '<button type="button" class="side-del-btn flex h-5 w-5 items-center justify-center rounded text-[var(--sub)] hover:text-[var(--danger)]" title="Delete category">×</button>' +
                '</span>';
            row.querySelector('.side-del-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                deleteCategory(cat);
            });
            list.appendChild(row);
        });

        list.appendChild(buildAddCatRow());
    }

    function renderCategorySelect() {
        const sel = $('category-select');
        const current = sel.value;
        sel.innerHTML = '<option value="">✨ Auto (AI Bucketer)</option>' + state.categories.map(function (c) {
            return '<option value="' + escapeHtml(c) + '">📁 ' + escapeHtml(c) + '</option>';
        }).join('');
        if (state.categories.indexOf(current) !== -1) sel.value = current;
    }

    function renderAll() {
        renderSidebar();
        renderColumns();
        renderOverdue();
        renderCategorySelect();
        setCustomOptionLabel();
        highlightAITarget(state.ai.active ? state.ai.category : null);
        $('search-kbd').classList.toggle('hidden', !!state.search);
        $('search-clear').classList.toggle('hidden', !state.search);
        $('search-clear').classList.toggle('flex', !!state.search);
    }

    function resolveDueDate() {
        const v = $('deadline-select').value;
        if (v === 'today') return addDays(0);
        if (v === 'tomorrow') return addDays(1);
        if (v === 'custom') return state.customDate;
        return null;
    }

    function submitNewTask(title, opts) {
        const ai = state.ai;
        /* Use the cleaned title ("Buy milk", not "buy milk tomorrow 5pm")
           when the detection ran on exactly this text. */
        if (ai.active && ai.text === title && ai.title) title = ai.title;
        const due = opts.dueDate !== undefined
            ? opts.dueDate
            : (ai.active && ai.dueDate ? ai.dueDate : resolveDueDate());
        let reminderISO = opts.reminderISO !== undefined ? opts.reminderISO : null;
        if (reminderISO === null) {
            if (ai.active && ai.reminderISO) reminderISO = ai.reminderISO;
            else if (reminderOn) {
                if ($('deadline-select').value === 'custom' && state.customTime) {
                    reminderISO = state.customDate + 'T' + state.customTime + ':00';
                } else {
                    reminderISO = due ? due + 'T09:00:00' : todayStr() + 'T18:00:00';
                }
            }
        }
        const priority = opts.priority || (ai.active && ai.priority ? ai.priority : state.pendingPriority);
        const catSelect = $('category-select').value;
        const category = opts.category || (catSelect ? catSelect : (ai.active && ai.category ? ai.category : classifyTask(title)));

        const task = addTask({
            title: title,
            category: category,
            priority: priority,
            dueDate: due,
            reminderISO: reminderISO
        });

        if (reminderISO) {
            const file = 'taskly-reminder-' + Date.now() + '.ics';
            ICS.downloadICS(file, ICS.makeICS({
                title: task.title,
                description: task.description || 'Reminder from Taskly AI',
                date: new Date(reminderISO)
            }));
            showToast('Added, and reminder .ics file downloaded — import it into Google Calendar / Outlook');
        }
        clearAIState();
        setAIStatus(null);
        return task;
    }

    function openApp(user, data) {
        state.user = user;
        state.categories = data.categories && data.categories.length ? data.categories : ['Items to Buy', 'Chores / Job Hunt', 'Homework'];
        state.tasks = data.tasks || [];
        const settings = data.settings || {};
        state.catArchive = settings.catArchive || {};
        state.catSort = settings.catSort || {};
        shortcutsSeen = settings.shortcuts_seen === true || settings.shortcuts_seen === 'true';
        if (settings.theme) applyTheme(settings.theme);
        let collapsed = settings.sidebar_collapsed;
        if (collapsed === undefined) {
            const saved = localStorage.getItem('sidebar_collapsed');
            collapsed = saved === '1' || (saved === null && window.innerWidth < 768);
        }
        setSidebarCollapsed(!!collapsed);
        state.search = '';
        $('search-input').value = '';
        $('user-avatar').textContent = (user[0] || '?').toUpperCase();
        $('user-name').textContent = user;
        $('user-drop-name').textContent = user;
        $('login-overlay').hidden = true;
        $('landing').hidden = true;
        document.body.classList.remove('landing-mode');
        $('app').hidden = false;
        purgeOldArchived();
        renderAll();
        initShortcuts();
    }

    /* Logged out: back to the landing page, auth modal closed. */
    function showLogin() {
        $('landing').hidden = false;
        document.body.classList.add('landing-mode');
        $('app').hidden = true;
        closeAuthModal();
    }

    function switchTab(tab) {
        const loginActive = tab === 'login';
        $('tab-login').classList.toggle('active', loginActive);
        $('tab-register').classList.toggle('active', !loginActive);
        $('login-form').hidden = !loginActive;
        $('register-form').hidden = loginActive;
        $('login-error').textContent = '';
        $('reg-error').textContent = '';
    }

    /* Landing tabs: Product (home) / Project Story / Evals.
       #story and #evals deep-link. */
    function showLandingTab(name) {
        $('landing-home').hidden = name !== 'home';
        $('landing-story').hidden = name !== 'story';
        $('landing-evals').hidden = name !== 'evals';
        Array.prototype.forEach.call(document.querySelectorAll('.landing-tab'), function (b) {
            const on = b.dataset.landingTab === name;
            b.classList.toggle('bg-blue-50', on);
            b.classList.toggle('text-blue-600', on);
            b.classList.toggle('text-slate-500', !on);
        });
    }

    function initLandingTabs() {
        const go = function (name) {
            showLandingTab(name);
            history.replaceState(null, '', name === 'home' ? location.pathname : '#' + name);
            window.scrollTo(0, 0);
        };
        Array.prototype.forEach.call(document.querySelectorAll('.landing-tab'), function (b) {
            b.addEventListener('click', function () { go(b.dataset.landingTab); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-goto-tab]'), function (a) {
            a.addEventListener('click', function (e) { e.preventDefault(); go(a.dataset.gotoTab); });
        });
        const hash = location.hash.slice(1);
        showLandingTab(hash === 'story' || hash === 'evals' ? hash : 'home');
    }

    function initLogin() {
        initLandingTabs();
        /* Landing CTA buttons open the auth modal */
        $('landing-signin').addEventListener('click', openAuthModal);
        $('landing-cta').addEventListener('click', openAuthModal);
        $('auth-close').addEventListener('click', closeAuthModal);
        $('login-overlay').addEventListener('click', function (e) {
            if (e.target === this) closeAuthModal();
        });

        $('tab-login').addEventListener('click', function () { switchTab('login'); });
        $('tab-register').addEventListener('click', function () { switchTab('register'); });

        $('login-form').addEventListener('submit', function (e) {
            e.preventDefault();
            const username = $('login-user').value.trim();
            const password = $('login-pass').value;
            if (!username || !password) {
                $('login-error').textContent = 'Enter username and password';
                return;
            }
            DB.login(username, password).then(function (res) {
                if (!res.ok) {
                    $('login-error').textContent = res.error || 'Login failed — is the server running?';
                    return;
                }
                openApp(res.user, res.data);
            });
        });

        $('register-form').addEventListener('submit', function (e) {
            e.preventDefault();
            const username = $('reg-user').value.trim();
            const password = $('reg-pass').value;
            const confirm = $('reg-confirm').value;
            if (!username || !password) {
                $('reg-error').textContent = 'Enter username and password';
                return;
            }
            if (password !== confirm) {
                $('reg-error').textContent = 'Passwords do not match';
                return;
            }
            DB.register(username, password).then(function (res) {
                if (!res.ok) {
                    $('reg-error').textContent = res.error || 'Registration failed — is the server running?';
                    return;
                }
                openApp(res.user, res.data);
            });
        });
    }

    function initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        applyTheme(savedTheme);
        $('theme-toggle').addEventListener('click', function () {
            const current = document.documentElement.getAttribute('data-theme');
            applyTheme(current === 'light' ? 'dark' : 'light');
        });
    }

    /* Sets both the CSS-variable theme and the Tailwind `dark:` class. */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
        updateThemeUI(theme);
        if (state.user) saveState();
    }

    function updateThemeUI(theme) {
        if (theme === 'dark') {
            $('theme-icon').textContent = '☀️';
            $('theme-text').textContent = 'Light';
        } else {
            $('theme-icon').textContent = '🌙';
            $('theme-text').textContent = 'Dark';
        }
    }

    /* ---------- Landing page / auth modal ---------- */

    function openAuthModal() {
        $('login-overlay').hidden = false;
    }

    function closeAuthModal() {
        $('login-overlay').hidden = true;
    }

    /* Shortcut pill: prominent onboarding callout on the first visit (fades
       after 5s or on the first interaction, then sets the flag so it never
       shows prominently again), afterwards a faint bottom-right inline pill.
       The flag lives in SQLite settings (with a localStorage fallback). */
    function initShortcuts() {
        const pill = $('shortcut-pill');
        const seen = shortcutsSeen;

        if (!seen) {
            pill.classList.add('pill-onboarding');
            pill.hidden = false;
            requestAnimationFrame(function () { pill.classList.add('pill-show'); });

            const dismiss = function () {
                pill.classList.remove('pill-show');
                pill.hidden = true;
                shortcutsSeen = true;
                localStorage.setItem('taskly_shortcuts_seen', 'true');
                if (state.user) saveState();
                document.removeEventListener('keydown', onInteract);
                document.removeEventListener('pointerdown', onInteract);
            };
            const onInteract = function () { clearTimeout(timer); dismiss(); };
            const timer = setTimeout(onInteract, 5000);
            document.addEventListener('keydown', onInteract);
            document.addEventListener('pointerdown', onInteract);
        } else {
            pill.classList.add('pill-subtle');
            pill.hidden = false;
        }
    }

    /* ---------- Undo toast (single completion OR batch clear) ---------- */

    let undoAction = null;

    function showUndo(msg, action, ms) {
        undoAction = action;
        $('undo-toast-msg').textContent = msg;
        const t = $('undo-toast');
        t.classList.remove('hidden');
        t.classList.add('flex');
        clearTimeout(showUndo._t);
        showUndo._t = setTimeout(hideUndoToast, ms);
    }

    function showUndoToast(task) {
        showUndo('Task completed', { kind: 'complete', task: task }, 6000);
    }

    /* Batch undo for the clear-finished action: keeps each removed task's
       original index so Undo re-inserts them exactly where they were. */
    function showClearUndo(cleared) {
        const n = cleared.length;
        showUndo('Cleared ' + n + ' finished task' + (n > 1 ? 's' : ''), { kind: 'clear', cleared: cleared }, 4000);
    }

    function hideUndoToast() {
        undoAction = null;
        $('undo-toast').classList.add('hidden');
        $('undo-toast').classList.remove('flex');
    }

    function setSidebarCollapsed(collapsed) {
        state.sidebarCollapsed = collapsed;
        $('sidebar').classList.toggle('collapsed', collapsed);
        localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
        if (state.user) saveState();
    }

    function openCustomPopover() {
        $('custom-date-input').min = todayStr();
        $('custom-date-input').value = state.customDate || todayStr();
        $('custom-time-input').value = state.customTime || '';
        $('custom-popover').classList.remove('hidden');
        $('custom-popover').classList.add('flex');
        $('custom-date-input').focus();
    }

    function closeCustomPopover() {
        $('custom-popover').classList.add('hidden');
        $('custom-popover').classList.remove('flex');
    }

    function saveCustomPopover() {
        state.customDate = $('custom-date-input').value || null;
        state.customTime = $('custom-time-input').value || null;
        closeCustomPopover();
        if (!state.customDate) {
            $('deadline-select').value = '';
            setCustomOptionLabel();
            return;
        }
        $('deadline-select').value = 'custom';
        if (state.customTime) setReminderOn(true);
        setCustomOptionLabel();
    }

    function cancelCustomPopover() {
        closeCustomPopover();
        $('deadline-select').value = state.customDate ? 'custom' : '';
    }

    function initAddForm() {
        $('add-form').addEventListener('submit', function (e) {
            e.preventDefault();
            const input = $('task-input');
            const text = input.value.trim();
            if (!text) return;
            submitNewTask(text, {});
            input.value = '';
            $('deadline-select').value = '';
            state.customDate = null;
            state.customTime = null;
            setCustomOptionLabel();
            setReminderOn(false);
            $('category-select').value = '';
        });

        $('reminder-toggle').addEventListener('click', function () {
            setReminderOn(!reminderOn);
        });

        $('prio-group').addEventListener('click', function (e) {
            const btn = e.target.closest('.prio-btn');
            if (!btn) return;
            state.pendingPriority = btn.dataset.priority;
            Array.prototype.forEach.call($('prio-group').querySelectorAll('.prio-btn'), function (b) {
                b.classList.toggle('active', b === btn);
            });
        });

        $('deadline-select').addEventListener('change', function () {
            if (this.value === 'custom') openCustomPopover();
        });
        $('custom-ok').addEventListener('click', saveCustomPopover);
        $('custom-cancel').addEventListener('click', cancelCustomPopover);

        bindAIDetection();
    }

    function initVoice() {
        $('mic-btn').addEventListener('click', function () {
            if (!Voice.supported) {
                showToast('Voice input is not supported in this browser — try Chrome');
                return;
            }
            if (micListening) return;
            micListening = true;
            $('mic-btn').classList.add('listening');
            /* Review workflow: the transcript lands in the dock input for
               manual editing. Nothing is submitted — the user presses
               Enter or clicks Add when ready. */
            Voice.start(function (text) {
                micListening = false;
                $('mic-btn').classList.remove('listening');
                const input = $('task-input');
                input.value = text;
                input.focus();
                input.dispatchEvent(new Event('input'));
                showToast('🎤 Review the transcript, then press Enter or click Add');
            }, function () {
                micListening = false;
                $('mic-btn').classList.remove('listening');
            });
        });
    }

    /* Marks the active sidebar mode in the collapse/expand dropdown. */
    function updateSidebarDD() {
        const collapsed = state.sidebarCollapsed;
        $('dd-collapse').innerHTML = '📉 Collapse sidebar' + (collapsed ? ' <span class="ml-auto text-[#007AFF]">✓</span>' : '');
        $('dd-expand').innerHTML = '📈 Expand sidebar' + (!collapsed ? ' <span class="ml-auto text-[#007AFF]">✓</span>' : '');
    }

    function initModals() {
        /* Sidebar collapse/expand dropdown control */
        $('sidebar-toggle').addEventListener('click', function (e) {
            e.stopPropagation();
            updateSidebarDD();
            $('sidebar-dd').classList.toggle('hidden');
        });
        $('dd-collapse').addEventListener('click', function (e) {
            e.stopPropagation();
            $('sidebar-dd').classList.add('hidden');
            setSidebarCollapsed(true);
        });
        $('dd-expand').addEventListener('click', function (e) {
            e.stopPropagation();
            $('sidebar-dd').classList.add('hidden');
            setSidebarCollapsed(false);
        });

        /* Undo toast: restores the task to its active column instantly */
        $('undo-btn').addEventListener('click', function () {
            if (!undoAction) { hideUndoToast(); return; }
            if (undoAction.kind === 'complete') {
                const task = state.tasks.find(function (t) { return t.id === undoAction.task.id; });
                if (task) {
                    task.completed = false;
                    task.archived = false;
                    task.completedAt = null;
                    saveState();
                    renderAll();
                }
            } else if (undoAction.kind === 'clear') {
                undoAction.cleared.slice().sort(function (a, b) { return a.index - b.index; })
                    .forEach(function (entry) {
                        state.tasks.splice(Math.min(entry.index, state.tasks.length), 0, entry.task);
                    });
                saveState();
                renderAll();
            }
            hideUndoToast();
        });

        /* Clear finished: scoped to the active view (a selected column, or
           all columns when "All tasks" / no filter is active). */
        $('clear-finished-btn').addEventListener('click', function () {
            const cleared = [];
            state.tasks.forEach(function (t, i) {
                if (t.archived && (state.filter ? t.category === state.filter : true)) {
                    cleared.push({ index: i, task: t });
                }
            });
            if (!cleared.length) {
                showToast(state.filter ? 'No finished tasks in this column' : 'No finished tasks to clear');
                return;
            }
            cleared.slice().sort(function (a, b) { return b.index - a.index; })
                .forEach(function (entry) { state.tasks.splice(entry.index, 1); });
            saveState();
            renderAll();
            showClearUndo(cleared);
        });
    }

    function initSearch() {
        const input = $('search-input');
        let searchTimer = null;
        /* Re-render once typing pauses, not on every keystroke. */
        input.addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                state.search = input.value.trim();
                renderAll();
            }, 120);
        });
        $('search-clear').addEventListener('click', function () {
            input.value = '';
            state.search = '';
            renderAll();
            input.focus();
        });
    }

    function initUser() {
        $('user-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            $('user-dropdown').classList.toggle('hidden');
        });
        /* Sign out (header dropdown + left sidebar button) — clears the
           session, persists the current user's namespaced data, and returns
           to the landing page. */
        function signOut() {
            /* Flush the last save to SQLite before clearing the session */
            saveState().catch(function () { }).then(function () {
                DB.logout();
                showLogin();
                switchTab('login');
            });
        }
        $('logout-btn').addEventListener('click', signOut);
        $('sidebar-logout').addEventListener('click', signOut);
    }

    async function init() {
        initTheme();
        initLogin();
        initAddForm();
        initVoice();
        initModals();
        initSearch();
        initUser();

        const savedCollapsed = localStorage.getItem('sidebar_collapsed');
        setSidebarCollapsed(savedCollapsed === '1' || (savedCollapsed === null && window.innerWidth < 768));

        /* Resume the active session from SQLite (via the stored token) — the
           user's own isolated workspace loads straight away. */
        const session = await DB.restoreSession();
        if (session) {
            openApp(session.user, session.data);
        } else {
            showLogin();
            /* The server seeds the built-in Vineet account on first run */
            DB.bootstrap().then(function (meta) {
                switchTab(meta && meta.hasUsers ? 'login' : 'register');
            });
        }
    }

    document.addEventListener('click', function (e) {
        if (openMenu && !openMenu.contains(e.target) &&
            !e.target.closest('.col-menu-btn')) {
            closeAllMenus();
        }
        const dd = $('user-dropdown');
        if (!dd.classList.contains('hidden') && !e.target.closest('#user-btn') && !e.target.closest('#user-dropdown')) {
            dd.classList.add('hidden');
        }
        const sdd = $('sidebar-dd');
        if (!sdd.classList.contains('hidden') && !e.target.closest('#sidebar-toggle') && !e.target.closest('#sidebar-dd')) {
            sdd.classList.add('hidden');
        }
        const pop = $('custom-popover');
        if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !e.target.closest('#deadline-select')) {
            cancelCustomPopover();
        }
    });

    document.addEventListener('keydown', function (e) {
        const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) ||
            (document.activeElement && document.activeElement.isContentEditable);

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            $('search-input').focus();
            $('search-input').select();
            return;
        }
        if (e.key === 'Escape') {
            if (!$('login-overlay').hidden) { closeAuthModal(); return; }
            if (!$('custom-popover').classList.contains('hidden')) { cancelCustomPopover(); return; }
            closeAllMenus();
            $('user-dropdown').classList.add('hidden');
            if (state.search) {
                state.search = '';
                $('search-input').value = '';
                renderAll();
            }
            return;
        }
        if (!typing && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            $('task-input').focus();
        }
    });

    init();
})();