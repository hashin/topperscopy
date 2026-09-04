/* Toppers Copy — static client. A community-built index; GS/Essay question data builds on open
   community work including upsckata.com "Topper Copies". */
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
  var fmt = function (n) { return (n || 0).toLocaleString('en-IN'); };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, x = this; clearTimeout(t); t = setTimeout(function () { fn.apply(x, a); }, ms); }; };
  var SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

  var DB = null, TOPPERS = {}, OPTS = [];
  var QI = null, SYL = null, COPYBYID = {}, qiState = 'idle', qiPromise = null;
  var state = {
    view: 'browse', q: '', mode: 'all', paper: 'all',
    topper: '', source: '', year: '', sort: 'year', shown: PAGE,
    qview: 'copies', syl: '', pp: '',
    optSubject: 'all', optQ: ''
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
    qiPromise = Promise.all([
      fetch('data/questions.json').then(function (r) { return r.json(); }),
      fetch('data/syllabus.json').then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (res) {
      QI = res[0].questions || [];
      SYL = res[1];
      qiState = 'ready';
      fillSyllabus();
      if (state.view === 'browse' && state.qview === 'questions') renderBrowse();
      if ($('#practice').open) renderPractice();
      track('question_index_loaded', { count: QI.length });
      return QI;
    }).catch(function (e) {
      qiState = 'error'; qiPromise = null;
      track('data_error', { message: 'qindex ' + String(e && e.message || e).slice(0, 100) });
    });
    return qiPromise;
  }
  function ensureQI() { if (!QI && qiState !== 'loading') loadQuestionIndex(); }

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
    var keep = sel.value;
    sel.innerHTML = '<option value="">Whole syllabus</option>';
    var counts = {};
    (QI || []).forEach(function (q) { (q.s || []).forEach(function (id) { counts[id] = (counts[id] || 0) + 1; }); });
    Object.keys(SYL.papers).forEach(function (p) {
      var og = el('optgroup', { label: p });
      (SYL.papers[p].nodes || []).forEach(function (n) {
        var c = counts[n.id] || 0;
        og.appendChild(el('option', { value: n.id }, [n.t + (c ? ' (' + c + ')' : '')]));
      });
      sel.appendChild(og);
    });
    sel.value = keep;
  }

  /* ---------- boot ---------- */
  function boot() {
    wireTheme(); wireTabs(); wireBrowse(); wireOptionals(); wireSubmit();
    var initial = location.hash ? location.hash.replace('#', '') : 'browse';
    if (location.hash) setView(initial); else pageView('browse');
    track('app_ready', {
      theme: document.documentElement.getAttribute('data-theme') || 'system',
      entry_view: ['browse', 'optionals', 'submit', 'about'].indexOf(initial) < 0 ? 'browse' : initial
    });

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

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
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
    $('#about-gen').textContent = 'Database snapshot: ' + DB.generated + ' · source: ' + DB.attribution;

    seedStubs();
    buildPaperSeg();
    refreshFacets();
    fillSelect($('#sform select[name=paper]'), PAPERS.filter(function (p) { return p !== 'Other'; })
      .map(function (p) { return [p, p]; })
      .concat(OPTIONALS.map(function (o) { return ['Optional — ' + o, 'Optional — ' + o]; })));

    renderBrowse();
    renderOptionals();
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
  function countSources() { var m = {}; DB.copies.forEach(function (c) { if (c.c) m[c.c] = 1; }); return Object.keys(m).length; }

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
    $$('nav.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.view === v); });
    $$('.view').forEach(function (sec) { sec.hidden = sec.id !== 'view-' + v; });
    if (location.hash.replace('#', '') !== v) history.replaceState(null, '', '#' + v);
    window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
    pageView(v);
    if (changed) track('tab_view', { view: v });
  }

  /* ---------- browse ---------- */
  function wireBrowse() {
    $('#q').addEventListener('focus', ensureFull, { once: true });
    $('#q').addEventListener('input', debounce(function (e) {
      state.q = e.target.value.trim(); state.shown = PAGE; renderBrowse();
    }, 160));
    // separate, slower debounce so we log the settled query, not every keystroke
    $('#q').addEventListener('input', debounce(function (e) {
      var term = e.target.value.trim();
      if (term.length < 2) return;
      var res = filteredCopies();
      track('search', {
        search_term: term.toLowerCase().slice(0, 100),
        mode: state.mode, paper: state.paper,
        results: (res && res.pending) ? -1 : res.length
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
    var row = $('#papers'); row.innerHTML = '';
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
      row.appendChild(b);
    });
  }

  function topperOptions() {
    var m = {};
    DB.copies.forEach(function (c) { m[c.t] = (m[c.t] || 0) + (c.stub ? 0 : 1); });
    return Object.keys(m).sort().map(function (t) {
      var T = TOPPERS[t] || {};
      var cnt = m[t] || T.copies || 0;
      return [t, t + (T.air ? ' · AIR ' + T.air : '') + (cnt ? ' (' + cnt + ')' : '')];
    });
  }
  function sourceOptions() {
    var m = {};
    DB.copies.forEach(function (c) { if (c.c) m[c.c] = (m[c.c] || 0) + 1; });
    return Object.keys(m).sort().map(function (x) { return [x, x + ' (' + m[x] + ')']; });
  }
  function yearOptions() {
    var m = {};
    DB.copies.forEach(function (c) { if (c.stub) return; var y = yearOf(c); if (y) m[y] = (m[y] || 0) + 1; });
    return Object.keys(m).sort().reverse().map(function (y) { return [y, y + ' (' + m[y] + ')']; });
  }
  function fillSelect(sel, pairs, keep) {
    if (!sel) return;
    var first = sel.querySelector('option');
    var hasBlank = first && first.value === '';
    sel.innerHTML = '';
    if (hasBlank) sel.appendChild(first);
    pairs.forEach(function (p) { sel.appendChild(el('option', { value: p[0] }, [p[1]])); });
    if (keep) sel.value = keep;
  }

  function matchQ(text, terms, mode) {
    var t = text.toLowerCase();
    if (mode === 'exact') return t.indexOf(terms.join(' ')) >= 0;
    return terms.every(function (w) { return t.indexOf(w) >= 0; });
  }

  function qOf(c) { return c.q || (QBYID && QBYID[c.i]) || null; }

  // A topper's year / rank: prefer the verified toppers.json value, fall back to the copy's own.
  function yearOf(c) { var T = TOPPERS[c.t] || {}; return T.year || c.y || 0; }
  function airOf(c) { var T = TOPPERS[c.t] || {}; return T.air || c.r || 0; }
  function matchName(name, terms) { return matchQ(name, terms, 'all'); }

  function filteredCopies() {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var needsText = terms.length > 0;
    // A query matches a topper's name straight away (index.json is enough); matching the
    // text *inside* copies needs the big file, so kick that off but never block the UI on it.
    if (needsText && !FULL && fullState !== 'error') ensureFull();

    var list = DB.copies.map(function (c) {
      if (state.paper !== 'all' && c.p !== state.paper) return null;
      if (state.topper && c.t !== state.topper) return null;
      if (state.source && c.c !== state.source) return null;
      if (state.year && String(yearOf(c)) !== state.year) return null;

      var nameHit = needsText && matchName(c.t, terms);
      // placeholder for a not-yet-loaded topper — only ever shown for a matching name search
      if (c.stub) return nameHit ? { c: c, qs: [], nameHit: true, n: 0 } : null;
      var qs = [];
      if (needsText && !nameHit) {
        if (c.k) return null;                    // link-only: only a name can match
        var all = qOf(c);
        if (!all) return null;                   // text not loaded yet — reappears after loadFull re-renders
        qs = all.filter(function (q) { return matchQ(q[1], terms, state.mode); });
        if (!qs.length) return null;
      }
      return { c: c, qs: qs, nameHit: !!nameHit, n: qs.length || c.n || (qOf(c) || []).length };
    }).filter(Boolean);

    list.sort(function (a, b) {
      if (state.sort === 'year') {
        var ya = yearOf(a.c), yb = yearOf(b.c);
        if (ya !== yb) return (yb || 0) - (ya || 0);          // newest first, unknown-year last
        return (airOf(a.c) || 1e9) - (airOf(b.c) || 1e9) ||   // then best rank first
          a.c.t.localeCompare(b.c.t) || a.c.p.localeCompare(b.c.p);
      }
      if (state.sort === 'air') {
        return (airOf(a.c) || 1e9) - (airOf(b.c) || 1e9) || a.c.t.localeCompare(b.c.t);
      }
      if (state.sort === 'qty') return b.n - a.n;
      return a.c.t.localeCompare(b.c.t) || a.c.p.localeCompare(b.c.p);
    });
    return list;
  }

  function renderBrowse(reopen) {
    if (!DB) return;
    if (state.qview === 'questions') return renderQuestions();
    var list = filteredCopies();
    var box = $('#results'); box.innerHTML = '';

    var nameHits = 0, totalQ = 0, stubHits = 0;
    list.forEach(function (x) { totalQ += x.qs.length; if (x.nameHit) nameHits++; if (x.c.stub) stubHits++; });
    var loading = !FULL && fullState !== 'error';
    var realN = list.length - stubHits;
    $('#resultmeta').textContent = fmt(realN) + ' ' + (realN === 1 ? 'copy' : 'copies') +
      (state.q
        ? ' for “' + state.q + '”' +
          (nameHits ? ' · ' + fmt(nameHits) + ' by topper name' : '') +
          (totalQ ? ' · ' + fmt(totalQ) + ' matching questions' : '') +
          (stubHits ? ' · fetching copies for ' + fmt(stubHits) + (stubHits === 1 ? ' more topper…' : ' more toppers…')
            : (loading ? ' · still scanning inside the copies…' : ''))
        : (loading ? ' · more copies + full-text search loading…' : ''));

    if (!list.length) {
      box.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big' }, [loading ? 'Searching…' : 'No matches']),
        el('div', {}, [loading
          ? 'Loading the full text of every copy (one-time ~2 MB) so search can look inside them.'
          : 'Try a topper name, fewer words, “All words”, or clear a filter.'])
      ]));
      return;
    }

    var grouped = state.sort === 'year';
    var counts = null;
    if (grouped) { counts = {}; list.forEach(function (x) { var y = yearOf(x.c) || 0; counts[y] = (counts[y] || 0) + 1; }); }

    var curY = null;
    list.slice(0, state.shown).forEach(function (x) {
      if (grouped) {
        var y = yearOf(x.c) || 0;
        if (y !== curY) {
          curY = y;
          box.appendChild(el('div', { class: 'yeargroup' }, [
            el('span', { class: 'yg-year' }, [y ? String(y) : 'Year not recorded']),
            el('span', { class: 'yg-count' }, [fmt(counts[y]) + (counts[y] === 1 ? ' copy' : ' copies')])
          ]));
        }
      }
      var card = copyCard(x.c, x.qs, x.n, x.nameHit);
      if (reopen && reopen.indexOf(String(x.c.i)) >= 0) card.open = true;
      box.appendChild(card);
    });

    if (list.length > state.shown) {
      var n = Math.min(PAGE, list.length - state.shown);
      var more = el('button', { class: 'more' }, ['Show ' + n + ' more  ·  ' + (list.length - state.shown) + ' hidden']);
      more.addEventListener('click', function () { state.shown += PAGE; renderBrowse(); });
      box.appendChild(more);
    }
  }

  /* ---------- question-first view ---------- */
  function dispQ(t) { return String(t || '').replace(/^\s*(?:Q(?:uestion)?\.?\s*)?\d{1,3}[.\):\-]?\s+/i, ''); }

  function filteredQuestions() {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return (QI || []).filter(function (q) {
      if (state.paper !== 'all' && q.p !== state.paper) return false;
      if (state.syl && (q.s || []).indexOf(state.syl) < 0) return false;
      if (terms.length && !matchQ(q.q, terms, state.mode)) return false;
      return true;
    }).sort(function (a, b) { return b.a.length - a.a.length || String(a.q).localeCompare(String(b.q)); });
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
    var list = filteredQuestions();
    var sylTxt = state.syl ? ' in ' + sylLabel(state.syl) : '';
    $('#resultmeta').textContent = fmt(list.length) + (list.length === 1 ? ' question' : ' questions') +
      (state.q ? ' for “' + state.q + '”' : '') + sylTxt;

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
      var href = r.c.u + (r.page ? '#page=' + r.page : '');
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

  function questionCard(q) {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var tags = [el('span', { class: 'tag paper' }, [q.p])];
    if (q.m) tags.push(el('span', { class: 'tag marks' }, [q.m + ' marks']));
    var wn = q.w && (String(q.w).match(/\d+/) || [])[0];
    if (wn) tags.push(el('span', { class: 'tag' }, [wn + ' words']));
    if (q.yr && q.yr.length) tags.push(el('span', { class: 'tag year' }, [q.yr.join(', ')]));
    (q.s || []).forEach(function (id) { tags.push(el('span', { class: 'tag syl' }, [sylLabel(id).split(' · ').pop()])); });

    var head = el('div', { class: 'qhead' });
    head.innerHTML = highlight(dispQ(q.q), terms);
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
  function pToday() { return new Date().toISOString().slice(0, 10); }
  function pBumpStreak() {
    var o = pStore(), s = o.s || { d: '', n: 0, t: 0 }, today = pToday();
    if (s.d !== today) {
      var y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      s.n = s.d === y ? s.n + 1 : 1;
      s.d = today;
    }
    s.t = (s.t || 0) + 1;
    o.s = s; pSave(o);
    return s;
  }
  function practicedToday() { return (pStore().s || {}).d === pToday(); }

  function wirePractice() {
    var dlg = $('#practice');
    $('#practice-open').addEventListener('click', function () {
      ensureQI(); ensureFull();
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      renderPractice();
      track('practice_open', {});
    });
    $('#practice-close').addEventListener('click', function () { dlg.close ? dlg.close() : dlg.removeAttribute('open'); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) (dlg.close ? dlg.close() : dlg.removeAttribute('open')); });
    $$('#practice-papers button').forEach(function (b) {
      if (b.disabled) return;
      b.addEventListener('click', function () {
        state.pp = b.dataset.pp;
        $$('#practice-papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.pp === state.pp)); });
      });
    });
    $('#practice-next').addEventListener('click', nextPracticeQ);
    refreshPracticeDot();
  }
  function refreshPracticeDot() {
    $('#practice-open').classList.toggle('nudge', !practicedToday());
  }

  function renderPractice() {
    var s = pStore().s || {};
    $('#practice-streak').textContent = s.n ? '🔥 ' + s.n + '-day streak · ' + (s.t || 0) + ' practised' : '';
    var body = $('#practice-body');
    if (!QI) { body.innerHTML = '<p class="hint">Loading questions…</p>'; return; }
    if (!body.dataset.has) body.innerHTML = '<p class="hint">Pick a paper (or leave it on “Any”), then hit the button for a random Mains question and the toppers who answered it.</p>';
  }

  function nextPracticeQ() {
    if (!QI) { renderPractice(); return; }
    var pp = state.pp || '';
    var base = QI.filter(function (q) { return (!pp || q.p === pp) && q.a && q.a.length; });
    if (!base.length) { $('#practice-body').innerHTML = '<p class="hint">No indexed questions for that paper yet.</p>'; return; }
    // prefer questions several toppers answered — more likely a genuine repeated PYQ, more to compare
    var pool = base.filter(function (q) { return q.a.length >= 3; });
    if (pool.length < 20) pool = base.filter(function (q) { return q.a.length >= 2; });
    if (pool.length < 10) pool = base;
    var o = pStore(); o.seen = o.seen || {};
    var key = pp || 'any';
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
    (q.s || []).forEach(function (id) { tags.push(el('span', { class: 'tag syl' }, [sylLabel(id).split(' · ').pop()])); });
    body.appendChild(el('div', { class: 'pq' }, [dispQ(q.q)]));
    body.appendChild(el('div', { class: 'tags' }, tags));
    var rows = answerRows(q);
    body.appendChild(el('div', { class: 'pans-h' }, [rows.length + (rows.length === 1 ? ' topper answered this' : ' toppers answered this') + (FULL ? '' : ' — links loading…')]));
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
    return out;
  }

  function copyCard(c, qs, count, nameHit) {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var openIt = (terms.length > 0 && !nameHit) || !!state.topper;
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
      var la = el('a', { class: 'open', href: c.u, target: '_blank', rel: 'noopener' }, ['Open copy']);
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
    var have = qs && qs.length ? qs : (terms.length ? [] : qOf(c));

    function renderQ(q) {
      var txt = el('div', { class: 'txt' });
      txt.innerHTML = highlight(q[1], terms);
      var meta = [];
      if (q[2]) meta.push(q[2] + ' marks');
      if (q[3]) meta.push(q[3] + (/\d$/.test(q[3]) ? ' words' : ''));
      if (meta.length) txt.appendChild(el('span', { class: 'qmeta' }, [meta.join('  ·  ')]));
      var href = c.u + (q[0] ? '#page=' + q[0] : '');
      var a = el('a', { class: 'open', href: href, target: '_blank', rel: 'noopener' }, [q[0] ? 'Open PDF · p.' + q[0] : 'Open PDF']);
      a.addEventListener('click', function () {
        track('pdf_open', {
          topper: c.t, paper: c.p, source: c.c || 'unknown',
          page: q[0] || 0, link_domain: hostOf(c.u), outbound: true, transport_type: 'beacon'
        });
      });
      return el('div', { class: 'q' }, [txt, a]);
    }

    if (have) {
      have.forEach(function (q) { ql.appendChild(renderQ(q)); });
    } else {
      // metadata-only so far — fill the list when the full text arrives
      ql.appendChild(el('div', { class: 'q loading' }, [
        el('div', { class: 'txt' }, ['Loading questions…']),
        el('a', { class: 'open', href: c.u, target: '_blank', rel: 'noopener' }, ['Open PDF'])
      ]));
    }

    var d = el('details', { class: 'copy', 'data-i': c.i, open: openIt ? '' : null }, [summary, ql]);
    var filled = have != null;
    function fillQuestions() {
      if (filled) return;
      ensureFull();
      (fullPromise || Promise.resolve()).then(function () {
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
      if (state.optQ && state.optSubject === 'all') state.optSubject = 'all';
      renderOptionals();
    }, 150));
  }

  function optCounts() {
    var m = {};
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
        state.optSubject = 'all'; state.optQ = ''; $('#opt-q').value = ''; renderOptionals();
      });
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
      list.forEach(function (o) { body.appendChild(optCard(o)); });
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
        state.optSubject = sub; renderOptionals(); window.scrollTo(0, 0);
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
      var href = o.url + (page ? '#page=' + page : '');
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
    analyseLoaded = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'assets/analyse.js'; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
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
      var isCopy = kind === 'copy';
      var title = (isCopy ? '[copy] ' : '[data] ') + g('topper') +
        (g('air') ? ' — AIR ' + g('air') : '') + ' · ' + g('paper');

      var L = ['### ' + (isCopy ? 'New topper copy' : 'Topper data correction'), '',
        '| field | value |', '| --- | --- |',
        '| Topper | ' + g('topper') + ' |',
        '| AIR | ' + (g('air') || '—') + ' |',
        '| Year | ' + (g('year') || '—') + ' |',
        '| Paper / subject | ' + g('paper') + ' |'];
      if (isCopy) {
        L.push('| Copy link | ' + (g('url') || '—') + ' |');
        L.push('| Source / coaching | ' + (g('source') || '—') + ' |');
        L.push('| Marks in this paper | ' + (g('marks') || '—') + ' |');
        if (analysis && analysis.count) L.push('| Questions (auto-estimated) | ~' + analysis.count + ' over ' + analysis.numPages + ' pages · ' + analysis.method + ' |');
      } else {
        L.push('| Subject-wise marks | ' + (g('allmarks') || '—') + ' |');
      }
      L.push('| Submitted by | ' + (g('by') || 'anonymous') + ' |', '',
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
