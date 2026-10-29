/* Vercel serverless function: /api/classify
   Deployed automatically by Vercel when this file lives in api/.
   Reads the Gemini key from the GEMINI_API_KEY environment variable
   (set it in the Vercel dashboard — never in the repo). */
const Gemini = require('./_gemini.js');

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
        Gemini.classify(text, categories, { apiKey: process.env.GEMINI_API_KEY }).then(function (result) {
            res.status(200).json({ ok: true, result: result });
        }).catch(function (err) {
            res.status(200).json({ ok: false, error: 'gemini_error', message: String(err.message || err) });
        });
    });
};
