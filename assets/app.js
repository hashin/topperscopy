/* Toppers Copy — static client. A free, open, community-built index of UPSC Mains topper answer copies. */
(function () {
  'use strict';

  var REPO = 'hashin/topperscopy';
  var GA_ID = 'G-VTL4V9JQBH'; // mirrored in index.html <head>
  var VOLUNTEER_EMAIL = 'mail@hashin.me';
  // Free, no-server delivery for the "Be a volunteer" form, via a Google Form you own.
  //  1. Make a Google Form with 4 short-answer questions IN THIS ORDER: Name, Phone, Email, Note
  //  2. Top-right menu (⋮) → "Get pre-filled link" → put anything in each box → "Get link" → Copy link
  //  3. Paste that whole URL below. Responses land in the form's linked sheet (turn on email
  //     notifications in the sheet: Tools → Notification settings). Nothing else to host.
  // Leave blank and the form falls back to the visitor's email app / clipboard.
  // Questions on the linked form, in order: Name, Phone, Email, Note.
  var VOLUNTEER_GFORM_PREFILL = 'https://docs.google.com/forms/d/e/1FAIpQLSdQuclzAeXv2NwFOY-a69lizKH0Z2RPvI7UZnX6YSTSfShBbA/viewform?usp=pp_url&entry.315186582=Name&entry.11599235=Phone&entry.1379505232=Email&entry.960606364=Note';
  var PAPERS = ['GS1', 'GS2', 'GS3', 'GS4', 'Essay', 'Other'];
  var OPTIONALS = ['Sociology', 'Anthropology', 'History', 'PSIR', 'Geography',
    'Public Administration', 'Philosophy', 'Psychology', 'Economics', 'Mathematics', 'Physics',
    'Chemistry', 'Commerce & Accountancy', 'Law', 'Management', 'Medical Science',
    'Agriculture', 'Statistics', 'Literature', 'Forest Service (IFS)', 'Other'];
  var PAGE = 25;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  // Every outbound copy/PDF link comes from data. A javascript:/data: URL in an href runs on
  // our own origin — anything that is not http(s) becomes an inert "#" (AUDIT B4).
  var safeHref = function (u) { return /^https?:\/\//i.test(String(u || '')) ? u : '#'; };
  var fmt = function (n) { return (n || 0).toLocaleString('en-IN'); };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, x = this; clearTimeout(t); t = setTimeout(function () { fn.apply(x, a); }, ms); }; };
  var SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

  var DB = null, TOPPERS = {}, OPTS = [];
  // Result of the most recent render: LASTLIST lets Show-more append without re-filtering
  // (AUDIT P4), LASTCOUNT lets the analytics handler report the count without running the
  // entire search a second time (AUDIT P5).
  var LASTLIST = null, LASTCOUNT = 0;
  // Audit R1, DECISION-13: copy id -> its currently-rendered <details.copy> element, so
  // renderBrowse() can reconcile instead of tearing the list down every keystroke.
  var CARDMAP = new Map();
  var QI = null, SYL = null, COPYBYID = {}, qiState = 'idle', qiPromise = null;
  // T3 (audit): question TEXT is split into its own file (qtext.json) from the meta that finds
  // and filters a question (qmeta.json, in QI). qtState/qtPromise track that fetch separately so
  // the syllabus filter, paper filter and Practice question-picking — all meta-only — don't wait
  // on ~780 KB of prose they don't need. PENDING_PRACTICE_TXT backfills a Practice card's question
  // line in place once the text lands, without re-picking the question or losing the streak bump.
  var qtState = 'idle', qtPromise = null, PENDING_PRACTICE_TXT = null;
  var state = {
    view: 'browse', q: '', mode: 'all', paper: 'all',
    topper: '', source: '', year: '', sort: 'best', shown: PAGE,
    qview: 'copies', syl: '', pp: '', psyl: '',
    optSubject: 'all', optQ: '', optShown: PAGE
  };

  var BAR = ['#09A1A1', '#F6C992', '#D396A6', '#5484A4', '#ACC0D3', '#30525C'];

  /* ---------- analytics ---------- */
  var VIEW_TITLE = {
    browse: 'Browse copies', optionals: 'Optional subjects', submit: 'Submit', about: 'About'
  };
  function ga() {
    return (typeof window.gtag === 'function') ? window.gtag
      : function () { (window.dataLayer = window.dataLayer || []).push(arguments); };
  }
  function track(name, params) {
    try { ga()('event', name, params || {}); } catch (e) {}
  }
  function pageView(view) {
    var path = '/' + (view === 'browse' ? '' : view);
    try {
      ga()('event', 'page_view', {
        page_title: 'Toppers Copy — ' + (VIEW_TITLE[view] || view),
        page_location: location.origin + path,
        page_path: path
      });
    } catch (e) {}
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'unknown'; } }

  /* ---------- lazy full-text data ----------
     boot loads data/index.json (copy metadata only, ~25 KB gz) for an instant first paint.
     The full data/copies.json (question text, ~2 MB gz) is fetched in the background and
     only blocks when the user actually searches or expands a copy. */
  var FULL = false, fullState = 'idle', fullPromise = null, QBYID = null;
  var practiceIntent = null;   // ?practice=<subject-slug> from an /optional/<slug>/ page
  // copies.json (format 2) stores a question as an id into data/qtext.json (split from
  // data/qmeta.json in T3) rather than repeating its text. QTEXT resolves those ids; QTEXTLC is
  // the same text lowercased once at load, so searching never re-lowercases 5.5 MB of strings on
  // every keystroke.
  var QTEXT = null, QTEXTLC = null, QVAR = null, QVARLC = null;
  // Phase 5 / E1 (DECISION-7, DECISION-12): the token-prefix inverted index, data/qindex.bin.
  // This is what actually FINDS a match now — QTEXT/QTEXTLC above are only needed to RENDER
  // the matched text (a card's snippet) and to verify an exact-phrase candidate. QIDX loads and
  // resolves independently of QTEXT, same two-independent-promises pattern as qmeta/qtext
  // (DECISION-10) — a search can return its real copy list and count before a single byte of
  // question prose has arrived.
  var QIDX = null, qxState = 'idle', qxPromise = null;
  var FALLBACK_USED = false, PHRASE_PENDING = false, LAST_QSCORE = null;

  function saveData() {
    var c = navigator.connection || {};
    return !!c.saveData || c.effectiveType === 'slow-2g' || c.effectiveType === '2g';
  }
  function scheduleFull() {
    // link-only copies live only in copies.json, so this is now core content, not just a search aid.
    // On metered / very slow links, hold off a bit longer but still fetch it in the background.
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
    if (saveData()) { setTimeout(function () { loadFull(); }, 6000); return; }
    idle(function () { loadFull(); }, { timeout: 4000 });
  }
  // The data files are cached independently — index.json is stale-while-revalidate in sw.js,
  // copies.json / qmeta.json / qtext.json are cache-first with a 7-day TTL on their own clocks —
  // so a returning visitor can hold a mismatched set. Ids are content-derived (Phase 4 / I1,
  // DECISION-5), so this is now harmless: an id that exists in one file either means the same
  // thing in every other file that ever mentions it, or doesn't exist there yet (a question too
  // new to be in a stale cached copies.json). No reconciliation needed — just fetch.
  function ensureFullPromise() { ensureFull(); return fullPromise || Promise.resolve(); }

  function loadFull() {
    if (fullPromise) return fullPromise;
    fullState = 'loading';
    fullPromise = fetch('data/copies.json').then(function (r) { return r.json(); }).then(function (d) {
      QBYID = {};
      DB.copies = DB.copies.filter(function (c) { return !c.stub; });  // drop name-search placeholders
      var known = {};
      DB.copies.forEach(function (c) { known[c.i] = c; });
      d.copies.forEach(function (c) {
        QBYID[c.i] = c.q || [];
        if (known[c.i]) {
          known[c.i].q = c.q || [];
        } else {
          // link-only copy — not in the lite boot index; add it in the same shape
          DB.copies.push({
            i: c.i, t: c.t, c: c.c, p: c.p, y: c.y, r: c.r, u: c.u,
            n: (c.q ? c.q.length : 0), q: c.q || [],
            k: c.link ? 1 : undefined, note: c.note || undefined
          });
        }
      });
      FULL = true; fullState = 'ready';
      indexCopies();
      refreshFacets();   // topper/source/year filters were built from the searchable core only
      var openIds = $$('#results .copy[open]').map(function (n) { return n.getAttribute('data-i'); });
      if (state.view === 'browse') renderBrowse(openIds);
      if ($('#practice').open) renderPractice();
      track('fulltext_loaded', {});
      return d;
    }).catch(function (e) {
      fullState = 'error'; fullPromise = null;
      track('data_error', { message: 'fulltext ' + String(e && e.message || e).slice(0, 100) });
      if (state.view === 'browse') renderBrowse();   // clear a stuck "Searching…" state
    });
    return fullPromise;
  }
  // fetch now (not on idle) the moment the user shows intent to search or read
  function ensureFull() { if (!FULL && fullState !== 'loading') loadFull(); }

  /* ---------- deduped question index (question-first view + Practice) ---------- */
  function indexCopies() { COPYBYID = {}; DB.copies.forEach(function (c) { COPYBYID[c.i] = c; }); }

  function loadQuestionIndex() {
    if (qiPromise) return qiPromise;
    qiState = 'loading';
    // Start the download NOW rather than after copies.json has landed and parsed — on slow 3G
    // that serialisation costs ~1.8s of dead air (T2). Ids are content-derived (Phase 4 / I1),
    // so qmeta.json's a:[[copyId, page]] refs need no reconciliation against copies.json — a
    // copyId either resolves through COPYBYID once copies.json has loaded, or doesn't yet (a
    // very recent copy not in a stale cached copies.json), never the wrong copy.
    var qJson = fetch('data/qmeta.json').then(function (r) { return r.json(); });
    var sJson = fetch('data/syllabus.json').then(function (r) { return r.json(); }).catch(function () { return null; });
    qiPromise = Promise.all([ensureFullPromise(), qJson, sJson]).then(function (parts) {
      QI = parts[1].questions || [];
      SYL = parts[2];
      qiState = 'ready';
      fillSyllabus();
      if (state.view === 'browse' && state.qview === 'questions') renderBrowse();
      if ($('#practice').open) fillPracticeSyl();
      track('question_index_loaded', { count: QI.length });
      return QI;
    }).catch(function (e) {
      qiState = 'error'; qiPromise = null;
      track('data_error', { message: 'qindex ' + String(e && e.message || e).slice(0, 100) });
      if (state.view === 'browse') renderBrowse();   // clear a stuck "Searching…" state
    });
    return qiPromise;
  }
  function ensureQI() {
    if (!QI && qiState !== 'loading') loadQuestionIndex();
    ensureQText();   // start the text fetch alongside meta — every ensureQI() call site gets both
  }

  // The ~780 KB of question prose, split out of qmeta.json in T3. Not needed to find or filter
  // a question (qmeta.json alone does that) — only to render or text-match one. Fetched in
  // parallel with qmeta.json (same trigger as T2), resolved independently so meta-only consumers
  // aren't held up behind ~780 KB they don't need. `text`/`variants` arrive as id-keyed JSON
  // objects (Phase 4 / I1) — question ids are now a sparse ~32-bit hash, and any structure sized
  // or indexed by the raw id value (an array, a Uint8Array) would try to allocate space up to the
  // id's magnitude (up to ~4.29 billion) instead of the ~8k entries actually present. They're
  // converted to `Map`s here, not kept as plain objects: a warmed, interleaved benchmark
  // (DECISION-9 — measure, don't assume) showed matchingQids() scanning a plain object keyed by
  // large sparse ids costs ~3.6ms vs ~1.0ms for the old position-indexed array, a real per-
  // keystroke regression; a Map scanned the same way costs ~1.0ms, matching the old array. Map
  // keys are numbers throughout (JSON object keys parse as strings; converted once here) so
  // `.get(q.i)` works without a wrapping String()/Number() at every call site.
  function loadQuestionText() {
    if (qtPromise) return qtPromise;
    qtState = 'loading';
    var tJson = fetch('data/qtext.json').then(function (r) { return r.json(); });
    qtPromise = Promise.all([ensureFullPromise(), tJson]).then(function (parts) {
      var d = parts[1];
      QTEXT = new Map(); QTEXTLC = new Map();
      for (var id in (d.text || {})) {
        var nid = Number(id), t = String(d.text[id] || '');
        QTEXT.set(nid, t); QTEXTLC.set(nid, t.toLowerCase());
      }
      // variant texts — a copy whose own wording the deduped entry doesn't faithfully contain
      QVAR = new Map(); QVARLC = new Map();
      for (var vid in (d.variants || {})) {
        var nvid = Number(vid), vt = String(d.variants[vid] || '');
        QVAR.set(nvid, vt); QVARLC.set(nvid, vt.toLowerCase());
      }
      qtState = 'ready';
      // copy cards and the question-first view can now show/match question text. Phase 5 / E1:
      // a matched card can already be open (showing a "Loading question text…" placeholder row)
      // by the time this lands, since the index alone was enough to find and render it — keep
      // it open across the backfill re-render instead of silently collapsing it on the user.
      if (state.view === 'browse' && (state.qview === 'questions' || state.q)) {
        renderBrowse($$('#results .copy[open]').map(function (n) { return n.getAttribute('data-i'); }));
      }
      if (PENDING_PRACTICE_TXT) {
        PENDING_PRACTICE_TXT.div.textContent = dispQ(qText(PENDING_PRACTICE_TXT.q));
        PENDING_PRACTICE_TXT = null;
      } else if ($('#practice').open) {
        renderPractice();
      }
      track('question_text_loaded', { count: QTEXT.size });
      return QTEXT;
    }).catch(function (e) {
      qtState = 'error'; qtPromise = null;
      track('data_error', { message: 'qtext ' + String(e && e.message || e).slice(0, 100) });
      if (state.view === 'browse') renderBrowse();   // clear a stuck "Searching…" state
    });
    return qtPromise;
  }
  function ensureQText() { if (!QTEXT && qtState !== 'loading') loadQuestionText(); }

  /* ---------- Phase 5 / E1: the token-prefix inverted index, data/qindex.bin ----------
     This is what actually finds a match now. It resolves independently of QTEXT (same
     two-promise pattern as qmeta/qtext, DECISION-10) — a search gets its real copy list and
     count as soon as this + copies.json have landed, well before ~1.4 MB of question prose. */
  function loadQIndexBin() {
    if (qxPromise) return qxPromise;
    qxState = 'loading';
    qxPromise = fetch('data/qindex.bin').then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      QIDX = parseQIndex(buf);
      qxState = 'ready';
      if (state.view === 'browse' && state.q) renderBrowse();
      track('qindex_loaded', { tokens: QIDX.tokens.length });
      return QIDX;
    }).catch(function (e) {
      qxState = 'error'; qxPromise = null;
      track('data_error', { message: 'qindex_bin ' + String(e && e.message || e).slice(0, 100) });
      if (state.view === 'browse') renderBrowse();   // clear a stuck "Searching…" state
    });
    return qxPromise;
  }
  function ensureQIndexBin() { if (!QIDX && qxState !== 'loading') loadQIndexBin(); }

  // Parse data/qindex.bin. Header: magic "TCIX" + version, tokenCount, qCount, vCount, then
  // four section byte-lengths, then the sections themselves: front-coded dictionary, a varint
  // postings-length table, delta+varint postings (over LOCAL positions 0..qCount+vCount-1), and
  // a uint32-per-position translation table back to the stable id (position < qCount => a
  // canonical question id; position >= qCount => a variant id, negated by the caller — see
  // build.js's writeQIndex()). Postings reference the local position, not the id, because the
  // id is now a ~32-bit content hash (Phase 4/I1) that does not compress as small sequential
  // deltas — see PERF-UX-AUDIT-2026-09-14.md's E1 addendum and tools/perf/index-proto.mjs.
  // The dictionary is decoded into a plain sorted string array up front (14.5k entries, trivial)
  // so every query is a plain binary search with no re-decoding per keystroke; postings for a
  // token are decoded lazily and cached, since most keystrokes touch only a handful of tokens.
  function parseQIndex(buf) {
    var dv = new DataView(buf);
    var magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'TCIX') throw new Error('bad qindex.bin magic: ' + magic);
    var o = 5;   // magic (4) + version (1)
    var tokenCount = dv.getUint32(o, true); o += 4;
    var qCount = dv.getUint32(o, true); o += 4;
    var vCount = dv.getUint32(o, true); o += 4;
    var dictBytes = dv.getUint32(o, true); o += 4;
    var lenTableBytes = dv.getUint32(o, true); o += 4;
    var postingsBytes = dv.getUint32(o, true); o += 4;
    var translationBytes = dv.getUint32(o, true); o += 4;
    var dictStart = o;
    var lenStart = dictStart + dictBytes;
    var postStart = lenStart + lenTableBytes;
    var transStart = postStart + postingsBytes;

    var dictStr = new TextDecoder('utf-8').decode(new Uint8Array(buf, dictStart, dictBytes));
    var tokens = new Array(tokenCount);
    var prev = '', p2 = 0, line = 0;
    while (p2 < dictStr.length && line < tokenCount) {
      var nl = dictStr.indexOf('\n', p2);
      var rec = dictStr.slice(p2, nl);
      var shared = rec.charCodeAt(0) - 48;
      var t = prev.slice(0, shared) + rec.slice(1);
      tokens[line++] = t; prev = t; p2 = nl + 1;
    }

    var bytes = new Uint8Array(buf);
    function readVarintsInto(start, count, out) {
      var p = start;
      for (var k = 0; k < count; k++) {
        var v = 0, shift = 0, b;
        do { b = bytes[p++]; v |= (b & 127) << shift; shift += 7; } while (b & 128);
        out[k] = v >>> 0;
      }
      return p;
    }
    var lens = new Uint32Array(tokenCount);
    readVarintsInto(lenStart, tokenCount, lens);
    var postOffset = new Uint32Array(tokenCount + 1);
    postOffset[0] = postStart;
    for (var k2 = 0; k2 < tokenCount; k2++) postOffset[k2 + 1] = postOffset[k2] + lens[k2];

    var translate = new Uint32Array(qCount + vCount);
    for (var k3 = 0; k3 < qCount + vCount; k3++) translate[k3] = dv.getUint32(transStart + k3 * 4, true);

    var postingsCache = new Map();
    function postingsOf(tokenIdx) {
      var cached = postingsCache.get(tokenIdx);
      if (cached) return cached;
      var start = postOffset[tokenIdx], end = postOffset[tokenIdx + 1];
      var out = [], p = start, last = 0;
      while (p < end) {
        var v = 0, shift = 0, b;
        do { b = bytes[p++]; v |= (b & 127) << shift; shift += 7; } while (b & 128);
        last += (v >>> 0); out.push(last);
      }
      postingsCache.set(tokenIdx, out);
      return out;
    }
    function lowerBound(w) {
      var lo = 0, hi = tokens.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (tokens[mid] < w) lo = mid + 1; else hi = mid; }
      return lo;
    }
    // every token in [lo,hi) starts with `term` — tokens are [a-z0-9]+ only, so U+FFFF sorts
    // after any of them and is a safe upper-bound sentinel.
    function prefixRange(term) { return [lowerBound(term), lowerBound(term + '￿')]; }

    return { version: dv.getUint8(4), tokens: tokens, qCount: qCount, vCount: vCount,
      translate: translate, postingsOf: postingsOf, prefixRange: prefixRange };
  }

  // Resolve a qmeta.json row's text from the separately-loaded qtext.json. null = not loaded yet;
  // every caller already treats that as "not ready" and re-renders once loadQuestionText resolves.
  function qText(q) { return QTEXT ? (QTEXT.get(q.i) || '') : null; }

  // syllabus node id -> readable label ("GS2 · Federalism")
  function sylLabel(id) {
    if (!SYL) return id;
    for (var p in SYL.papers) {
      var hit = (SYL.papers[p].nodes || []).filter(function (n) { return n.id === id; })[0];
      if (hit) return p + ' · ' + hit.t;
    }
    return id;
  }
  function fillSyllabus() {
    var sel = $('#syl'); if (!sel || !SYL) return;
    var frag = document.createDocumentFragment();           // off-DOM; swap once (AUDIT P3)
    frag.appendChild(el('option', { value: '' }, ['Whole syllabus']));
    var counts = {};
    (QI || []).forEach(function (q) { (q.s || []).forEach(function (id) { counts[id] = (counts[id] || 0) + 1; }); });
    Object.keys(SYL.papers).forEach(function (p) {
      var og = el('optgroup', { label: p });
      (SYL.papers[p].nodes || []).forEach(function (n) {
        var c = counts[n.id] || 0;
        og.appendChild(el('option', { value: n.id }, [n.t + (c ? ' (' + c + ')' : '')]));
      });
      frag.appendChild(og);
    });
    sel.replaceChildren ? sel.replaceChildren(frag) : (sel.innerHTML = '', sel.appendChild(frag));
    sel.value = state.syl;   // authoritative — may hold a ?syl= that predates this select's options (R3)
  }

  /* ---------- collapsing toolbar ---------- */
  // once you scroll past the search box into the results, fold the search + filters
  // into a slim sticky bar so the results have room; a "Filters" button re-opens them.
  var TB = {};
  function activeFilterCount() {
    var n = 0;
    if (state.paper !== 'all') n++;
    if (state.mode !== 'all') n++;
    if (state.qview !== 'copies') n++;
    if (state.syl) n++;
    if (state.topper) n++;
    if (state.source) n++;
    if (state.year) n++;
    if (state.sort !== 'best') n++;
    return n;
  }
  function updateFilterCount() {
    var badge = $('.filters-toggle .ft-count');
    if (!badge) return;
    var c = activeFilterCount();
    badge.textContent = String(c);
    badge.hidden = c === 0;
  }
  function wireToolbarCollapse() {
    var tb = $('.toolbar'), sentinel = $('.toolbar-sentinel'), toggle = $('#filters-toggle'),
        header = document.querySelector('header.site');
    if (!tb || !sentinel || !toggle || !header) return;
    TB.el = tb;

    var hdrPx = 0, io = null;
    function unslim() { tb.classList.remove('slim', 'open'); toggle.setAttribute('aria-expanded', 'false'); }
    TB.unslim = unslim;

    // The header is sticky at top:0, so the toolbar must stick just below it and
    // the "scrolled past" trigger line sits at the header's bottom edge. Header
    // height changes on font load, resize and the mobile tab-wrap — track it live
    // and re-arm the observer (its rootMargin can't be changed in place).
    function sync() {
      var v = Math.round(header.getBoundingClientRect().height);
      // 0 = hidden tab. A bogus reflow reads as a header taller than half the viewport; a
      // legitimately tall one (tabs wrapped at 200% zoom, or a 280px-wide device) can be
      // 250-300px and must still be tracked, or the sticky toolbar overlaps it (AUDIT P10).
      if (!v || v > Math.max(240, window.innerHeight * 0.5) || v === hdrPx) return;
      hdrPx = v;
      document.documentElement.style.setProperty('--hdr', v + 'px');
      if (!('IntersectionObserver' in window)) return;
      if (io) io.disconnect();
      io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting || state.view !== 'browse') { unslim(); return; }
        // Only collapse if there's enough page left below the fold that folding
        // the filter rows away can't pull the sentinel back into view. On a short
        // result list (one or two copies) collapsing shrinks the document enough
        // that the browser clamps the scroll position back up past the trigger,
        // which re-expands the toolbar, which pushes it down again — a rapid
        // up/down loop that only stops when the search box is focused.
        if (!tb.classList.contains('slim')) {
          var ff = tb.querySelector('.toolbar-filters');
          var delta = (ff ? ff.getBoundingClientRect().height : 0) + 48;
          if (document.documentElement.scrollHeight - window.innerHeight - window.scrollY < delta) return;
        }
        tb.classList.add('slim');
      }, { rootMargin: '-' + (v + 8) + 'px 0px 0px 0px', threshold: 0 });
      io.observe(sentinel);
    }
    sync();
    requestAnimationFrame(sync);
    setTimeout(sync, 400);
    if ('ResizeObserver' in window) new ResizeObserver(sync).observe(header);
    else window.addEventListener('resize', debounce(sync, 150));
    window.addEventListener('load', sync);

    toggle.addEventListener('click', function () {
      var open = tb.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      track('toolbar_filters', { open: open });
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    wireTheme(); wireTabs(); wireBrowse(); wireOptionals(); wireSubmit();
    wireToolbarCollapse();
    var initial = location.hash ? location.hash.replace('#', '') : 'browse';
    if (location.hash) setView(initial); else pageView('browse');
    track('app_ready', {
      theme: document.documentElement.getAttribute('data-theme') || 'system',
      entry_view: ['browse', 'optionals', 'submit', 'about'].indexOf(initial) < 0 ? 'browse' : initial
    });

    // honour the ?q= SearchAction URL (JSON-LD potentialAction + shared/bookmarked search links)
    var qi = $('#q');
    var qp = new URLSearchParams(location.search).get('q');
    // Also adopt whatever is already in the box. #q is live from first paint but app.js is
    // deferred, so a fast typist's query — and any value the browser restored on a
    // back-navigation — would otherwise be displayed but never searched (AUDIT P2).
    if (!qp && qi && qi.value) qp = qi.value;
    if (qp) {
      qp = qp.trim().slice(0, 200);
      state.q = qp; state.shown = PAGE;
      if (qi && qi.value !== qp) qi.value = qp;
      ensureFull(); ensureQI();
    }

    // ?practice=<subject-slug> — deep link from an /optional/<slug>/ page (acted on after data loads)
    var prc = new URLSearchParams(location.search).get('practice');
    if (prc) practiceIntent = prc.trim().slice(0, 60);

    // ?paper=GS1 — deep link from a /paper/<slug>/ hub page (AUDIT B17)
    var pp = new URLSearchParams(location.search).get('paper');
    if (pp && PAPERS.indexOf(pp) >= 0) state.paper = pp;

    // ?syl=<node id> — a shared/bookmarked syllabus filter (R3; fillSyllabus() applies it once loaded)
    var sylp = new URLSearchParams(location.search).get('syl');
    if (sylp) { state.syl = sylp.trim().slice(0, 60); state.qview = 'questions'; ensureQI(); }

    Promise.all([
      fetch('data/index.json').then(function (r) { return r.json(); }),
      fetch('data/toppers.json').then(function (r) { return r.json(); }).catch(function () { return { toppers: {} }; }),
      fetch('data/optionals.json').then(function (r) { return r.json(); }).catch(function () { return { entries: [] }; })
    ]).then(function (res) {
      DB = res[0]; TOPPERS = res[1].toppers || {}; OPTS = res[2].entries || [];
      var sk = $('#results-skeleton'); if (sk) sk.remove();
      onData();
      track('data_loaded', { copies: DB.stats.copies, questions: DB.stats.questions });
      scheduleFull();
    }).catch(function (e) {
      var sk = $('#results-skeleton'); if (sk) sk.remove();
      $('#sub').textContent = 'Could not load the database — ' + e.message;
      track('data_error', { message: String(e && e.message || e).slice(0, 120) });
    });

    // outbound-link tracking for static links (credit, footer, about)
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="http"]');
      if (!a || a.classList.contains('open')) return;
      var host = hostOf(a.href);
      if (host && host !== location.hostname) {
        track('click_outbound', { link_domain: host, link_url: a.href.slice(0, 200), transport_type: 'beacon' });
      }
    });

    // localhost/127.0.0.1 are secure contexts — register there too so SW changes are testable
    var localDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]';
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || localDev)) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  function onData() {
    indexCopies();
    var s = DB.stats;
    var g = s.all || s;   // grand total incl. optional-subject copies
    var optCopies = OPTS.length;
    $('#sub').textContent = fmt(g.questions) + ' searchable questions · ' +
      fmt(g.copies) + ' answer copies · ' + fmt(g.toppers) + ' toppers' +
      (optCopies ? ' · ' + fmt(optCopies) + ' optional-subject copies' : '');
    $('#statline').innerHTML =
      chipStat(g.questions, 'questions') + chipStat(g.copies, 'copies') +
      chipStat(g.toppers, 'toppers') +
      chipStat(g.subjects || countSources(), g.subjects ? 'subjects' : 'sources');
    $('#foot-stats').textContent = 'Data snapshot ' + DB.generated;
    $('#about-gen').textContent = 'Database snapshot: ' + DB.generated;

    seedStubs();
    buildPaperSeg();
    buildOptPool();
    refreshFacets();
    fillSelect($('#sform select[name=paper]'), PAPERS.filter(function (p) { return p !== 'Other'; })
      .map(function (p) { return [p, p]; })
      .concat(OPTIONALS.map(function (o) { return ['Optional — ' + o, 'Optional — ' + o]; })));

    renderBrowse();
    renderOptionals();

    if (practiceIntent) { openPracticeFor(practiceIntent); practiceIntent = null; }
  }

  // open the Practice dialog pre-filtered to one optional subject
  // (from ?practice=<slug> on an /optional/ page, or the Optionals-tab button)
  function openPracticeFor(want, from) {
    var dlg = $('#practice');
    if (!dlg || !OPTPOOL.length) return;
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
    var target = norm(want);
    var match = Object.keys(optPracticeSubjects()).filter(function (s) { return norm(s) === target; })[0];
    // the optional path runs entirely off OPTPOOL (already in memory from optionals.json).
    // Only the generic fallback touches GS/Essay data, so don't pull qmeta.json/qtext.json +
    // the 2 MB copies.json — that download + its sync processing froze the click.
    if (!match) { ensureQI(); ensureFull(); }
    state.pp = 'Optional'; state.psyl = match || '';
    $$('#practice-papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.pp === 'Optional')); });
    openPracticeDialog();
    var body = $('#practice-body');
    if (body) { body.dataset.has = ''; body.innerHTML = '<p class="hint">Picking a question…</p>'; }
    // yield once so the dialog paints before the render
    setTimeout(function () {
      fillPracticeSyl();
      if (match) nextPracticeQ(); else renderPractice();
    }, 0);
    track('practice_open', { from: from || 'optional_page', subject: match || target });
  }

  // toppers.json carries every ranker, but the boot index only has the text-searchable ones — so a
  // name search right after load would miss everyone whose copies are still in the lazy copies.json.
  // Seed a placeholder per missing GS/Essay topper so a name query matches immediately; loadFull()
  // strips these and swaps in the real copies.
  function seedStubs() {
    var GS = { GS1: 1, GS2: 1, GS3: 1, GS4: 1, Essay: 1, Other: 1 };
    var present = {};
    DB.copies.forEach(function (c) { present[c.t] = 1; });
    Object.keys(TOPPERS).forEach(function (name) {
      if (present[name]) return;
      var T = TOPPERS[name] || {};
      var gsPaper = (T.papers || []).filter(function (p) { return GS[p]; })[0];
      if (!gsPaper) return;   // optional-subject-only topper — lives on the Optionals tab
      DB.copies.push({ i: 'stub:' + name, t: name, c: '', p: gsPaper, y: T.year || null, r: T.air || null, u: null, q: [], k: 1, stub: 1, n: 0 });
    });
  }

  // topper / source / year dropdowns — rebuilt from whatever is currently in DB.copies
  // (the searchable core at boot, everything once data/copies.json has loaded)
  function refreshFacets() {
    fillSelect($('#topper'), topperOptions(), state.topper);
    fillSelect($('#source'), sourceOptions(), state.source);
    fillSelect($('#year'), yearOptions(), state.year);
  }

  function chipStat(n, label) { return '<span class="s"><b>' + fmt(n) + '</b> ' + label + '</span>'; }
  function countSources() { var m = Object.create(null); DB.copies.forEach(function (c) { if (c.c) m[c.c] = 1; }); return Object.keys(m).length; }

  /* ---------- theme ---------- */
  function wireTheme() {
    var btn = $('#theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var isDark = cur ? cur === 'dark' : sysDark;
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('tc-theme', next); } catch (e) {}
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#101C1D' : '#FBF9F5');
      track('theme_change', { theme: next });
    });
  }

  /* ---------- tabs / router ---------- */
  function wireTabs() {
    $$('nav.tabs button').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); });
    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto]');
      if (g) { e.preventDefault(); setView(g.dataset.goto); }
    });
    window.addEventListener('hashchange', function () { setView(location.hash.replace('#', '') || 'browse'); });
  }
  function setView(v) {
    if (['browse', 'optionals', 'submit', 'about'].indexOf(v) < 0) v = 'browse';
    var changed = state.view !== v;
    state.view = v;
    $$('nav.tabs button').forEach(function (b) {
      if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $$('.view').forEach(function (sec) { sec.hidden = sec.id !== 'view-' + v; });
    if (v !== 'browse' && TB.unslim) TB.unslim();
    if (location.hash.replace('#', '') !== v) history.replaceState(null, '', '#' + v);
    window.scrollTo({ top: 0, behavior: 'instant' });   // valid ScrollBehavior; unknown values fall back to 'auto'
    pageView(v);
    if (changed) track('tab_view', { view: v });
  }

  /* ---------- browse ---------- */
  function wireBrowse() {
    $('#q').addEventListener('focus', function () { ensureFull(); ensureQI(); }, { once: true });
    $('#q').addEventListener('input', debounce(function (e) {
      state.q = e.target.value.trim(); state.shown = PAGE; renderBrowse();
    }, 160));
    // separate, slower debounce so we log the settled query, not every keystroke
    $('#q').addEventListener('input', debounce(function (e) {
      var term = e.target.value.trim();
      if (term.length < 2) return;
      track('search', {
        search_term: term.toLowerCase().slice(0, 100),
        mode: state.mode, paper: state.paper,
        results: LASTCOUNT   // from the render that already happened — never re-run the search (AUDIT P5)
      });
    }, 900));
    $$('#mode button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.mode = b.dataset.mode;
        $$('#mode button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        renderBrowse();
        track('filter_change', { filter: 'mode', value: state.mode });
      });
    });
    ['topper', 'source', 'year', 'sort'].forEach(function (id) {
      $('#' + id).addEventListener('change', function (e) {
        state[id] = e.target.value; state.shown = PAGE; renderBrowse();
        track('filter_change', { filter: id, value: e.target.value || '(all)' });
      });
    });

    $$('#qview button').forEach(function (b) {
      b.addEventListener('click', function () {
        setQView(b.dataset.qview);
        track('filter_change', { filter: 'qview', value: b.dataset.qview });
      });
    });
    $('#syl').addEventListener('change', function (e) {
      state.syl = e.target.value; state.shown = PAGE;
      if (state.syl && state.qview !== 'questions') { setQView('questions'); return; }
      renderBrowse();
      track('filter_change', { filter: 'syllabus', value: e.target.value || '(all)' });
    });
    wirePractice();
  }

  function setQView(v) {
    state.qview = v; state.shown = PAGE;
    $$('#qview button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.qview === v)); });
    if (v === 'questions') ensureQI();
    renderBrowse();
  }

  function buildPaperSeg() {
    // Build off-DOM and swap once. Clearing with innerHTML='' and refilling makes the row
    // measure 0 for a frame, which the browser records as a layout shift (AUDIT P3).
    var row = $('#papers'); var frag = document.createDocumentFragment();
    var defs = [['all', 'All']].concat(PAPERS.filter(function (p) { return DB.stats.papers[p]; })
      .map(function (p) { return [p, p === 'Other' ? 'Other' : p]; }));
    defs.forEach(function (d) {
      var label = d[1] + (d[0] !== 'all' ? ' · ' + fmt(DB.stats.papers[d[0]]) : '');
      var b = el('button', { 'data-paper': d[0], 'aria-pressed': String(state.paper === d[0]) }, [label]);
      b.addEventListener('click', function () {
        state.paper = d[0]; state.shown = PAGE;
        $$('#papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.paper === d[0])); });
        renderBrowse();
        track('filter_change', { filter: 'paper', value: d[0] });
      });
      frag.appendChild(b);
    });
    row.replaceChildren ? row.replaceChildren(frag) : (row.innerHTML = '', row.appendChild(frag));
  }

  function topperOptions() {
    var m = Object.create(null);
    DB.copies.forEach(function (c) { if (c.t === 'Unknown') return; m[c.t] = (m[c.t] || 0) + (c.stub ? 0 : 1); });
    return Object.keys(m).sort().map(function (t) {
      var T = TOPPERS[t] || {};
      var cnt = m[t] || T.copies || 0;
      return [t, t + (T.air ? ' · AIR ' + T.air : '') + (cnt ? ' (' + cnt + ')' : '')];
    });
  }
  function sourceOptions() {
    var m = Object.create(null);
    DB.copies.forEach(function (c) { if (c.c) m[c.c] = (m[c.c] || 0) + 1; });
    return Object.keys(m).sort().map(function (x) { return [x, x + ' (' + m[x] + ')']; });
  }
  function yearOptions() {
    var m = Object.create(null);
    DB.copies.forEach(function (c) { if (c.stub) return; var y = yearOf(c); if (y) m[y] = (m[y] || 0) + 1; });
    return Object.keys(m).sort().reverse().map(function (y) { return [y, y + ' (' + m[y] + ')']; });
  }
  function fillSelect(sel, pairs, keep) {
    if (!sel) return;
    var first = sel.querySelector('option');
    var hasBlank = first && first.value === '';
    var frag = document.createDocumentFragment();          // off-DOM; swap once (AUDIT P3)
    if (hasBlank) frag.appendChild(first);
    pairs.forEach(function (p) { frag.appendChild(el('option', { value: p[0] }, [p[1]])); });
    sel.replaceChildren ? sel.replaceChildren(frag) : (sel.innerHTML = '', sel.appendChild(frag));
    if (keep) sel.value = keep;
  }

  function matchQ(text, terms, mode) {
    var t = text.toLowerCase();
    if (mode === 'exact') return t.indexOf(terms.join(' ')) >= 0;
    return terms.every(function (w) { return t.indexOf(w) >= 0; });
  }

  // raw row = [page, qid|text, marks, words] — qid for a question in data/qtext.json,
  // literal text for the rows writeQuestions() drops (sub-parts, fragments) and for a
  // format-1 copies.json still sitting in a service-worker cache.
  function rawQ(c) { return c.q || (QBYID && QBYID[c.i]) || null; }

  // positive id -> deduped question; negative -> this copy's own variant wording (id = -hash)
  function textOfId(v) { return v < 0 ? (QVAR.get(-v) || '') : (QTEXT.get(v) || ''); }

  // resolved rows, cached per copy. null means "ids present but the table isn't loaded yet",
  // which every caller already treats as "not loaded" and re-renders after.
  function qOf(c) {
    if (c.qr) return c.qr;
    var rows = rawQ(c);
    if (!rows) return null;
    var needsTable = false;
    for (var i = 0; i < rows.length; i++) if (typeof rows[i][1] === 'number') { needsTable = true; break; }
    if (!needsTable) { c.qr = rows; return rows; }
    if (!QTEXT) return null;
    var out = new Array(rows.length);
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      out[j] = (typeof r[1] === 'number') ? [r[0], textOfId(r[1]), r[2], r[3]] : r;
    }
    c.qr = out;
    return out;
  }

  // The pre-Phase-5 engine: one substring scan over the ~9.9k deduped question/variant strings
  // per query. Superseded by matchingQidsIndexed() below as the primary path, but kept as the
  // explicit, audit-specified fallback for a query the token-prefix index returns nothing for
  // (DECISION-7's known trade-off: "eral" no longer matches "federalism" via the index, but a
  // student who typed a genuine fragment should still find it, once qtext.json has landed, at
  // the cost of one full scan instead of zero). Returns a Map of question id -> 1 for ids that
  // match. A Map, not a plain object: ids are a sparse ~32-bit hash since Phase 4 / I1, and a
  // plain object keyed by large sparse integers measured ~3.6x slower to scan than a Map here
  // (DECISION-9 — see loadQuestionText()).
  function matchingQidsSubstring(terms, mode) {
    var joined = terms.join(' ');
    function scan(src) {
      var hit = new Map();
      src.forEach(function (t, id) {
        if (!t) return;
        if (mode === 'exact') { if (t.indexOf(joined) >= 0) hit.set(id, 1); return; }
        var ok = true;
        for (var w = 0; w < terms.length; w++) if (t.indexOf(terms[w]) < 0) { ok = false; break; }
        if (ok) hit.set(id, 1);
      });
      return hit;
    }
    return { q: scan(QTEXTLC), v: scan(QVARLC || new Map()) };
  }

  // position < idx.qCount -> a canonical question id; position >= idx.qCount -> a variant id,
  // returned negated (same sign convention rawQ()/textOfId() already use).
  function idxIdOf(idx, pos) { return pos < idx.qCount ? idx.translate[pos] : -idx.translate[pos]; }

  // All dictionary tokens starting with `term` (a binary-searched prefix range), unioned into
  // one Set of local positions. `exact` is just the postings of the token equal to `term`
  // itself, if the corpus has one — used only for ranking (an exact word match outranks a
  // longer completion the prefix happened to also pull in). `df` is the term's total raw
  // document-frequency across the whole expansion, used as this query's idf weight.
  function expandTerm(idx, term) {
    var range = idx.prefixRange(term), positions = new Set(), exact = null, df = 0;
    for (var ti = range[0]; ti < range[1]; ti++) {
      var post = idx.postingsOf(ti);
      df += post.length;
      if (idx.tokens[ti] === term) exact = new Set(post);
      for (var pi = 0; pi < post.length; pi++) positions.add(post[pi]);
    }
    return { positions: positions, exact: exact || new Set(), df: df };
  }

  function signedMapsFromPositions(idx, positions) {
    var q = new Map(), v = new Map();
    positions.forEach(function (p) {
      var id = idxIdOf(idx, p);
      if (id < 0) v.set(-id, 1); else q.set(id, 1);
    });
    return { q: q, v: v };
  }

  // The Phase 5 / E1 primary matcher. Tokenise-and-prefix-expand each term (query algorithm,
  // audit E1), AND the expansions (intersecting the shortest first), verify an exact-phrase
  // candidate set against QTEXT once it has landed, and fall back to the old substring scan
  // exactly once if the index genuinely found nothing (DECISION-7's mitigation — see the
  // "no word match" label this sets FALLBACK_USED for, read in renderBrowse()). Also computes a
  // simple, explainable BM25-lite score per matched id into LAST_QSCORE, consumed by the
  // "Best match" sort: idf = log(N/df) so rarer terms weigh more, and a term whose EXACT token
  // (not a longer prefix-completion) hit this document gets a 1.3x bonus.
  function matchingQidsIndexed(terms, mode) {
    FALLBACK_USED = false; PHRASE_PENDING = false; LAST_QSCORE = new Map();
    var idx = QIDX;
    var expansions = terms.map(function (t) { return expandTerm(idx, t); });
    var acc;
    if (expansions.some(function (e) { return e.positions.size === 0; })) {
      acc = new Set();
    } else {
      var order = expansions.map(function (e, i) { return i; })
        .sort(function (a, b) { return expansions[a].positions.size - expansions[b].positions.size; });
      acc = expansions[order[0]].positions;
      for (var k = 1; k < order.length; k++) {
        var next = expansions[order[k]].positions, out = new Set();
        acc.forEach(function (p) { if (next.has(p)) out.add(p); });
        acc = out;
      }
    }

    if (mode === 'exact') {
      if (acc.size && !QTEXT) { PHRASE_PENDING = true; return signedMapsFromPositions(idx, acc); }
      var joined = terms.join(' '), verified = new Set();
      acc.forEach(function (p) {
        var id = idxIdOf(idx, p);
        var t = id < 0 ? (QVARLC.get(-id) || '') : (QTEXTLC.get(id) || '');
        if (t && t.indexOf(joined) >= 0) verified.add(p);
      });
      if (!verified.size && QTEXTLC) { FALLBACK_USED = true; return matchingQidsSubstring(terms, mode); }
      acc = verified;
    } else if (!acc.size) {
      if (QTEXTLC) { FALLBACK_USED = true; return matchingQidsSubstring(terms, mode); }
      return { q: new Map(), v: new Map() };
    }

    if (acc.size) {
      var N = idx.qCount + idx.vCount;
      var idf = expansions.map(function (e) { return Math.max(0.05, Math.log((N + 1) / (e.df + 1))); });
      acc.forEach(function (p) {
        var s = 0;
        for (var ti2 = 0; ti2 < terms.length; ti2++) s += idf[ti2] * (expansions[ti2].exact.has(p) ? 1.3 : 1.0);
        LAST_QSCORE.set(idxIdOf(idx, p), s);
      });
    }
    return signedMapsFromPositions(idx, acc);
  }

  // A topper's year / rank: prefer the verified toppers.json value, fall back to the copy's own.
  function yearOf(c) { var T = TOPPERS[c.t] || {}; return T.year || c.y || 0; }
  function airOf(c) { var T = TOPPERS[c.t] || {}; return T.air || c.r || 0; }
  function matchName(name, terms) { return matchQ(name, terms, 'all'); }

  function filteredCopies() {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var needsText = terms.length > 0;
    // A query matches a topper's name straight away (index.json is enough). Matching *inside*
    // a copy needs copies.json (the raw per-copy rows) and the token index qindex.bin (which
    // finds the match) — never QTEXT, which is only needed to render the matched snippet
    // (Phase 5 / E1: the index is what answers "does this match", not the prose).
    if (needsText) {
      if (!FULL && fullState !== 'error') ensureFull();
      if (!QIDX && qxState !== 'error') ensureQIndexBin();
      ensureQText();   // never blocks a match — only needed to render/verify text once it lands
    }
    var qhit = (needsText && QIDX) ? matchingQidsIndexed(terms, state.mode) : null;
    var scores = LAST_QSCORE;

    var list = DB.copies.map(function (c) {
      if (state.paper !== 'all' && c.p !== state.paper) return null;
      if (state.topper && c.t !== state.topper) return null;
      if (state.source && c.c !== state.source) return null;
      if (state.year && String(yearOf(c)) !== state.year) return null;

      var nameHit = needsText && matchName(c.t, terms);
      // placeholder for a not-yet-loaded topper — only ever shown for a matching name search
      if (c.stub) return nameHit ? { c: c, qs: [], nameHit: true, n: 0, score: 0 } : null;
      var qs = [], score = 0;
      if (needsText && !nameHit) {
        if (c.k) return null;                    // link-only: only a name can match
        var raw = rawQ(c);
        if (!raw || !raw.length) return null;
        if (!qhit) return null;                  // index not loaded yet — re-renders once it is
        var res = qOf(c);                        // null = text not loaded yet; rows render as pending
        for (var qi2 = 0; qi2 < raw.length; qi2++) {
          var v = raw[qi2][1];
          var isHit = (typeof v === 'number')
            ? !!(v < 0 ? qhit.v.get(-v) : qhit.q.get(v))
            : matchQ(v, terms, state.mode);      // inline text (dropped row, or format-1 cache)
          if (!isHit) continue;
          qs.push(res ? res[qi2] : [raw[qi2][0], null, raw[qi2][2], raw[qi2][3]]);
          if (typeof v === 'number' && scores) {
            var s = scores.get(v < 0 ? -v : v) || 0;
            if (s > score) score = s;
          }
        }
        if (!qs.length) return null;
      }
      return { c: c, qs: qs, nameHit: !!nameHit, n: qs.length || c.n || (qOf(c) || []).length, score: score };
    }).filter(Boolean);

    list.sort(function (a, b) {
      // 'best' only has something to rank by when there's a query; with none, or on a score
      // tie, it falls through to the same newest-year/best-AIR order 'year' uses.
      if (state.sort === 'best' && state.q && a.score !== b.score) return b.score - a.score;
      if (state.sort === 'qty') return b.n - a.n;
      if (state.sort === 'air') return (airOf(a.c) || 1e9) - (airOf(b.c) || 1e9) || a.c.t.localeCompare(b.c.t);
      if (state.sort === 'name') return a.c.t.localeCompare(b.c.t) || a.c.p.localeCompare(b.c.p);
      var ya = yearOf(a.c), yb = yearOf(b.c);
      if (ya !== yb) return (yb || 0) - (ya || 0);          // newest first, unknown-year last
      return (airOf(a.c) || 1e9) - (airOf(b.c) || 1e9) ||   // then best rank first
        a.c.t.localeCompare(b.c.t) || a.c.p.localeCompare(b.c.p);
    });
    return list;
  }

  // Audit R3: q/paper/syl -> ?q=/?paper=/?syl=. Coexists with setView()'s own hash-only
  // replaceState (a relative '#view' resolves against the current URL, untouched by this) and
  // with the hash new URL(location.href) below carries forward unmodified — DECISION-13.
  // pushState fires once, on the empty->non-empty transition, so Back undoes a search instead of
  // leaving the site (INTENT-3) rather than one entry per keystroke. "Was empty" is read fresh
  // from location.search each call, not cached — a cached flag drifts the moment the URL changes
  // for a reason other than this function (a Back/Forward popstate) and walks Back off the app's
  // own history (DECISION-13 — an earlier version cached it and did exactly that).
  function syncUrl() {
    try {
      var u = new URL(location.href);
      var wasEmpty = !u.searchParams.get('q');
      if (state.q) u.searchParams.set('q', state.q); else u.searchParams.delete('q');
      if (state.paper && state.paper !== 'all') u.searchParams.set('paper', state.paper); else u.searchParams.delete('paper');
      if (state.syl) u.searchParams.set('syl', state.syl); else u.searchParams.delete('syl');
      if (u.href === location.href) return;
      if (wasEmpty && state.q) history.pushState(null, '', u);
      else history.replaceState(null, '', u);
    } catch (e) { /* URL/history unsupported — search still works, just not shareable */ }
  }

  // popstate: re-read q/paper/syl into state + the controls that mirror it, then re-render (R3).
  function applyUrlToState() {
    if (!DB) return;
    var params = new URLSearchParams(location.search);
    state.q = (params.get('q') || '').trim().slice(0, 200);
    state.shown = PAGE;
    var paper = params.get('paper');
    state.paper = (paper && PAPERS.indexOf(paper) >= 0) ? paper : 'all';
    state.syl = (params.get('syl') || '').trim().slice(0, 60);
    if (state.syl) state.qview = 'questions';
    var qi = $('#q'); if (qi && qi.value !== state.q) qi.value = state.q;
    $$('#papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.paper === state.paper)); });
    $$('#qview button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.qview === state.qview)); });
    var sel = $('#syl'); if (sel) sel.value = state.syl;
    if (state.q || state.syl) { ensureFull(); ensureQI(); }
    renderBrowse();
  }
  window.addEventListener('popstate', function () { if (state.view === 'browse') applyUrlToState(); });

  function renderBrowse(reopen) {
    if (!DB) return;
    syncUrl();
    updateFilterCount();
    if (state.qview === 'questions') return renderQuestions();
    var list = filteredCopies();
    LASTLIST = list; LASTCOUNT = list.length;
    var box = $('#results');

    var nameHits = 0, totalQ = 0, stubHits = 0;
    list.forEach(function (x) { totalQ += x.qs.length; if (x.nameHit) nameHits++; if (x.c.stub) stubHits++; });
    // Phase 5 / E1: a match is now found by qindex.bin, not qtext.json — QTEXT only renders the
    // snippet (and verifies an exact phrase), so it no longer gates whether we know the answer.
    var loading = (!FULL && fullState !== 'error') ||
      (!!state.q && !QIDX && qxState !== 'error');
    var realN = list.length - stubHits;
    // While the index is still downloading we do not yet know the answer. Printing
    // "0 copies for X" here reads as "this site doesn't have it" — measured, that showed for
    // 2.7 s on 4G / 4.5 s on slow 3G before 162 real results arrived (AUDIT P1, DECISION-6).
    // Never render a zero we are not sure of.
    if (state.q && loading && realN === 0) {
      $('#resultmeta').textContent = 'Searching inside ' +
        fmt((DB.stats && DB.stats.all && DB.stats.all.copies) || (DB.stats && DB.stats.copies) || 0) + ' copies…';
    } else {
      var extra = '';
      if (state.q) {
        extra = ' for “' + state.q + '”' +
          (nameHits ? ' · ' + fmt(nameHits) + ' by topper name' : '') +
          (totalQ ? ' · ' + fmt(totalQ) + ' matching questions' : '');
        if (stubHits) extra += ' · fetching copies for ' + fmt(stubHits) + (stubHits === 1 ? ' more topper…' : ' more toppers…');
        else if (loading) extra += ' · still scanning inside the copies…';
        // DECISION-7's accepted trade-off surfaced, not silently applied: the index found no
        // word match, so this used the old substring scan once (label required by audit E1).
        else if (FALLBACK_USED) extra += ' · no word match — showing text matches';
        // DECISION-6: an exact-phrase candidate set the index found but hasn't verified against
        // text yet (qtext.json still loading) is shown, not hidden — just labelled as provisional.
        else if (PHRASE_PENDING) extra += ' · phrase not yet checked';
      } else if (loading) {
        extra = ' · more copies + full-text search loading…';
      }
      $('#resultmeta').textContent = fmt(realN) + ' ' + (realN === 1 ? 'copy' : 'copies') + extra;
    }

    if (!list.length) {
      var failed = (qxState === 'error' || fullState === 'error');
      box.innerHTML = ''; CARDMAP.clear();
      box.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big' }, [loading ? 'Searching…' : failed ? 'Search is unavailable' : 'No matches']),
        el('div', {}, [loading
          ? 'Loading the search index so it can look inside the copies.'
          : failed
            ? 'The question index could not be downloaded. Topper-name search still works — reload the page to retry.'
            : 'Try a topper name, fewer words, “All words”, or clear a filter.'])
      ]));
      return;
    }

    reconcileBrowseList(list, box, reopen);
    if (list.length > state.shown) box.appendChild(makeMoreButton(list, box));
  }

  // Audit R1: fingerprints what would change copyCard(c,qs,n,nameHit)'s output for this id — NOT
  // open state, preserved separately below. Includes per-row pending/resolved (q[1]==null) so a
  // reused card gets its qtext.json backfill instead of being skipped as "unchanged" (DECISION-10).
  function cardSig(x) {
    // Stub/link-only cards render the same markup regardless of query, and copyCard() never
    // applies forceOpen on either branch — a constant sig keeps them in the reuse-as-is path
    // forever once built, so a link-only card's native <details> toggle is never disturbed.
    if (x.c.stub) return 'stub';
    if (x.c.k) return 'link';
    return state.q + '\x01' + state.mode + '\x01' + x.n + '\x01' + (x.nameHit ? 1 : 0) + '\x01' +
      x.qs.map(function (q) { return q[0] + ':' + (q[1] == null ? 'p' : 'r'); }).join(',');
  }

  // Reuse the on-screen element for this id when its signature is unchanged (cheapest path).
  // Otherwise rebuild its content but carry forward its REAL current open/closed state — a
  // manual toggle must survive further typing (DECISION-13), not reset to copyCard()'s own
  // auto-open-on-match default. A node never seen before opens per `reopen` (ids open in the DOM
  // before this render — the FULL-load/qtext-arrival backfills pass this) or that default.
  function getCard(x, reopen) {
    var id = x.c.i, sig = cardSig(x), existing = CARDMAP.get(id);
    if (existing && existing.dataset.tcSig === sig) return existing;
    var forceOpen = existing ? !!existing.open
      : ((reopen && reopen.indexOf(String(id)) >= 0) ? true : undefined);
    var node = copyCard(x.c, x.qs, x.n, x.nameHit, forceOpen);
    node.dataset.tcSig = sig;
    CARDMAP.set(id, node);
    return node;
  }

  // Reconcile #results to exactly the top state.shown items of `list`, in order, instead of
  // innerHTML=''-and-rebuild on every keystroke (audit R1). insertBefore/appendChild on an
  // existing node moves it, no rebuild — no flash, no lost <details> state.
  function reconcileBrowseList(list, box, reopen) {
    var grouped = state.sort === 'year' || (state.sort === 'best' && !state.q);
    var visible = list.slice(0, state.shown);
    var counts = null;
    if (grouped) { counts = {}; visible.forEach(function (x) { var y = yearOf(x.c) || 0; counts[y] = (counts[y] || 0) + 1; }); }
    var curY = null, seq = [], wanted = new Set();
    visible.forEach(function (x) {
      if (grouped) {
        var y = yearOf(x.c) || 0;
        if (y !== curY) {
          curY = y;
          seq.push(el('div', { class: 'yeargroup' }, [
            el('span', { class: 'yg-year' }, [y ? String(y) : 'Year not recorded']),
            el('span', { class: 'yg-count' }, [fmt(counts[y]) + (counts[y] === 1 ? ' copy' : ' copies')])
          ]));
        }
      }
      var card = getCard(x, reopen);
      wanted.add(card);
      seq.push(card);
    });
    var cur = box.firstChild;
    for (var i = 0; i < seq.length; i++) {
      if (cur === seq[i]) { cur = cur.nextSibling; continue; }
      box.insertBefore(seq[i], cur);
    }
    while (cur) { var next = cur.nextSibling; box.removeChild(cur); cur = next; }
    CARDMAP.forEach(function (node, id) { if (!wanted.has(node)) CARDMAP.delete(id); });   // drop ids no longer on screen
  }

  // Render list[from..to) into box, inserting before `mark` when given (so the Show-more button
  // keeps its DOM position and node identity). Shared by the first render and the append path,
  // so both produce identical markup and identical year grouping.
  function appendCards(list, from, to, box, reopen, mark) {
    var put = function (node) { mark ? box.insertBefore(node, mark) : box.appendChild(node); };
    // 'best' with no query falls through to the same year/AIR order 'year' uses (filteredCopies()
    // above) — group it the same way too, so browsing with no search still shows year headers.
    var grouped = state.sort === 'year' || (state.sort === 'best' && !state.q);
    var counts = null;
    if (grouped) { counts = {}; list.forEach(function (x) { var y = yearOf(x.c) || 0; counts[y] = (counts[y] || 0) + 1; }); }
    // Carry the last year header across an append so a group is not re-titled mid-run.
    var curY = (grouped && from > 0 && list[from - 1]) ? (yearOf(list[from - 1].c) || 0) : null;
    list.slice(from, to).forEach(function (x) {
      if (grouped) {
        var y = yearOf(x.c) || 0;
        if (y !== curY) {
          curY = y;
          put(el('div', { class: 'yeargroup' }, [
            el('span', { class: 'yg-year' }, [y ? String(y) : 'Year not recorded']),
            el('span', { class: 'yg-count' }, [fmt(counts[y]) + (counts[y] === 1 ? ' copy' : ' copies')])
          ]));
        }
      }
      put(getCard(x, reopen));   // keeps CARDMAP in sync so a later keystroke can reuse this card (R1)
    });
  }

  function moreLabel(list) {
    var n = Math.min(PAGE, list.length - state.shown);
    return 'Show ' + n + ' more  ·  ' + fmt(list.length - state.shown) + ' hidden';
  }

  function makeMoreButton(list, box) {
    var more = el('button', { class: 'more' }, [moreLabel(list)]);
    more.addEventListener('click', function () {
      // Append only, and keep THIS button node alive. Calling renderBrowse() would innerHTML=''
      // the list, re-run the filter+sort and close every expanded card. Removing and recreating
      // the button is nearly as bad: it is the node Chrome's scroll anchoring is holding on to,
      // and destroying it makes the viewport jump ~1,000-3,000px (measured, AUDIT P4). So insert
      // the new cards *before* it and relabel it in place.
      var from = state.shown;
      state.shown += PAGE;
      var cur = LASTLIST || filteredCopies();
      appendCards(cur, from, state.shown, box, null, more);
      if (cur.length > state.shown) more.textContent = moreLabel(cur);
      else more.remove();
    });
    return more;
  }

  /* ---------- question-first view ---------- */
  function dispQ(t) { return String(t || '').replace(/^\s*(?:Q(?:uestion)?\.?\s*)?\d{1,3}[.\):\-]?\s+/i, ''); }

  // Paper and syllabus filters are meta-only (q.p, q.s) and work the moment qmeta.json lands.
  // A text query needs qtext.json (T3) — while it's still loading, textReady is false and every
  // question passes the text test provisionally; renderQuestions() shows that as an in-progress
  // count rather than a final one, never a false zero (DECISION-6).
  function filteredQuestions() {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var textReady = !!QTEXTLC;
    return (QI || []).filter(function (q) {
      if (state.paper !== 'all' && q.p !== state.paper) return false;
      if (state.syl && (q.s || []).indexOf(state.syl) < 0) return false;
      if (terms.length) {
        if (!textReady) return true;
        if (!matchQ(qText(q), terms, state.mode)) return false;
      }
      return true;
    }).sort(function (a, b) {
      return b.a.length - a.a.length || (textReady ? String(qText(a)).localeCompare(String(qText(b))) : 0);
    });
  }

  function renderQuestions() {
    var box = $('#results'); box.innerHTML = '';
    if (!QI) {
      $('#resultmeta').textContent = qiState === 'error' ? 'Could not load the question index.' : '';
      box.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big' }, [qiState === 'error' ? 'Question index unavailable' : 'Loading questions…']),
        el('div', {}, ['Building the list of distinct Mains questions and their topper answers.'])
      ]));
      return;
    }
    var textReady = !!QTEXTLC;
    var list = filteredQuestions();
    var sylTxt = state.syl ? ' in ' + sylLabel(state.syl) : '';
    if (state.q && !textReady) {
      // Can't yet say how many of these actually match the query text — never claim a count
      // we don't have (DECISION-6). list.length here is "candidates", not "matches".
      $('#resultmeta').textContent = 'Searching inside ' + fmt(list.length) +
        (list.length === 1 ? ' question' : ' questions') + sylTxt + '…';
    } else {
      $('#resultmeta').textContent = fmt(list.length) + (list.length === 1 ? ' question' : ' questions') +
        (state.q ? ' for “' + state.q + '”' : '') + sylTxt;
    }

    if (!textReady) {
      var failed = qtState === 'error';
      box.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big' }, [failed ? 'Question text unavailable' : 'Loading question text…']),
        el('div', {}, [failed
          ? 'The question text could not be downloaded. Reload the page to retry.'
          : 'Fetching the text for ' + fmt(list.length) + (list.length === 1 ? ' question…' : ' questions…')])
      ]));
      return;
    }

    if (!list.length) {
      box.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big' }, ['No questions']), el('div', {}, ['Clear a filter or try other words.'])
      ]));
      return;
    }
    list.slice(0, state.shown).forEach(function (q) { box.appendChild(questionCard(q)); });
    if (list.length > state.shown) {
      var n = Math.min(PAGE, list.length - state.shown);
      var more = el('button', { class: 'more' }, ['Show ' + n + ' more  ·  ' + (list.length - state.shown) + ' hidden']);
      more.addEventListener('click', function () { state.shown += PAGE; renderQuestions(); });
      box.appendChild(more);
    }
  }

  function answerRows(q) {
    var rows = (q.a || []).map(function (pair) {
      var c = COPYBYID[pair[0]]; if (!c) return null;
      return { c: c, page: pair[1], air: airOf(c) || 1e9, year: yearOf(c) };
    }).filter(Boolean).sort(function (a, b) { return a.air - b.air; });
    return rows.map(function (r) {
      var href = safeHref(r.c.u + (r.page ? '#page=' + r.page : ''));
      var a = el('a', { class: 'open', href: href, target: '_blank', rel: 'noopener' }, [r.page ? 'Open · p.' + r.page : 'Open copy']);
      a.addEventListener('click', function () {
        track('pdf_open', { topper: r.c.t, paper: r.c.p, source: r.c.c || 'unknown', page: r.page || 0, link_domain: hostOf(r.c.u), outbound: true, transport_type: 'beacon', from: 'question' });
      });
      var meta = [r.c.t];
      if (r.air < 1e9) meta.push('AIR ' + r.air);
      if (r.c.c) meta.push(r.c.c);   // per-answer year omitted — the question card carries the exam year(s)
      return el('div', { class: 'q' }, [el('div', { class: 'txt' }, [meta.join('  ·  ')]), a]);
    });
  }

  // A reader who spots OCR damage is the cheapest correction signal we have — give them one
  // click to a pre-filled issue (AUDIT B14). The issue template promises this link.
  function reportLink(paper, qtext, url, page) {
    // GitHub issue forms prefill by field id (question / copy), not &body=.
    var q = String(qtext || '').slice(0, 500);
    var href = 'https://github.com/' + REPO + '/issues/new?template=report-question-error.yml' +
      '&title=' + encodeURIComponent('[fix] ' + paper + ' — ' + q.slice(0, 60)) +
      '&question=' + encodeURIComponent(q) +
      '&copy=' + encodeURIComponent((url || '') + (url && page ? '#page=' + page : ''));
    var a = el('a', { class: 'reportq', href: href, target: '_blank', rel: 'noopener' }, ['Report a problem']);
    a.addEventListener('click', function (e) { e.stopPropagation(); track('report_question', { paper: paper }); });
    return a;
  }

  function questionCard(q) {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var text = qText(q) || '';   // renderQuestions() only calls this once qtext.json has loaded
    var tags = [el('span', { class: 'tag paper' }, [q.p])];
    if (q.m) tags.push(el('span', { class: 'tag marks' }, [q.m + ' marks']));
    var wn = q.w && (String(q.w).match(/\d+/) || [])[0];
    if (wn) tags.push(el('span', { class: 'tag' }, [wn + ' words']));
    if (q.yr && q.yr.length) tags.push(el('span', { class: 'tag year' }, [q.yr.join(', ')]));
    (q.s || []).forEach(function (id) { tags.push(el('span', { class: 'tag syl' }, [sylLabel(id).split(' · ').pop()])); });

    var head = el('div', { class: 'qhead' });
    head.innerHTML = highlight(dispQ(text), terms);
    var a0 = (q.a || [])[0], c0 = a0 && COPYBYID[a0[0]];
    head.appendChild(reportLink(q.p, dispQ(text), c0 && c0.u, a0 && a0[1]));
    var n = (q.a || []).length;
    var summary = el('summary', {}, [
      head,
      el('span', { class: 'qn' }, [n + (n === 1 ? ' answer' : ' answers')]),
      el('span', { class: 'tags' }, tags)
    ]);
    var body = el('div', { class: 'qlist' });
    var d = el('details', { class: 'copy qcard' }, [summary, body]);
    var filled = false;
    d.addEventListener('toggle', function () {
      if (!d.open || filled) return;
      filled = true;
      answerRows(q).forEach(function (r) { body.appendChild(r); });
      if (!body.children.length) body.appendChild(el('div', { class: 'q loading' }, [el('div', { class: 'txt' }, ['Loading topper copies…'])]));
      track('question_open', { paper: q.p, answers: n });
    });
    return d;
  }

  /* ---------- Practice ---------- */
  function pStore() {
    try { return JSON.parse(localStorage.getItem('tc-practice') || '{}'); } catch (e) { return {}; }
  }
  function pSave(o) { try { localStorage.setItem('tc-practice', JSON.stringify(o)); } catch (e) {} }
  // Local calendar date — the audience is in IST and a UTC day boundary lands at 05:30 there,
  // so toISOString() would break a streak for someone practising two calendar days running (B18).
  function pDate(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function pToday() { return pDate(); }
  function pBumpStreak() {
    var o = pStore(), s = o.s || { d: '', n: 0, t: 0 }, today = pToday();
    if (s.d !== today) {
      var y = pDate(new Date(Date.now() - 864e5));
      s.n = s.d === y ? s.n + 1 : 1;
      s.d = today;
    }
    s.t = (s.t || 0) + 1;
    o.s = s; pSave(o);
    return s;
  }
  function practicedToday() { return (pStore().s || {}).d === pToday(); }

  // Practice pool for optional subjects, from the OCR'd questions[] now in optionals.json.
  // Each entry: { i, p:subject, q, m, w, yr:[years], a:[{t,air,url,page}] } — same shape the
  // GS/Essay path (QI) uses, so nextPracticeQ can treat both the same way.
  var OPTPOOL = [];
  function optQKey(t) {
    return String(t || '')
      .replace(/^\s*(?:Q(?:uestion)?\.?\s*)?\d{1,3}\s*[.\):\-]*\s+/i, '')            // drop leading "Q.3)" / "12." / "Q1 " / "06 " — mirrors build.js qKey()
      .replace(/\s*\(\s*(?:answer\s+in\s+)?\d{1,4}\s*(?:words?|marks?)\s*\)\s*$/i, '') // drop trailing "(150 words)" / "(15 marks)"
      .replace(/\s*\(\s*\d{1,3}\s*\)\s*$/, '')                                       // drop trailing bare "(10)" marks
      .toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 64);
  }
  function buildOptPool() {
    var g = {};
    OPTS.forEach(function (o) {
      if (!Array.isArray(o.questions) || !o.questions.length) return;
      o.questions.forEach(function (q) {
        var text = String(q.question || '').trim();
        if (text.replace(/[^a-z0-9]/gi, '').length < 12) return;
        var k = o.subject + '|' + optQKey(text);
        var e = g[k] || (g[k] = { p: o.subject, q: text, m: q.marks || '', w: q.words || '', a: [], _yr: {} });
        if (text.length > e.q.length) e.q = text;
        if (q.marks && !e.m) e.m = q.marks;
        if (q.words && !e.w) e.w = q.words;
        if (o.year) e._yr[o.year] = 1;
        e.a.push({ t: o.topper, air: o.air || null, url: o.url, page: q.page || 0, src: o.source || '' });
      });
    });
    OPTPOOL = Object.keys(g).map(function (k, i) {
      var e = g[k]; e.i = 'opt' + i; e.yr = Object.keys(e._yr).sort(); delete e._yr; return e;
    });
    var has = OPTPOOL.length > 0;
    var btn = $('#practice-papers button[data-pp="Optional"]');
    if (btn) { btn.disabled = !has; btn.textContent = has ? 'Optional' : 'Optional ▸ after OCR'; }
  }
  function optPracticeSubjects() {
    var m = Object.create(null);
    OPTPOOL.forEach(function (q) { m[q.p] = (m[q.p] || 0) + 1; });
    return m;
  }

  // The <dialog> now lives directly under <main> (not inside a view <section>),
  // so no view's display:none can hide it. showModal() relayouts the whole
  // document, so while it's up we pull the results list out of layout
  // (display:none, universal) and restore scroll on close.
  var _parkScroll = 0, _parked = [], _closing = false;
  function openPracticeDialog() {
    var dlg = $('#practice');
    if (dlg.open) return;
    _parkScroll = window.pageYOffset || 0;
    _parked = [];
    ['#opt-body', '#results'].forEach(function (s) {
      var n = $(s);
      if (n && !n.hidden && n.offsetParent !== null) { n.hidden = true; _parked.push(n); }
    });
    if (dlg.showModal) dlg.showModal(); else if (dlg.show) dlg.show(); else dlg.setAttribute('open', '');
  }
  function unparkList() {
    if (!_parked.length) return;
    _parked.forEach(function (n) { n.hidden = false; });
    _parked = [];
    window.scrollTo(0, _parkScroll);
  }
  function closePracticeDialog() {
    if (_closing) return;
    _closing = true;
    var dlg = $('#practice');
    if (dlg.open) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); }
    unparkList();
    _closing = false;
  }

  function wirePractice() {
    var dlg = $('#practice');
    $('#practice-open').addEventListener('click', function () {
      ensureQI(); ensureFull();
      openPracticeDialog();
      setTimeout(function () { fillPracticeSyl(); renderPractice(); }, 0);
      track('practice_open', {});
    });
    $('#practice-close').addEventListener('click', closePracticeDialog);
    dlg.addEventListener('close', unparkList);                                 // .close() (unreliable in some builds)
    dlg.addEventListener('cancel', unparkList);                               // native Esc
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closePracticeDialog(); });  // backdrop
    // the reliable catch-all: the [open] attribute goes away on every close path
    if (window.MutationObserver) {
      new MutationObserver(function () { if (!dlg.open) unparkList(); })
        .observe(dlg, { attributes: true, attributeFilter: ['open'] });
    }
    $$('#practice-papers button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        state.pp = b.dataset.pp; state.psyl = '';
        $$('#practice-papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.pp === state.pp)); });
        fillPracticeSyl();
      });
    });
    $('#practice-syl').addEventListener('change', function (e) {
      state.psyl = e.target.value;
      track('practice_topic', { paper: state.pp, topic: e.target.value || '(any)' });
    });
    $('#practice-next').addEventListener('click', nextPracticeQ);
    refreshPracticeDot();
  }
  function refreshPracticeDot() {
    $('#practice-open').classList.toggle('nudge', !practicedToday());
  }

  // second dropdown under the paper row: syllabus topics for a GS/Essay paper,
  // or the list of optional subjects when the paper is "Optional". Only shows
  // options that actually have practisable questions, with the count.
  function fillPracticeSyl() {
    var wrap = $('#practice-syl-wrap'), sel = $('#practice-syl'), lbl = $('#practice-syl-label'), p = state.pp;

    if (p === 'Optional') {
      var subs = optPracticeSubjects();
      lbl.textContent = 'Subject';
      sel.innerHTML = '<option value="">Any optional subject</option>';
      Object.keys(subs).sort().forEach(function (s) {
        sel.appendChild(el('option', { value: s }, [s + ' · ' + subs[s]]));
      });
      if (!(state.psyl && subs[state.psyl])) state.psyl = '';
      sel.value = state.psyl;
      wrap.hidden = Object.keys(subs).length === 0;
      return;
    }

    lbl.textContent = 'Topic';
    if (!p || !SYL || !SYL.papers[p] || !QI) {
      wrap.hidden = true; state.psyl = '';
      sel.innerHTML = '<option value="">Any topic</option>'; sel.value = '';
      return;
    }
    var counts = {};
    QI.forEach(function (q) {
      if (q.p !== p || !q.a || !q.a.length) return;
      (q.s || []).forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    });
    sel.innerHTML = '<option value="">Any topic in ' + p + '</option>';
    (SYL.papers[p].nodes || []).forEach(function (n) {
      if (!counts[n.id]) return;
      sel.appendChild(el('option', { value: n.id }, [n.t + ' · ' + counts[n.id]]));
    });
    if (!(state.psyl && counts[state.psyl])) state.psyl = '';
    sel.value = state.psyl;
    wrap.hidden = false;
  }

  function renderPractice() {
    var s = pStore().s || {};
    $('#practice-streak').textContent = s.n ? '🔥 ' + s.n + '-day streak · ' + (s.t || 0) + ' practised' : '';
    var body = $('#practice-body');
    if (!QI && !OPTPOOL.length) { body.innerHTML = '<p class="hint">Loading questions…</p>'; return; }
    if (!body.dataset.has) body.innerHTML = '<p class="hint">Pick a paper (GS, Essay or Optional) and, if you like, a topic — then hit the button for a random Mains question and the toppers who answered it.</p>';
  }

  function optAnswerRows(q) {
    return q.a.slice().sort(function (a, b) { return (a.air || 1e9) - (b.air || 1e9); }).map(function (a) {
      var href = safeHref(a.url + (a.page ? '#page=' + a.page : ''));
      var link = el('a', { class: 'open', href: href, target: '_blank', rel: 'noopener' }, [a.page ? 'Open · p.' + a.page : 'Open copy']);
      link.addEventListener('click', function () {
        track('pdf_open', { topper: a.t, paper: q.p, source: a.src || 'unknown', page: a.page || 0, link_domain: hostOf(a.url), optional: true, outbound: true, transport_type: 'beacon', from: 'practice' });
      });
      var meta = [a.t];
      if (a.air) meta.push('AIR ' + a.air);
      if (a.src) meta.push(a.src);
      return el('div', { class: 'q' }, [el('div', { class: 'txt' }, [meta.join('  ·  ')]), link]);
    });
  }

  function nextPracticeQ() {
    var pp = state.pp || '', psyl = state.psyl || '', isOpt = pp === 'Optional';
    if (!isOpt && !QI) { renderPractice(); return; }

    var base = isOpt
      ? OPTPOOL.filter(function (q) { return (!psyl || q.p === psyl) && q.a.length; })
      : QI.filter(function (q) { return (!pp || q.p === pp) && q.a && q.a.length && (!psyl || (q.s || []).indexOf(psyl) >= 0); });
    if (!base.length) {
      var what = psyl ? '“' + (isOpt ? psyl : sylLabel(psyl).split(' · ').pop()) + '”' : '';
      $('#practice-body').innerHTML = '<p class="hint">No questions ' +
        (what ? 'for ' + what + ' yet — try ' + (isOpt ? '“Any optional subject”.' : '“Any topic”.') : (isOpt ? 'from OCR yet.' : 'for that paper yet.')) + '</p>';
      return;
    }
    // prefer questions several toppers answered — more likely a genuine repeated PYQ, more to compare
    var pool = base.filter(function (q) { return q.a.length >= 3; });
    if (pool.length < 20) pool = base.filter(function (q) { return q.a.length >= 2; });
    if (pool.length < 10) pool = base;
    var o = pStore(); o.seen = o.seen || {};
    var key = isOpt ? 'opt:' + (psyl || 'any') : (pp || 'any');
    var seen = o.seen[key] || [];
    var fresh = pool.filter(function (q) { return seen.indexOf(q.i) < 0; });
    if (!fresh.length) { fresh = pool; seen = []; }
    var q = fresh[Math.floor(Math.random() * fresh.length)];
    seen.push(q.i); o.seen[key] = seen.slice(-600); pSave(o);
    pBumpStreak(); refreshPracticeDot();

    var body = $('#practice-body'); body.dataset.has = '1'; body.innerHTML = '';
    var tags = [el('span', { class: 'tag paper' }, [q.p])];
    if (q.m) tags.push(el('span', { class: 'tag marks' }, [q.m + ' marks']));
    var wn = q.w && (String(q.w).match(/\d+/) || [])[0];
    if (wn) tags.push(el('span', { class: 'tag' }, [wn + ' words']));
    if (q.yr && q.yr.length) tags.push(el('span', { class: 'tag year' }, ['asked ' + q.yr.join(', ')]));
    if (!isOpt) (q.s || []).forEach(function (id) { tags.push(el('span', { class: 'tag syl' }, [sylLabel(id).split(' · ').pop()])); });
    // Picking the question itself only needs qmeta.json (q.a/q.p/q.s) — text is a separate fetch
    // (T3). Show the pick immediately; if the text hasn't landed yet, backfill this node in place
    // once it does, rather than blocking selection or re-picking (see loadQuestionText()).
    var text = isOpt ? q.q : qText(q);
    var pq = el('div', { class: 'pq' }, [text != null ? dispQ(text) : 'Loading question text…']);
    body.appendChild(pq);
    if (!isOpt && text == null) { ensureQText(); PENDING_PRACTICE_TXT = { div: pq, q: q }; }
    body.appendChild(el('div', { class: 'tags' }, tags));

    var rows = isOpt ? optAnswerRows(q) : answerRows(q);
    body.appendChild(el('div', { class: 'pans-h' }, [rows.length + (rows.length === 1 ? ' topper answered this' : ' toppers answered this') + (!isOpt && !FULL ? ' — links loading…' : '')]));
    var list = el('div', { class: 'qlist' });
    rows.forEach(function (r) { list.appendChild(r); });
    body.appendChild(list);
    $('#practice-next').textContent = 'Another question';
    renderPractice();
    track('practice_question', { paper: q.p, answers: rows.length });
  }

  function topperTags(name, paper, copyYear, copyAir) {
    var T = TOPPERS[name] || {};
    var air = T.air || copyAir, year = T.year || copyYear, out = [];
    if (air) out.push(el('span', { class: 'tag air' }, ['AIR ' + air + (T.verified ? ' ✓' : '')]));
    if (year) out.push(el('span', { class: 'tag year' }, [String(year)]));
    var mk = T.marks && T.marks[paper] != null ? T.marks[paper] : null;
    if (mk != null) out.push(el('span', { class: 'tag marks' }, [paper + ' ' + mk]));
    if (T.telegram) {
      var tgA = el('a', { class: 'tag tg', href: safeHref(T.telegram), target: '_blank', rel: 'noopener' }, ['Telegram ↗']);
      tgA.addEventListener('click', function (e) { e.stopPropagation(); });
      out.push(tgA);
    }
    return out;
  }

  // forceOpen (R1/getCard): undefined = use the default below; true/false overrides it with a
  // reused card's real current open state, so a manual toggle survives a content rebuild.
  function copyCard(c, qs, count, nameHit, forceOpen) {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var openIt = forceOpen !== undefined ? forceOpen : ((terms.length > 0 && !nameHit) || !!state.topper);
    var n = count != null ? count : (qs ? qs.length : (c.n || 0));
    var tags = [el('span', { class: 'tag paper' }, [c.p])]
      .concat(c.c ? [el('span', { class: 'tag' }, [c.c])] : [])
      .concat(topperTags(c.t, c.p, c.y, c.r));

    if (c.stub) {   // topper matched by name; their copies are still downloading
      return el('details', { class: 'copy stub', 'data-i': c.i }, [
        el('summary', {}, [
          el('span', { class: 'name' }, [c.t]),
          el('span', { class: 'qn' }, ['loading…']),
          el('span', { class: 'tags' }, tags)
        ]),
        el('div', { class: 'qlist' }, [
          el('div', { class: 'q loading' }, [el('div', { class: 'txt' }, ['Fetching this topper’s copies — one moment…'])])
        ])
      ]);
    }

    if (c.k) {   // link-only copy — no question text
      var lsum = el('summary', {}, [
        el('span', { class: 'name' }, [c.t]),
        el('span', { class: 'qn' }, ['link only']),
        el('span', { class: 'tags' }, tags)
      ]);
      var la = el('a', { class: 'open', href: safeHref(c.u), target: '_blank', rel: 'noopener' }, ['Open copy']);
      la.addEventListener('click', function () {
        track('pdf_open', { topper: c.t, paper: c.p, source: c.c || 'unknown', link_domain: hostOf(c.u), link_only: true, outbound: true, transport_type: 'beacon' });
      });
      var lbody = el('div', { class: 'qlist' }, [
        el('div', { class: 'q' }, [el('div', { class: 'txt' }, [c.note || 'Scanned answer copy — not text-searchable. Open it to read.']), la])
      ]);
      return el('details', { class: 'copy', 'data-i': c.i }, [lsum, lbody]);
    }

    var summary = el('summary', {}, [
      el('span', { class: 'name' }, [c.t]),
      el('span', { class: 'qn' }, [n + (n === 1 ? ' question' : ' questions')]),
      el('span', { class: 'tags' }, tags)
    ]);

    var ql = el('div', { class: 'qlist' });
    // qs is only populated when the query matched *inside* this copy. A name-only hit
    // (nameHit, qs empty) should still list every question on expand — same as browsing
    // with no query — so fall through to qOf(c) rather than freezing an empty [] in.
    var have = qs && qs.length ? qs : ((terms.length && !nameHit) ? [] : qOf(c));

    function renderQ(q) {
      var href = safeHref(c.u + (q[0] ? '#page=' + q[0] : ''));
      var a = el('a', { class: 'open', href: href, target: '_blank', rel: 'noopener' }, [q[0] ? 'Open PDF · p.' + q[0] : 'Open PDF']);
      a.addEventListener('click', function () {
        track('pdf_open', {
          topper: c.t, paper: c.p, source: c.c || 'unknown',
          page: q[0] || 0, link_domain: hostOf(c.u), outbound: true, transport_type: 'beacon'
        });
      });
      // Phase 5 / E1: the index confirms a match before qtext.json (the prose) has necessarily
      // landed. Show the card now — DECISION-6 says degrade, never hide — and let renderBrowse()'s
      // existing re-render-on-qtext-arrival (loadQuestionText()) backfill the real text in place.
      if (q[1] == null) {
        var pending = el('div', { class: 'txt' }, ['Loading question text…']);
        return el('div', { class: 'q loading' }, [pending, a]);
      }
      var txt = el('div', { class: 'txt' });
      txt.innerHTML = highlight(q[1], terms);
      var meta = [];
      if (q[2]) meta.push(q[2] + ' marks');
      if (q[3]) meta.push(q[3] + (/\d$/.test(q[3]) ? ' words' : ''));
      var mspan = el('span', { class: 'qmeta' }, meta.length ? [meta.join('  ·  ')] : []);
      mspan.appendChild(reportLink(c.p, q[1], c.u, q[0]));
      txt.appendChild(mspan);
      return el('div', { class: 'q' }, [txt, a]);
    }

    if (have) {
      have.forEach(function (q) { ql.appendChild(renderQ(q)); });
    } else {
      // metadata-only so far — fill the list when the full text arrives
      ql.appendChild(el('div', { class: 'q loading' }, [
        el('div', { class: 'txt' }, ['Loading questions…']),
        el('a', { class: 'open', href: safeHref(c.u), target: '_blank', rel: 'noopener' }, ['Open PDF'])
      ]));
    }

    var d = el('details', { class: 'copy', 'data-i': c.i, open: openIt ? '' : null }, [summary, ql]);
    var filled = have != null;
    function fillQuestions() {
      if (filled) return;
      ensureFull(); ensureQI();
      // qOf(c) resolves ids through QTEXT (the text table), not QI (the meta table) — so this
      // must wait on qtPromise, not qiPromise, or it can resolve while QTEXT is still empty and
      // never retry (T3: text and meta now land on independent promises).
      Promise.all([fullPromise || Promise.resolve(), qtPromise || Promise.resolve()]).then(function () {
        var full = qOf(c);
        if (!full || filled) return;
        filled = true; ql.innerHTML = '';
        full.forEach(function (q) { ql.appendChild(renderQ(q)); });
      });
    }
    summary.addEventListener('click', function () {
      if (!d.open) { track('copy_open', { topper: c.t, paper: c.p, source: c.c || 'unknown', questions: n }); fillQuestions(); }
    });
    if (openIt && !filled) fillQuestions();
    return d;
  }

  function highlight(text, terms) {
    var h = esc(text);
    terms.forEach(function (w) {
      if (w.length < 2) return;
      var re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      h = h.replace(re, '<mark>$1</mark>');
    });
    return h;
  }

  /* ---------- optionals ---------- */
  function wireOptionals() {
    $('#opt-q').addEventListener('input', debounce(function (e) {
      state.optQ = e.target.value.trim().toLowerCase();
      state.optShown = PAGE;
      renderOptionals();
    }, 150));
  }

  function optCounts() {
    var m = Object.create(null);
    OPTS.forEach(function (o) { m[o.subject] = (m[o.subject] || 0) + 1; });
    return m;
  }

  function renderOptionals() {
    if (!DB) return;
    var body = $('#opt-body'); body.innerHTML = '';
    var counts = optCounts();

    // searching, or a subject picked -> show a filtered list
    if (state.optQ || state.optSubject !== 'all') {
      var back = el('div', { class: 'backrow' }, [
        el('button', { class: 'backbtn' }, ['← All subjects']),
        el('h2', {}, [state.optSubject === 'all' ? 'Search results' : state.optSubject])
      ]);
      back.querySelector('.backbtn').addEventListener('click', function () {
        state.optSubject = 'all'; state.optQ = ''; state.optShown = PAGE; $('#opt-q').value = ''; renderOptionals();
      });
      // "Practise" — only when this subject has questions read off its copies (OCR)
      var pn = state.optSubject !== 'all' && optPracticeSubjects()[state.optSubject];
      if (pn) {
        var pbtn = el('button', { class: 'practice-btn', type: 'button' }, ['Practise a ' + state.optSubject + ' question']);
        pbtn.addEventListener('click', function () { openPracticeFor(state.optSubject, 'optionals_tab'); });
        back.appendChild(pbtn);
      }
      body.appendChild(back);

      var list = OPTS.filter(function (o) {
        if (state.optSubject !== 'all' && o.subject !== state.optSubject) return false;
        if (state.optQ) {
          var blob = (o.topper + ' ' + (o.note || '') + ' ' + (o.source || '') + ' ' +
            (Array.isArray(o.questions) ? o.questions.map(function (q) { return q.question; }).join(' ') : '')).toLowerCase();
          if (state.optQ.split(/\s+/).filter(Boolean).some(function (w) { return blob.indexOf(w) < 0; })) return false;
        }
        return true;
      });

      if (!list.length) {
        body.appendChild(el('div', { class: 'empty' }, [
          el('div', { class: 'big' }, ['Nothing here yet']),
          el('div', {}, ['No ' + (state.optSubject === 'all' ? 'optional' : state.optSubject) + ' copies match. ']),
          el('a', { href: '#submit', 'data-goto': 'submit' }, ['Add the first one →'])
        ]));
        return;
      }
      // paginate — every optCard is an expanded <details> (~50 DOM nodes); a 90-copy
      // subject dumped all at once was ~5k nodes and jammed the main thread (and any
      // modal opened over it).
      var shown = state.optShown || PAGE;
      list.slice(0, shown).forEach(function (o) { body.appendChild(optCard(o)); });
      if (list.length > shown) {
        var n = Math.min(PAGE, list.length - shown);
        var more = el('button', { class: 'more' }, ['Show ' + n + ' more  ·  ' + (list.length - shown) + ' hidden']);
        more.addEventListener('click', function () { state.optShown = shown + PAGE; renderOptionals(); });
        body.appendChild(more);
      }
      return;
    }

    // default -> subject grid
    var grid = el('div', { class: 'subject-grid' });
    OPTIONALS.forEach(function (sub, i) {
      var n = counts[sub] || 0;
      var card = el('button', {
        class: 'subject-card', 'data-has': n ? '1' : '0',
        style: '--accent-bar:' + BAR[i % BAR.length]
      }, [
        el('div', { class: 'sname' }, [sub]),
        el('div', { class: 'scount' }, [n ? n + (n === 1 ? ' copy' : ' copies') : 'no copies yet'])
      ]);
      card.addEventListener('click', function () {
        state.optSubject = sub; state.optShown = PAGE; renderOptionals(); window.scrollTo(0, 0);
        track('optional_subject_view', { subject: sub, copies: n });
      });
      grid.appendChild(card);
    });
    body.appendChild(grid);

    if (!OPTS.length) {
      body.appendChild(el('div', { class: 'empty', style: 'margin-top:14px' }, [
        el('div', { class: 'big' }, ['This section is brand new']),
        el('div', {}, ['Pick a subject above to add the first copy, or ']),
        el('a', { href: '#submit', 'data-goto': 'submit' }, ['open the Submit form →'])
      ]));
    }
  }

  function optCard(o) {
    var qs = Array.isArray(o.questions) ? o.questions : [];
    var terms = state.optQ ? state.optQ.split(/\s+/).filter(Boolean) : [];
    var tags = [el('span', { class: 'tag paper' }, [o.subject])];
    if (o.air) tags.push(el('span', { class: 'tag air' }, ['AIR ' + o.air + (o.verified ? ' ✓' : '')]));
    if (o.year) tags.push(el('span', { class: 'tag year' }, [String(o.year)]));
    if (o.marks) tags.push(el('span', { class: 'tag marks' }, [o.subject + ' ' + o.marks]));
    if (o.source) tags.push(el('span', { class: 'tag' }, [o.source]));

    var summary = el('summary', {}, [
      el('span', { class: 'name' }, [o.topper]),
      el('span', { class: 'qn' }, [qs.length ? qs.length + (qs.length === 1 ? ' question' : ' questions') : (o.by ? 'via ' + o.by : 'copy')]),
      el('span', { class: 'tags' }, tags)
    ]);

    function pdfLink(page, txt) {
      var href = safeHref(o.url + (page ? '#page=' + page : ''));
      var a = el('a', { class: 'open', href: href, target: '_blank', rel: 'noopener' }, [txt]);
      a.addEventListener('click', function () {
        track('pdf_open', { topper: o.topper, paper: o.subject, source: o.source || 'unknown', page: page || 0, link_domain: hostOf(o.url), optional: true, outbound: true, transport_type: 'beacon' });
      });
      return a;
    }

    var body = el('div', { class: 'qlist' });
    if (qs.length) {
      if (o.note) body.appendChild(el('div', { class: 'q' }, [el('div', { class: 'txt' }, [o.note])]));
      qs.forEach(function (q) {
        var txt = el('div', { class: 'txt' });
        txt.innerHTML = highlight(q.question || '', terms);
        var m = [];
        if (q.marks) m.push(q.marks + ' marks');
        if (q.words) m.push(q.words + ' words');
        if (m.length) txt.appendChild(el('span', { class: 'qmeta' }, [m.join('  ·  ')]));
        body.appendChild(el('div', { class: 'q' }, [txt, pdfLink(q.page, q.page ? 'Open PDF · p.' + q.page : 'Open PDF')]));
      });
    } else {
      body.appendChild(el('div', { class: 'q' }, [el('div', { class: 'txt' }, [o.note || 'Optional subject answer copy.']), pdfLink(0, 'Open copy')]));
    }
    return el('details', { class: 'copy', open: 'open' }, [summary, body]);
  }

  /* ---------- submit ---------- */
  var analysis = null;          // { count, numPages, questions, method } from the PDF analyser
  var analyseLoaded = null;     // promise for lazily loading assets/analyse.js

  function loadAnalyser() {
    if (analyseLoaded) return analyseLoaded;
    // extract.js is no longer loaded eagerly in index.html — every visitor was paying for a
    // file only submitters use (AUDIT P8). analyse.js needs TC.extract, so load it first.
    function inject(src) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    analyseLoaded = (self.TC && self.TC.extract ? Promise.resolve() : inject('assets/extract.js'))
      .then(function () { return inject('assets/analyse.js'); });
    return analyseLoaded;
  }

  function wireAnalyse() {
    var panel = $('#analyse'); if (!panel) return;
    var statusEl = $('#an-status'), resultEl = $('#an-result');
    var lastSource = null, lastLabel = '';

    function status(msg, kind) {
      statusEl.hidden = false;
      statusEl.textContent = msg;
      statusEl.className = 'an-status' + (kind ? ' ' + kind : '');
    }

    function progress(p, a, b) {
      if (p === 'ocr-init') status('Loading the OCR engine (one-time ~13 MB)…');
      else if (p === 'ocr') status('Reading printed text — page ' + a + ' of ' + b + '…');
      else if (p === 'parsing') status('Reading the pages…');
      else if (p === 'reading') status('Opening the PDF…');
      else status('Working…');
    }

    function run(source, label, opts) {
      opts = opts || {};
      lastSource = source; lastLabel = label;
      analysis = null; resultEl.hidden = true; resultEl.innerHTML = '';
      status(opts.ocr ? 'Starting OCR…' : 'Loading the PDF reader…');
      track('analyse_start', { source: label, ocr: !!opts.ocr });
      loadAnalyser()
        .then(function () { return self.TC.analyse(source, progress, opts); })
        .then(function (res) {
          analysis = (res && res.count) ? res : null;
          track('analyse_done', { pages: res.numPages, count: res.count, method: res.method, source: label });
          renderAnalysis(res, opts);
        })
        .catch(function (e) {
          status((e && e.message) || 'Could not read that PDF. Try downloading it and choosing the file.', 'bad');
          track('analyse_error', { message: String(e && e.message || e).slice(0, 120), source: label, ocr: !!opts.ocr });
        });
    }

    function renderAnalysis(res, opts) {
      statusEl.hidden = true;
      resultEl.hidden = false;

      if (!res.count) {
        var canOcr = (res.method === 'no-text') && lastSource;
        resultEl.appendChild(el('p', { class: 'an-status bad' }, [
          res.method === 'no-text'
            ? 'No text layer — this is a scanned PDF.'
            : res.method === 'ocr-empty'
              ? 'OCR read ' + res.numPages + ' pages but found no printed questions (the copy may have only handwriting).'
              : 'Read ' + res.numPages + ' pages but found nothing that looks like a question.'
        ]));
        if (canOcr) {
          var btn = el('button', { type: 'button', class: 'btn ghost', style: 'margin-top:10px' },
            ['OCR the printed questions  (slow — a few minutes)']);
          btn.addEventListener('click', function () { btn.disabled = true; run(lastSource, lastLabel, { ocr: true }); });
          resultEl.appendChild(btn);
          resultEl.appendChild(el('p', { class: 'an-note' }, [
            'Renders each page and reads only the printed question at the top (handwriting is ignored). Runs in your browser.'
          ]));
        }
        return;
      }

      resultEl.appendChild(el('p', { class: 'an-count' }, [
        '≈ ', el('strong', {}, [String(res.count)]), ' questions detected across ' + res.numPages + ' pages',
        res.method === 'ocr' ? ' (via OCR)' : '', res.skipped ? ' · ' + res.skipped + ' pages skipped' : '', '.',
        el('span', { class: 'an-note' }, [
          res.method === 'ocr'
            ? ' OCR of scanned text — expect some errors. Review against the PDF before it goes live.'
            : ' Heuristic — review against the PDF before it goes live.'
        ])
      ]));
      var listWrap = el('div', { class: 'an-list' });
      res.questions.slice(0, 14).forEach(function (q) {
        var extra = (q.marks && !/marks?\b/i.test(q.question)) ? '  (' + q.marks + ' marks)' : '';
        listWrap.appendChild(el('div', { class: 'an-q' }, [
          el('span', { class: 'an-pg' }, ['p.' + q.page]),
          el('span', { class: 'an-qt' }, [q.question + extra])
        ]));
      });
      if (res.questions.length > 14) listWrap.appendChild(el('div', { class: 'an-q more' }, ['+ ' + (res.questions.length - 14) + ' more']));
      resultEl.appendChild(listWrap);
      resultEl.appendChild(el('p', { class: 'an-note' }, [
        'These are attached to your GitHub issue automatically so a maintainer can drop them straight in.'
      ]));
    }

    $('#an-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) run(f, 'file');
    });
    $('#an-url').addEventListener('click', function () {
      var u = ($('#sform [name=url]').value || '').trim();
      if (!/^https?:\/\//i.test(u)) { status('Paste the PDF link in the field below first.', 'bad'); return; }
      run(u, 'url');
    });
  }

  // parse a Google Forms "pre-filled link" into { action, entries:[name,phone,email,note] }
  function gformConfig() {
    if (!VOLUNTEER_GFORM_PREFILL) return null;
    try {
      var u = new URL(VOLUNTEER_GFORM_PREFILL);
      var id = (u.pathname.match(/\/forms\/d\/e\/([^/]+)/) || [])[1];
      var entries = [];
      u.searchParams.forEach(function (v, k) { if (/^entry\.\d+$/.test(k)) entries.push(k); });
      if (!id || entries.length < 3) return null;
      return { action: 'https://docs.google.com/forms/d/e/' + id + '/formResponse', entries: entries };
    } catch (e) { return null; }
  }

  function volunteerText(v) {
    var lines = ['Name:  ' + v.name, 'Phone: ' + v.phone, 'Email: ' + v.email];
    if (v.note) lines.push('', 'How I can help:', v.note);
    lines.push('', '— Be-a-volunteer form, topperscopy.hashin.me');
    return lines.join('\n');
  }
  function volunteerMailto(v) {
    return 'mailto:' + VOLUNTEER_EMAIL + '?subject=' +
      encodeURIComponent('Volunteer — ' + v.name) + '&body=' + encodeURIComponent(volunteerText(v));
  }

  // POST to a Google Form (no server). `no-cors` gives an opaque response we can't inspect, and the
  // promise is flaky (spurious rejects), so we fire, retry once, and then treat it as sent — the form
  // always shows the "didn't hear back? email me" fallback anyway.
  function postToGForm(cfg, v, done) {
    var vals = [v.name, v.phone, v.email, v.note || ''];
    var body = new URLSearchParams();  // urlencoded — Google's endpoint rejects multipart in no-cors mode
    cfg.entries.forEach(function (name, i) { body.append(name, vals[i] || ''); });
    var post = function () { return fetch(cfg.action, { method: 'POST', mode: 'no-cors', body: body }); };
    var settled = false;
    var finish = function () { if (!settled) { settled = true; done(); } };
    setTimeout(finish, 9000);
    post().then(finish, function () { setTimeout(function () { post().then(finish, finish); }, 1500); });
  }

  function wireVolunteer() {
    var cfg = gformConfig();
    var f = $('#vform'), note = $('#vform-note');
    if (!f) return;
    if (cfg) {
      var h = $('#vhint-mail');
      if (h) h.textContent = 'No account or email app needed. Prefer to send it yourself? Use “Copy my details”.';
    }

    var copyBtn = $('#vcopy');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var v = readVolunteer(f);
      var blob = 'To: ' + VOLUNTEER_EMAIL + '\nSubject: Volunteer — ' + v.name + '\n\n' + volunteerText(v);
      var ok = function () { note.textContent = 'Copied. Paste it into an email to ' + VOLUNTEER_EMAIL + '.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(blob).then(ok, function () { prompt('Copy this and email it to ' + VOLUNTEER_EMAIL + ':', blob); });
      else prompt('Copy this and email it to ' + VOLUNTEER_EMAIL + ':', blob);
      track('volunteer_copy', {});
    });

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = readVolunteer(f);
      if (cfg && navigator.onLine !== false) {
        note.textContent = 'Sending…';
        postToGForm(cfg, v, function () {
          f.reset();
          note.innerHTML = 'Thank you — your details are in. I’ll reach out at <strong>' + esc(v.email) +
            '</strong>. No reply within a few days? Write to <a href="' + esc(volunteerMailto(v)) + '">' +
            VOLUNTEER_EMAIL + '</a>.';
        });
      } else if (cfg) {
        note.innerHTML = 'You appear to be offline. Please <a href="' + esc(volunteerMailto(v)) + '">email ' +
          VOLUNTEER_EMAIL + '</a> when you’re back, or use “Copy my details”.';
      } else {
        window.location.href = volunteerMailto(v);
        note.textContent = 'Opening your email app with everything filled in — just press send. ' +
          'No mail app? Use “Copy my details” and paste into ' + VOLUNTEER_EMAIL + '.';
      }
      track('volunteer_submit', { via: cfg ? 'gform' : 'mailto' });
    });
  }
  function readVolunteer(f) {
    var g = function (n) { return (f[n] && f[n].value || '').trim(); };
    return { name: g('vname'), phone: g('vphone'), email: g('vemail'), note: g('vnote') };
  }

  function wireSubmit() {
    wireAnalyse();
    var kind = 'copy';
    var KINDS = ['copy', 'data', 'volunteer'];
    function setKind(k) {
      kind = k;
      KINDS.forEach(function (x) {
        var b = $('#kind-' + x);
        if (b) b.setAttribute('aria-pressed', String(x === k));
      });
      $$('[data-only]').forEach(function (n) {
        var show = n.dataset.only.split(/\s+/).indexOf(k) >= 0;
        n.style.display = show ? '' : 'none';
        if (n.tagName === 'FORM') n.hidden = !show;
      });
      $('#sform [name=url]').required = k === 'copy';
    }
    KINDS.forEach(function (k) {
      var b = $('#kind-' + k);
      if (b) b.addEventListener('click', function () { setKind(k); track('submit_kind', { kind: k }); });
    });
    setKind('copy');

    wireVolunteer();

    $('#sform').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var g = function (n) { return (f[n] && f[n].value || '').trim(); };
      // markdown table cells: a raw "|" splits the row and breaks the parser in
      // .github/scripts/apply-submission.mjs; a newline breaks it too.
      var cell = function (s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); };
      var isCopy = kind === 'copy';
      var title = (isCopy ? '[copy] ' : '[data] ') + g('topper') +
        (g('air') ? ' — AIR ' + g('air') : '') + ' · ' + g('paper');

      var L = ['### ' + (isCopy ? 'New topper copy' : 'Topper data correction'), '',
        '| field | value |', '| --- | --- |',
        '| Topper | ' + cell(g('topper')) + ' |',
        '| AIR | ' + cell(g('air') || '—') + ' |',
        '| Year | ' + cell(g('year') || '—') + ' |',
        '| Paper / subject | ' + cell(g('paper')) + ' |'];
      if (isCopy) {
        L.push('| Copy link | ' + cell(g('url') || '—') + ' |');
        L.push('| Source / coaching | ' + cell(g('source') || '—') + ' |');
        L.push('| Marks in this paper | ' + cell(g('marks') || '—') + ' |');
        if (analysis && analysis.count) L.push('| Questions (auto-estimated) | ~' + analysis.count + ' over ' + analysis.numPages + ' pages · ' + analysis.method + ' |');
      } else {
        L.push('| Subject-wise marks | ' + cell(g('allmarks') || '—') + ' |');
      }
      L.push('| Submitted by | ' + cell(g('by') || 'anonymous') + ' |', '',
        '**Source / verification note**', '', g('note') || '_none provided_');

      if (isCopy && analysis && analysis.count) {
        var meta = { topper: g('topper'), coaching: g('source'), subject: g('paper'), url: g('url') };
        var rows = (self.TC.extract).toCsvRows(analysis.questions, meta);
        var csv = 'topper,coaching,subject,page_number,question,metadata,url\n' + rows.join('\n');
        var how = analysis.method === 'ocr' ? 'OCR of a scanned PDF' : 'heuristic';
        var block = ['', '<details><summary>Auto-extracted questions — ' + analysis.count +
          ' rows for <code>data/submissions.csv</code> (' + how + ', please verify)</summary>', '',
          '```csv', csv, '```', '</details>'].join('\n');
        // keep the GitHub issue URL within its ~8 KB limit
        if (encodeURIComponent(L.join('\n') + block).length < 6200) L.push(block);
        else L.push('', '_' + analysis.count + ' questions were auto-extracted from the PDF; the CSV was too long for the pre-filled issue — the submitter can paste it in a comment._');
      }

      L.push('', '---', '_Sent from the Submit form on topperscopy.hashin.me._');

      var body = L.join('\n');
      var base = 'https://github.com/' + REPO + '/issues/new?';
      var url = base + 'labels=' + encodeURIComponent(isCopy ? 'submission,copy' : 'submission,data') +
        '&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
      var blank = base + 'labels=submission&title=' + encodeURIComponent(title);

      if (url.length > 7800) {
        url = blank;
        $('#sform-note').textContent = 'The pre-filled issue was too long, so it opened blank — paste your details there.';
      } else {
        $('#sform-note').textContent = 'Opened a GitHub issue in a new tab with everything filled in. Review it and hit “Submit new issue”.';
      }
      window.open(url, '_blank', 'noopener');
      var alt = $('#sform-alt'); alt.hidden = false; alt.href = blank;
      track('submit_issue_open', { kind: kind, paper: g('paper') || 'unknown', has_link: !!g('url'), extracted: analysis ? analysis.count : 0 });
    });
  }

  boot();
})();
