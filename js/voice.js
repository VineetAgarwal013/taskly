window.TasklyVoice = (function () {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    function start(onResult, onEnd) {
        if (!SR) return false;
        const rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.continuous = false;
        rec.onresult = function (e) {
            const text = e.results[0][0].transcript;
            if (onResult) onResult(text);
        };
        rec.onerror = function () { if (onEnd) onEnd(); };
        rec.onend = function () { if (onEnd) onEnd(); };
        try {
            rec.start();
            return true;
        } catch (e) {
            return false;
        }
    }

    /* The parser lives in js/algos.js (shared with bench/); voice transcripts
       reach it through the dock input's offline fallback in app.js. */
    return { supported: !!SR, start: start, parseSpeech: window.TasklyAlgos.parseSpeech };
})();
