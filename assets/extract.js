/* Toppers Copy — shared question-extraction heuristic.
   Pure, no dependencies. Runs both in the browser (assets/analyse.js feeds it
   text pulled from a PDF via pdf.js) and in Node (extract.js maintainer tool).

   Input : pages = [{ page: Number, lines: [String] }]   (or { page, text: String })
   Output: { questions: [{ page, question, marks, words }], count, method }

   It is a heuristic, not OCR/AI. Handwritten scans with no text layer yield nothing;
   printed question headers on each answer page extract reasonably well. A maintainer
   always reviews the result before it goes live. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.TC = root.TC || {}; root.TC.extract = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RX = {
    qnum:  /^(?:Q\s*\.?\s*(?:No\.?\s*)?|Question\s+)?(\d{1,2})\s*[.)]\s*(?=\S)/i,
    qcap:  /^Q\s*\.?\s*(?:No\.?\s*)?(\d{1,2})\b/i,
    marks: /\b(\d{1,3})\s*marks?\b/i,
    marksBr: /[\[(]\s*(\d{1,3})\s*(?:marks?|m)?\s*[\])]/i,
    words: /\b(?:answer\s+in\s+|within\s+|in\s+about\s+)?(\d{2,3})\s*words?\b/i,
    directive: /\b(discuss|examine|analyse|analyze|elucidate|evaluate|comment|critically|substantiate|illustrate|do you agree|to what extent|account for|bring out|how (?:far|does|do|did|has|have)|what (?:are|is|do|was|were)|why (?:is|are|do|did|has))\b/i,
    noise: /^(?:page\b|p\.?\s*\d|\d{1,3}\s*(?:of|\/)\s*\d{1,3}\b|www\.|https?:|©|copyright|all rights|for more|visit\b|download\b|t\.me|telegram|contact\b|scanned by|instagram|youtube|marks?\s*obtained|roll\s*no|q\.?\s*booklet|do not write|space for)/i,
    junk: /^[^A-Za-z0-9]{0,3}$/
  };

  function norm(s) { return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }

  function pickMeta(text) {
    var m = text.match(RX.marks) || text.match(RX.marksBr);
    var w = text.match(RX.words);
    return { marks: m ? m[1] : '', words: w ? w[1] : '' };
  }

  function questionText(blob) {
    blob = norm(blob).replace(RX.qnum, '').replace(RX.qcap, '').replace(/^[)\].,\s-]+/, '');
    // 1. end at the marks/words parenthetical if it sits near the end of a clause
    var mp = blob.match(/[\[(][^)\]]*\b\d{2,3}\s*(?:marks?|words?|M)\b[^)\]]*[\])]/i);
    if (mp && mp.index >= 20) return blob.slice(0, mp.index + mp[0].length).trim();
    // 2. end at the first question mark
    var q = blob.indexOf('?');
    if (q >= 20 && q < 500) return blob.slice(0, q + 1).trim();
    // 3. cut before an answer section begins
    var a = blob.search(/\b(Ans(?:wer)?\b|Introduction\b|Body\b|Conclusion\b|Solution\b)/i);
    if (a >= 25) return blob.slice(0, a).trim().replace(/[.,;:\s-]+$/, '');
    return blob.slice(0, 400).trim();
  }

  function looksLikeQuestion(line) {
    if (!line || RX.noise.test(line) || RX.junk.test(line)) return false;
    if (RX.qnum.test(line) || RX.qcap.test(line)) return true;
    return line.length > 28 && RX.directive.test(line.slice(0, 110));
  }

  function extractQuestions(pages) {
    var out = [], seen = {}, lastKey = '';

    function addQ(page, blob) {
      var qt = questionText(blob);
      if (qt.length < 18) return;
      var key = qt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
      if (!key || key === lastKey) { lastKey = key || lastKey; return; }
      lastKey = key;
      if (seen[key]) return;
      seen[key] = 1;
      var meta = pickMeta(blob);
      out.push({ page: page, question: qt, marks: meta.marks, words: meta.words });
    }

    (pages || []).forEach(function (pg) {
      var lines = (pg.lines || norm(pg.text || '').split(/\n+/)).map(norm).filter(Boolean);
      if (!lines.length) return;

      var markers = [];
      lines.forEach(function (l, i) { if (RX.qnum.test(l) || RX.qcap.test(l)) markers.push(i); });

      if (markers.length >= 3) {
        // a page that lists several questions (the question paper itself)
        markers.forEach(function (start, k) {
          var end = markers[k + 1] != null ? markers[k + 1] : Math.min(lines.length, start + 6);
          addQ(pg.page, lines.slice(start, end).join(' '));
        });
      } else {
        // a normal answer page: the printed question sits at the top
        var head = lines.slice(0, 7);
        for (var i = 0; i < head.length; i++) {
          if (looksLikeQuestion(head[i])) { addQ(pg.page, head.slice(i, i + 6).join(' ')); break; }
        }
      }
    });

    return { questions: out, count: out.length, method: out.length ? 'heuristic-v1' : 'none' };
  }

  function toCsvRows(questions, meta) {
    meta = meta || {};
    var esc = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var base = meta.url ? String(meta.url).split('#')[0] : '';
    return (questions || []).map(function (r) {
      var md = 'Type: question, Word limit: ' + (r.words || '') + ', Marks: ' + (r.marks || '');
      return [esc(meta.topper || ''), esc(meta.coaching || meta.source || ''), esc(meta.subject || meta.paper || ''),
        r.page, esc(r.question), esc(md), base ? base + '#page=' + r.page : ''].join(',');
    });
  }

  return { extractQuestions: extractQuestions, toCsvRows: toCsvRows, VERSION: 1 };
});
