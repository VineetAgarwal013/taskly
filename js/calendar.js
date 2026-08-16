window.TasklyICS = (function () {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function fmtDT(d) {
        return d.getFullYear() +
            pad(d.getMonth() + 1) +
            pad(d.getDate()) + 'T' +
            pad(d.getHours()) +
            pad(d.getMinutes()) + '00';
    }

    function escapeLine(s) {
        return String(s).replace(/[\\;,]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n');
    }

    function makeICS(opts) {
        const title = opts.title || 'Taskly task';
        const description = opts.description || '';
        const start = new Date(opts.date);
        const end = new Date(start.getTime() + (opts.durationMin || 60) * 60000);
        const uid = 'taskly-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '@taskly.local';

        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Taskly AI//Task Reminder//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            'UID:' + uid,
            'DTSTAMP:' + fmtDT(new Date()),
            'DTSTART:' + fmtDT(start),
            'DTEND:' + fmtDT(end),
            'SUMMARY:' + escapeLine(title),
            'DESCRIPTION:' + escapeLine(description),
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            'DESCRIPTION:Reminder: ' + escapeLine(title),
            'TRIGGER:-PT15M',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR'
        ];
        return lines.join('\r\n') + '\r\n';
    }

    function downloadICS(filename, content) {
        const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    return { makeICS: makeICS, downloadICS: downloadICS };
})();