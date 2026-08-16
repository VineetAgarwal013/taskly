const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const MODEL = 'gemini-3.5-flash';

const env = loadEnv();
const API_KEY = env.GEMINI_API_KEY || '';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

function loadEnv() {
    const out = {};
    try {
        const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
        text.split(/\r?\n/).forEach(function (line) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        });
    } catch (e) { }
    return out;
}

function serveStatic(req, res) {
    let pathname = decodeURIComponent(req.url.split('?')[0]);
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.resolve(path.join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    fs.readFile(filePath, function (err, data) {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    });
}

function extractJSON(text) {
    const unboxed = function (s) {
        const cleaned = String(s).replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        for (let i = 0; i < 6; i++) {
            try { return JSON.parse(cleaned.slice(0, cleaned.length - i)); } catch (e) { }
        }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end > start) {
            const sub = cleaned.slice(start, end + 1);
            for (let i = 0; i < 6; i++) {
                try { return JSON.parse(sub.slice(0, sub.length - i)); } catch (e) { }
            }
        }
        throw new Error('could not extract JSON');
    };
    try { return unboxed(text); } catch (err) {
        throw new Error('Could not parse Gemini response: ' + err.message);
    }
}

function geminiClassify(text, categories) {
    return new Promise(function (resolve, reject) {
        const d = new Date();
        const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        const prompt = [
            'You are Taskly, a smart task manager assistant. Analyze the user task statement and answer with ONLY valid JSON, no markdown, no commentary.',
            '',
            'Today\'s date is ' + today + ' (use this as the reference for "today", "tomorrow", weekdays, etc.).',
            '',
            'User statement: "' + text + '"',
            '',
            'Available task categories: ' + JSON.stringify(categories),
            '',
            'Return JSON exactly in this shape:',
            '{"title":"clean task title without time/date/priority words","priority":"high|med|low","dueDate":"YYYY-MM-DD or null (deadline mentioned, e.g. today, tomorrow, in N days, this friday, august 20)","reminder":"ISO datetime YYYY-MM-DDTHH:MM:00 or null (only when an explicit time is given)","category":"best fit from the available categories"}',
            '',
            'Rules: priority defaults to "med" if not mentioned. If no date is mentioned, dueDate is null. If no time is mentioned, reminder is null.'
        ].join('\n');

        const payload = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.2,
                maxOutputTokens: 1024,
                thinkingConfig: { thinkingBudget: 0 }
            }
        });

        const req = https.request({
            hostname: 'generativelanguage.googleapis.com',
            path: '/v1beta/models/' + MODEL + ':generateContent',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': API_KEY,
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 20000
        }, function (res) {
            let body = '';
            res.on('data', function (c) { body += c; });
            res.on('end', function () {
                if (res.statusCode !== 200) {
                    reject(new Error('Gemini HTTP ' + res.statusCode + ': ' + body.slice(0, 300)));
                    return;
                }
                try {
                    const parsed = JSON.parse(body);
                    const partText = parsed.candidates && parsed.candidates[0] &&
                        parsed.candidates[0].content && parsed.candidates[0].content.parts &&
                        parsed.candidates[0].content.parts[0] ? parsed.candidates[0].content.parts[0].text : '';
                    resolve(extractJSON(partText));
                } catch (e) {
                    reject(new Error('Could not parse Gemini response: ' + e.message));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', function () {
            req.destroy();
            reject(new Error('Gemini request timed out'));
        });
        req.write(payload);
        req.end();
    });
}

function handleClassify(req, res) {
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
        if (!API_KEY) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'missing_key', message: 'Add your GEMINI_API_KEY to the .env file and restart the server.' }));
            return;
        }
        let input;
        try {
            input = JSON.parse(body || '{}');
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'bad_request' }));
            return;
        }
        const text = String(input.text || '').trim();
        const categories = Array.isArray(input.categories) && input.categories.length
            ? input.categories
            : ['Items to Buy', 'Chores / Job Hunt', 'Homework'];
        if (text.length < 3) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'text_too_short' }));
            return;
        }
        geminiClassify(text, categories).then(function (result) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result: result }));
        }).catch(function (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'gemini_error', message: String(err.message || err) }));
        });
    });
}

http.createServer(function (req, res) {
    if (req.method === 'POST' && req.url.split('?')[0] === '/api/classify') {
        handleClassify(req, res);
        return;
    }
    serveStatic(req, res);
}).listen(PORT, function () {
    console.log('Taskly running at http://localhost:' + PORT);
    console.log(API_KEY ? 'Gemini API: key loaded' : 'Gemini API: WARNING - add GEMINI_API_KEY to .env');
});