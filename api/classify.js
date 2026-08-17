/* Vercel serverless function: /api/classify
   Deployed automatically by Vercel when this file lives in api/.
   Reads the Gemini key from the GEMINI_API_KEY environment variable
   (set it in the Vercel dashboard — never in the repo). */
const https = require('https');

const MODEL = process.env.MODEL_NAME || 'gemini-3.5-flash';

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
                'x-goog-api-key': process.env.GEMINI_API_KEY,
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

module.exports = function (req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'method_not_allowed' });
        return;
    }
    let body = '';
    req.on('data', function (c) {
        body += c;
        if (body.length > 1024 * 1024) { req.destroy(); }
    });
    req.on('end', function () {
        let input = {};
        try { input = JSON.parse(body || '{}'); } catch (e) { }
        if (!process.env.GEMINI_API_KEY) {
            res.status(200).json({ ok: false, error: 'missing_key', message: 'Set GEMINI_API_KEY in the Vercel environment variables.' });
            return;
        }
        const text = String(input.text || '').trim();
        const categories = Array.isArray(input.categories) && input.categories.length
            ? input.categories
            : ['Items to Buy', 'Chores / Job Hunt', 'Homework'];
        if (text.length < 3) {
            res.status(400).json({ ok: false, error: 'text_too_short' });
            return;
        }
        geminiClassify(text, categories).then(function (result) {
            res.status(200).json({ ok: true, result: result });
        }).catch(function (err) {
            res.status(200).json({ ok: false, error: 'gemini_error', message: String(err.message || err) });
        });
    });
};