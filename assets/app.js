/* Toppers Copy — the whole client. A free, open, community-built index of UPSC Mains topper answer copies.
 *
 * Data it reads (all written by build.js):
 *   data/copies.json              every copy, grouped by topper — the only file needed to boot
 *   data/questions-<paper>.json   one shard per paper: a table of copy URLs, then
 *                                 [text, [[urlIndex, page], …], [syllabus ids], marks, words] per question
 *   data/syllabus.json            the hand-written syllabus tree, for filter labels
 *
 * A copy's URL is its key everywhere. A shard ref whose URL is not in copies.json is skipped
 * when the shard is indexed — the only thing a cache skew between the two files can do.
 *
 * Search: a topper-name match comes from the copies (always in memory); a text match is an
 * indexOf() over every question in every loaded shard the paper filter allows. While a needed
 * shard is still downloading the result line says so and never prints a zero.
 *
 * Reading order: helpers → data loading → boot → theme/tabs/URL → browse (search, cards)
 * → questions view → practice → optionals tab → submit tab.
 */
(function () {
  'use strict';

  var REPO = 'hashin/topperscopy';
  var VOLUNTEER_EMAIL = 'mail@hashin.me';
  // Free, no-server delivery for the "Be a volunteer" form via a Google Form: make a form with 4
  // short-answer questions in this order — Name, Phone, Email, Note — then ⋮ → "Get pre-filled
  // link" and paste it here. Leave blank and the form falls back to the visitor's email app.
  var VOLUNTEER_GFORM_PREFILL = 'https://docs.google.com/forms/d/e/1FAIpQLSdQuclzAeXv2NwFOY-a69lizKH0Z2RPvI7UZnX6YSTSfShBbA/viewform?usp=pp_url&entry.315186582=Name&entry.11599235=Phone&entry.1379505232=Email&entry.960606364=Note';
  var PAPERS = ['GS1', 'GS2', 'GS3', 'GS4', 'Essay', 'Other'];   // any other paper is an optional subject
  var OPTIONALS = ['Sociology', 'Anthropology', 'History', 'PSIR', 'Geography',
    'Public Administration', 'Philosophy', 'Psychology', 'Economics', 'Mathematics', 'Physics',
    'Chemistry', 'Commerce & Accountancy', 'Law', 'Management', 'Medical Science',
    'Agriculture', 'Statistics', 'Literature', 'Forest Service (IFS)', 'Other'];
  var SHARDS_ALL = ['gs1', 'gs2', 'gs3', 'gs4', 'essay', 'other', 'optional'];
  var PAGE = 25;
  var NAME_HIT_SCORE = 1e6;   // "Best match": a topper-name hit always outranks a text hit
  var BAR = ['#09A1A1', '#F6C992', '#D396A6', '#5484A4', '#ACC0D3', '#30525C'];

  /* ---------- tiny helpers ---------- */
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
  // Every outbound link comes from data; anything that is not http(s) becomes an inert "#".
  var safeHref = function (u) { return /^https?:\/\//i.test(String(u || '')) ? u : '#'; };
  var fmt = function (n) { return (n || 0).toLocaleString('en-IN'); };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, x = this; clearTimeout(t); t = setTimeout(function () { fn.apply(x, a); }, ms); }; };
  var isOptional = function (p) { return PAPERS.indexOf(p) < 0; };
  var shardOf = function (p) { return isOptional(p) ? 'optional' : p.toLowerCase(); };
  var SHARD_PAPER = { gs1: 'GS1', gs2: 'GS2', gs3: 'GS3', gs4: 'GS4', essay: 'Essay', other: 'Other' };
  // strip a leading "Q.12)" for display
  var dispQ = function (t) { return String(t || '').replace(/^\s*(?:Q(?:uestion)?\.?\s*)?\d{1,3}[.\):\-]?\s+/i, ''); };
  // a small stable hash for a question (Practice's "seen" list, card open-state) — collisions are harmless
  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'unknown'; } }

  /* ---------- analytics ---------- */
  var VIEW_TITLE = { browse: 'Browse copies', optionals: 'Optional subjects', submit: 'Submit', about: 'About' };
  function ga() { return (typeof window.gtag === 'function') ? window.gtag : function () { (window.dataLayer = window.dataLayer || []).push(arguments); }; }
  function track(name, params) { try { ga()('event', name, params || {}); } catch (e) {} }
  function pageView(view) {
    var path = '/' + (view === 'browse' ? '' : view);
    try { ga()('event', 'page_view', { page_title: 'Toppers Copy — ' + (VIEW_TITLE[view] || view), page_location: location.origin + path, page_path: path }); } catch (e) {}
  }

  /* ---------- data ---------- */
  var DB = null;          // parsed data/copies.json
  var COPIES = [];        // every copy: { t, p, c, u, n, link, note, T (its topper), tlc (name lowercased) }
  var COPYBYURL = {};
  var TOPPERS = {};       // name -> { air, year, verified, marks, telegram, copies:[copy] }
  var SHARDS = {};        // shard name -> { questions:[q], fragments:[q], all:[q], byCopy:{url:[{q,page}]} }
  var SHARD_ERR = {};     // shard name -> true once its download failed (reload the page to retry)
  var SYL = null;         // data/syllabus.json
  var LOADS = {};         // url -> promise; one fetch per file, ever

  function load(url) {
    if (!LOADS[url]) {
      LOADS[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.json(); })
        .catch(function (e) { delete LOADS[url]; throw e; });
    }
    return LOADS[url];
  }

  function ensureShard(name) {
    var url = 'data/questions-' + name + '.json';
    if (SHARDS[name] || SHARD_ERR[name] || LOADS[url]) return;
    load(url).then(function (d) { SHARDS[name] = indexShard(d, name); onShardLoaded(name); },
      function (e) { SHARD_ERR[name] = true; track('data_error', { message: 'shard ' + name + ' ' + String(e && e.message || e).slice(0, 100) }); rerender(); });
  }
  function ensureShards(names) { (names || SHARDS_ALL).forEach(ensureShard); }
  function ensureSyllabus() {
    if (SYL || LOADS['data/syllabus.json']) return;
    load('data/syllabus.json').then(function (s) { SYL = s; fillSyllabus(); fillPracticeSyl(); }, function () {});
  }
  // Prefetch every shard once the page is idle, so a search that comes later is already answered.
  // On a metered or 2G connection wait longer, but still fetch — search is the product.
  function scheduleShards() {
    var c = navigator.connection || {};
    var slow = !!c.saveData || c.effectiveType === 'slow-2g' || c.effectiveType === '2g';
    var go = function () { ensureShards(); ensureSyllabus(); };
    if (slow) { setTimeout(go, 6000); return; }
    (window.requestIdleCallback || function (fn) { setTimeout(fn, 1500); })(go, { timeout: 4000 });
  }

  // A shard's question: { id, txt, lc, refs:[{c, page}], s, m, w, p, kind }. Refs are resolved to
  // copies here (a URL copies.json does not know is dropped) and the text is lowercased once, so
  // a keystroke never re-lowercases the corpus. byCopy is the reverse map a copy card uses.
  function indexShard(d, name) {
    var sh = { questions: [], fragments: [], all: [], byCopy: {} };
    function add(rows, kind, into) {
      (rows || []).forEach(function (r) {
        var refs = [];
        r[1].forEach(function (ref) { var c = COPYBYURL[d.urls[ref[0]]]; if (c) refs.push({ c: c, page: ref[1] }); });
        if (!refs.length) return;
        var q = { txt: r[0], lc: r[0].toLowerCase(), refs: refs, s: r[2] || [], m: r[3] || '', w: r[4] || '', kind: kind,
          p: name === 'optional' ? refs[0].c.p : SHARD_PAPER[name] };
        q.id = fnv(q.p + '|' + q.txt);
        into.push(q); sh.all.push(q);
        refs.forEach(function (ref) { (sh.byCopy[ref.c.u] = sh.byCopy[ref.c.u] || []).push({ q: q, page: ref.page }); });
      });
    }
    add(d.questions, 'q', sh.questions);
    add(d.fragments, 'f', sh.fragments);
    for (var u in sh.byCopy) sh.byCopy[u].sort(function (a, b) { return a.page - b.page; });
    return sh;
  }
  // the shards a paper filter needs
  function shardsFor(paper) {
    if (paper === 'all') return SHARDS_ALL;
    if (paper === 'Optional' || isOptional(paper)) return ['optional'];
    return [paper.toLowerCase()];
  }
  // a copy's question rows from its shard, or null while that shard is still loading
  function copyRows(c) {
    var sh = SHARDS[shardOf(c.p)];
    if (!sh) { ensureShard(shardOf(c.p)); return null; }
    return sh.byCopy[c.u] || [];
  }
  var PRACTICE_WANTED = false, practiceIntent = null;
  function onShardLoaded(name) {
    track('shard_loaded', { shard: name });
    fillSyllabus();
    if (name === 'optional') {
      var btn = $('#practice-papers button[data-pp="Optional"]');
      var has = SHARDS.optional.questions.length > 0;
      if (btn) { btn.disabled = !has; btn.textContent = has ? 'Optional' : 'Optional ▸ after OCR'; }
      if (practiceIntent) { openPracticeFor(practiceIntent); practiceIntent = null; }
    }
    rerender();
  }
  // re-render whatever is on screen after data arrives
  function rerender() {
    if (!DB) return;
    if (state.view === 'browse') renderBrowse();
    if (state.view === 'optionals') renderOptionals();
    if ($('#practice').open) { fillPracticeSyl(); if (PRACTICE_WANTED) nextPracticeQ(); else renderPractice(); }
  }

  var state = {
    view: 'browse', q: '', mode: 'all', paper: 'all',
    topper: '', source: '', year: '', sort: 'best', shown: PAGE,
    qview: 'copies', syl: '', pp: '', psyl: '',
    optSubject: 'all', optQ: '', optShown: PAGE
  };
  var LASTCOUNT = 0;

  /* ---------- boot ---------- */
  function boot() {
    wireTheme(); wireTabs(); wireBrowse(); wireOptionals(); wireSubmit(); wireToolbarCollapse();
    var initial = location.hash ? location.hash.replace('#', '') : 'browse';
    if (location.hash) setView(initial); else pageView('browse');
    track('app_ready', { theme: document.documentElement.getAttribute('data-theme') || 'system',
      entry_view: ['browse', 'optionals', 'submit', 'about'].indexOf(initial) < 0 ? 'browse' : initial });

    load('data/copies.json').then(function (d) {
      DB = d;
      Object.keys(d.toppers).forEach(function (name) {
        var T = d.toppers[name];
        T.marks = T.marks || {}; T.copies = T.copies.map(function (r) {
          var c = { t: name, p: r[0], c: r[1], u: r[2], n: r[3], link: !!r[4], note: r[5] || '', T: T, tlc: name.toLowerCase() };
          COPIES.push(c); COPYBYURL[c.u] = c;
          return c;
        });
        TOPPERS[name] = T;
      });
      var sk = $('#results-skeleton'); if (sk) sk.remove();
      onData();
      track('data_loaded', { copies: COPIES.length });
      scheduleShards();
    }).catch(function (e) {
      var sk = $('#results-skeleton'); if (sk) sk.remove();
      $('#sub').textContent = 'Could not load the database — ' + e.message;
      track('data_error', { message: String(e && e.message || e).slice(0, 120) });
    });

    // ?q= (the JSON-LD SearchAction, shared links) — and whatever is already typed in the box:
    // #q is live from first paint but this script is deferred, so a fast typist's query would
    // otherwise be shown but never searched.
    var qi = $('#q'), params = new URLSearchParams(location.search);
    var qp = params.get('q');
    if (!qp && qi && qi.value) qp = qi.value;
    if (qp) {
      qp = qp.trim().slice(0, 200);
      state.q = qp; state.shown = PAGE;
      if (qi && qi.value !== qp) qi.value = qp;
      ensureShards(); ensureSyllabus();
    }
    var prc = params.get('practice');                 // ?practice=<subject-slug> from an /optional/ page
    if (prc) { practiceIntent = prc.trim().slice(0, 60); ensureShard('optional'); }
    var pp = params.get('paper');                     // ?paper=GS1 from a /paper/ hub page
    if (pp && PAPERS.concat(['Optional']).indexOf(pp) >= 0) state.paper = pp;
    var sylp = params.get('syl');                     // ?syl=<node id> — a shared syllabus filter
    if (sylp) { state.syl = sylp.trim().slice(0, 60); state.qview = 'questions'; ensureShards(); ensureSyllabus(); }

    document.addEventListener('click', function (e) {   // outbound-link tracking for static links
      var a = e.target.closest('a[href^="http"]');
      if (!a || a.classList.contains('open')) return;
      var host = hostOf(a.href);
      if (host && host !== location.hostname) track('click_outbound', { link_domain: host, link_url: a.href.slice(0, 200), transport_type: 'beacon' });
    });
    var localDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]';
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || localDev)) navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  function onData() {
    var g = DB.stats.all;
    var optCopies = COPIES.filter(function (c) { return isOptional(c.p); }).length;
    $('#sub').textContent = fmt(g.questions) + ' searchable questions · ' + fmt(g.copies) + ' answer copies · ' + fmt(g.toppers) + ' toppers' +
      (optCopies ? ' · ' + fmt(optCopies) + ' optional-subject copies' : '');
    $('#statline').innerHTML = chipStat(g.questions, 'questions') + chipStat(g.copies, 'copies') + chipStat(g.toppers, 'toppers') + chipStat(g.subjects, 'subjects');
    $('#foot-stats').textContent = 'Data snapshot ' + DB.generated;
    $('#about-gen').textContent = 'Database snapshot: ' + DB.generated;
    buildPaperSeg();
    refreshFacets();
    fillSelect($('#sform select[name=paper]'), PAPERS.filter(function (p) { return p !== 'Other'; }).map(function (p) { return [p, p]; })
      .concat(OPTIONALS.map(function (o) { return ['Optional — ' + o, 'Optional — ' + o]; })));
    renderBrowse();
    renderOptionals();
  }
  function chipStat(n, label) { return '<span class="s"><b>' + fmt(n) + '</b> ' + label + '</span>'; }

  /* ---------- theme ---------- */
  function wireTheme() {
    var btn = $('#theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = (cur ? cur === 'dark' : sysDark) ? 'light' : 'dark';
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
    $$('nav.tabs button').forEach(function (b) { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('.view').forEach(function (sec) { sec.hidden = sec.id !== 'view-' + v; });
    if (v !== 'browse' && TB.unslim) TB.unslim();
    if (location.hash.replace('#', '') !== v) history.replaceState(null, '', '#' + v);
    // A Back navigation that landed while another tab was showing changed the URL but not
    // Browse's state — resync only when they disagree, so an ordinary tab switch keeps "Show more".
    if (v === 'browse') {
      var u = urlState();
      if (u.q !== state.q || u.paper !== state.paper || u.syl !== state.syl) applyUrlToState();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    pageView(v);
    if (changed) track('tab_view', { view: v });
  }

  /* ---------- the search in the URL (?q= ?paper= ?syl=) ---------- */
  function urlState() {
    var p = new URLSearchParams(location.search), paper = p.get('paper');
    return {
      q: (p.get('q') || '').trim().slice(0, 200),
      paper: (paper && PAPERS.concat(['Optional']).indexOf(paper) >= 0) ? paper : 'all',
      syl: (p.get('syl') || '').trim().slice(0, 60)
    };
  }
  // pushState once, on the empty->non-empty transition, so Back undoes a search instead of
  // leaving the site — but not one entry per keystroke. "Was empty" is read off the URL itself.
  function syncUrl() {
    try {
      var u = new URL(location.href);
      var wasEmpty = !u.searchParams.get('q');
      if (state.q) u.searchParams.set('q', state.q); else u.searchParams.delete('q');
      if (state.paper !== 'all') u.searchParams.set('paper', state.paper); else u.searchParams.delete('paper');
      if (state.syl) u.searchParams.set('syl', state.syl); else u.searchParams.delete('syl');
      if (u.href === location.href) return;
      if (wasEmpty && state.q) history.pushState(null, '', u); else history.replaceState(null, '', u);
    } catch (e) { /* no History API — search still works, just not shareable */ }
  }
  function applyUrlToState() {
    if (!DB) return;
    var u = urlState();
    state.q = u.q; state.paper = u.paper; state.syl = u.syl; state.shown = PAGE;
    if (state.syl) state.qview = 'questions';
    var qi = $('#q'); if (qi && qi.value !== state.q) qi.value = state.q;
    $$('#papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.paper === state.paper)); });
    $$('#qview button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.qview === state.qview)); });
    var sel = $('#syl'); if (sel) sel.value = state.syl;
    if (state.q || state.syl) { ensureShards(); ensureSyllabus(); }
    renderBrowse();
  }
  window.addEventListener('popstate', function () { if (state.view === 'browse') applyUrlToState(); });

  /* ---------- browse: controls ---------- */
  function wireBrowse() {
    $('#q').addEventListener('focus', function () { ensureShards(); ensureSyllabus(); }, { once: true });
    $('#q').addEventListener('input', debounce(function (e) {
      state.q = e.target.value.trim(); state.shown = PAGE;
      if (state.q) ensureShards();
      renderBrowse();
    }, 160));
    $('#q').addEventListener('input', debounce(function (e) {   // log the settled query, not every keystroke
      var term = e.target.value.trim();
      if (term.length >= 2) track('search', { search_term: term.toLowerCase().slice(0, 100), mode: state.mode, paper: state.paper, results: LASTCOUNT });
    }, 900));
    $$('#mode button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.mode = b.dataset.mode;
        $$('#mode button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
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
      b.addEventListener('click', function () { setQView(b.dataset.qview); track('filter_change', { filter: 'qview', value: b.dataset.qview }); });
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
    if (v === 'questions') { ensureShards(); ensureSyllabus(); }
    renderBrowse();
  }
  // paper chips: every GS paper present, plus one "Optionals" chip for every optional subject
  function buildPaperSeg() {
    var row = $('#papers'), frag = document.createDocumentFragment();
    var counts = {}, opt = 0;
    COPIES.forEach(function (c) { if (isOptional(c.p)) opt++; else counts[c.p] = (counts[c.p] || 0) + 1; });
    var defs = [['all', 'All', 0]].concat(PAPERS.filter(function (p) { return counts[p]; }).map(function (p) { return [p, p, counts[p]]; }));
    if (opt) defs.push(['Optional', 'Optionals', opt]);
    defs.forEach(function (d) {
      var b = el('button', { 'data-paper': d[0], 'aria-pressed': String(state.paper === d[0]) }, [d[1] + (d[2] ? ' · ' + fmt(d[2]) : '')]);
      b.addEventListener('click', function () {
        state.paper = d[0]; state.shown = PAGE;
        $$('#papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.paper === d[0])); });
        renderBrowse();
        track('filter_change', { filter: 'paper', value: d[0] });
      });
      frag.appendChild(b);
    });
    row.replaceChildren(frag);   // built off-DOM and swapped once, so the row never measures 0 for a frame
  }
  function refreshFacets() {
    var t = {}, s = {}, y = {};
    COPIES.forEach(function (c) {
      if (c.t !== 'Unknown') t[c.t] = (t[c.t] || 0) + 1;
      if (c.c) s[c.c] = (s[c.c] || 0) + 1;
      var yr = yearOf(c); if (yr) y[yr] = (y[yr] || 0) + 1;
    });
    fillSelect($('#topper'), Object.keys(t).sort().map(function (n) { return [n, n + (TOPPERS[n].air ? ' · AIR ' + TOPPERS[n].air : '') + ' (' + t[n] + ')']; }), state.topper);
    fillSelect($('#source'), Object.keys(s).sort().map(function (x) { return [x, x + ' (' + s[x] + ')']; }), state.source);
    fillSelect($('#year'), Object.keys(y).sort().reverse().map(function (x) { return [x, x + ' (' + y[x] + ')']; }), state.year);
  }
  function fillSelect(sel, pairs, keep) {
    if (!sel) return;
    var first = sel.querySelector('option'), frag = document.createDocumentFragment();
    if (first && first.value === '') frag.appendChild(first);
    pairs.forEach(function (p) { frag.appendChild(el('option', { value: p[0] }, [p[1]])); });
    sel.replaceChildren(frag);
    if (keep) sel.value = keep;
  }
  function fillSyllabus() {
    var sel = $('#syl'); if (!sel || !SYL) return;
    var counts = {};
    SHARDS_ALL.forEach(function (n) { if (SHARDS[n]) SHARDS[n].questions.forEach(function (q) { q.s.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; }); }); });
    var frag = document.createDocumentFragment();
    frag.appendChild(el('option', { value: '' }, ['Whole syllabus']));
    Object.keys(SYL.papers).forEach(function (p) {
      var og = el('optgroup', { label: p });
      (SYL.papers[p].nodes || []).forEach(function (n) { og.appendChild(el('option', { value: n.id }, [n.t + (counts[n.id] ? ' (' + counts[n.id] + ')' : '')])); });
      frag.appendChild(og);
    });
    sel.replaceChildren(frag);
    sel.value = state.syl;
  }
  function sylLabel(id) {
    if (!SYL) return id;
    for (var p in SYL.papers) {
      var hit = (SYL.papers[p].nodes || []).filter(function (n) { return n.id === id; })[0];
      if (hit) return p + ' · ' + hit.t;
    }
    return id;
  }

  /* ---------- browse: search ---------- */
  function terms() { return state.q.toLowerCase().split(/\s+/).filter(Boolean); }
  // "All words": every term is a substring; "Exact phrase": the joined query is a substring.
  function matches(lc, ts, mode) {
    if (mode === 'exact') return lc.indexOf(ts.join(' ')) >= 0;
    for (var i = 0; i < ts.length; i++) if (lc.indexOf(ts[i]) < 0) return false;
    return true;
  }
  var yearOf = function (c) { return c.T.year || 0; };
  var airOf = function (c) { return c.T.air || 0; };
  var paperOk = function (c) { return state.paper === 'all' || c.p === state.paper || (state.paper === 'Optional' && isOptional(c.p)); };

  // Scan every loaded shard the paper filter allows. Returns copy url -> [{q, page}] for the
  // questions that matched, plus whether a needed shard is still loading or failed.
  function textHits(ts) {
    var hits = {}, loading = false, failed = false;
    shardsFor(state.paper).forEach(function (name) {
      var sh = SHARDS[name];
      if (!sh) { if (SHARD_ERR[name]) failed = true; else { loading = true; ensureShard(name); } return; }
      sh.all.forEach(function (q) {
        if (!matches(q.lc, ts, state.mode)) return;
        q.refs.forEach(function (ref) { (hits[ref.c.u] = hits[ref.c.u] || []).push({ q: q, page: ref.page }); });
      });
    });
    return { hits: hits, loading: loading, failed: failed };
  }

  // -> { list: [{ c, qs, nameHit, score }], loading, failed }. A name hit matches straight away;
  // a text hit needs the copy's shard. Score for "Best match": name hit = a huge constant,
  // otherwise the number of matched questions, +0.5 when one of them contains the whole phrase.
  function filteredCopies() {
    var ts = terms(), th = ts.length ? textHits(ts) : null, phrase = ts.join(' ');
    var list = [];
    COPIES.forEach(function (c) {
      if (!paperOk(c)) return;
      if (state.topper && c.t !== state.topper) return;
      if (state.source && c.c !== state.source) return;
      if (state.year && String(yearOf(c)) !== state.year) return;
      var nameHit = ts.length > 0 && matches(c.tlc, ts, 'all');
      var qs = [], score = nameHit ? NAME_HIT_SCORE : 0;
      if (ts.length && !nameHit) {
        qs = th.hits[c.u] || [];
        if (!qs.length) return;
        qs.sort(function (a, b) { return a.page - b.page; });
        score = qs.length;
        if (ts.length > 1 && state.mode === 'all') for (var k = 0; k < qs.length; k++) if (qs[k].q.lc.indexOf(phrase) >= 0) { score += 0.5; break; }
      }
      list.push({ c: c, qs: qs, nameHit: nameHit, score: score, n: qs.length || c.n });
    });
    list.sort(function (a, b) {
      if (state.sort === 'best' && state.q && a.score !== b.score) return b.score - a.score;
      if (state.sort === 'qty') return b.n - a.n;
      if (state.sort === 'air') return (airOf(a.c) || 1e9) - (airOf(b.c) || 1e9) || a.c.t.localeCompare(b.c.t);
      if (state.sort === 'name') return a.c.t.localeCompare(b.c.t) || a.c.p.localeCompare(b.c.p);
      var ya = yearOf(a.c), yb = yearOf(b.c);                 // newest year first, unknown last,
      if (ya !== yb) return yb - ya;                            // then best rank
      return (airOf(a.c) || 1e9) - (airOf(b.c) || 1e9) || a.c.t.localeCompare(b.c.t) || a.c.p.localeCompare(b.c.p);
    });
    return { list: list, loading: th ? th.loading : false, failed: th ? th.failed : false };
  }

  /* ---------- browse: rendering ---------- */
  function renderBrowse() {
    if (!DB) return;
    syncUrl(); updateFilterCount();
    if (state.qview === 'questions') return renderQuestions();
    var res = filteredCopies(), list = res.list, box = $('#results'), meta = $('#resultmeta');
    LASTCOUNT = list.length;
    var nameHits = 0, totalQ = 0;
    list.forEach(function (x) { totalQ += x.qs.length; if (x.nameHit) nameHits++; });
    // Never print a zero we are not sure of: while a needed shard is still downloading, say so.
    if (state.q && res.loading && !list.length) {
      meta.textContent = 'Searching inside ' + fmt(COPIES.length) + ' copies…';
    } else {
      var extra = '';
      if (state.q) {
        extra = ' for “' + state.q + '”' + (nameHits ? ' · ' + fmt(nameHits) + ' by topper name' : '') + (totalQ ? ' · ' + fmt(totalQ) + ' matching questions' : '');
        if (res.loading) extra += ' · still scanning inside the copies…';
      }
      meta.textContent = fmt(list.length) + (list.length === 1 ? ' copy' : ' copies') + extra;
    }
    var open = openIds(box);
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(emptyBox(res.loading ? 'Searching…' : res.failed ? 'Search is unavailable' : 'No matches',
        res.loading ? 'Loading the question text so it can look inside the copies.'
          : res.failed ? 'The question text could not be downloaded. Topper-name search still works — reload the page to retry.'
            : 'Try a topper name, fewer words, “All words”, or clear a filter.'));
      return;
    }
    appendCards(list, 0, state.shown, box, open, null);
    if (list.length > state.shown) box.appendChild(moreButton(list, box));
  }
  function openIds(box) { var o = {}; $$('.copy[open]', box).forEach(function (n) { o[n.getAttribute('data-i')] = 1; }); return o; }
  function emptyBox(big, small) { return el('div', { class: 'empty' }, [el('div', { class: 'big' }, [big]), el('div', {}, [small])]); }

  // Render list[from..to) into box, before `mark` when given, with a year header whenever the
  // year changes (Best match with no query falls through to the same newest-first order).
  function appendCards(list, from, to, box, open, mark) {
    var put = function (node) { mark ? box.insertBefore(node, mark) : box.appendChild(node); };
    var grouped = state.sort === 'year' || (state.sort === 'best' && !state.q), counts = {};
    if (grouped) list.forEach(function (x) { var y = yearOf(x.c); counts[y] = (counts[y] || 0) + 1; });
    var curY = (grouped && from > 0) ? yearOf(list[from - 1].c) : null;
    list.slice(from, to).forEach(function (x) {
      if (grouped) {
        var y = yearOf(x.c);
        if (y !== curY) {
          curY = y;
          put(el('div', { class: 'yeargroup' }, [el('span', { class: 'yg-year' }, [y ? String(y) : 'Year not recorded']),
            el('span', { class: 'yg-count' }, [fmt(counts[y]) + (counts[y] === 1 ? ' copy' : ' copies')])]));
        }
      }
      put(copyCard(x.c, x.qs, x.nameHit, !!open[x.c.u], terms()));
    });
  }
  function moreLabel(list) { return 'Show ' + Math.min(PAGE, list.length - state.shown) + ' more  ·  ' + fmt(list.length - state.shown) + ' hidden'; }
  // Appends before this same button (the node the browser's scroll anchoring holds on to) rather
  // than rebuilding the list — expanded cards stay expanded and the viewport does not jump.
  function moreButton(list, box) {
    var more = el('button', { class: 'more' }, [moreLabel(list)]);
    more.addEventListener('click', function () {
      var from = state.shown; state.shown += PAGE;
      appendCards(list, from, state.shown, box, {}, more);
      if (list.length > state.shown) more.textContent = moreLabel(list); else more.remove();
    });
    return more;
  }

  function topperTags(c) {
    var T = c.T, out = [];
    if (T.air) out.push(el('span', { class: 'tag air' }, ['AIR ' + T.air + (T.verified ? ' ✓' : '')]));
    if (T.year) out.push(el('span', { class: 'tag year' }, [String(T.year)]));
    if (T.marks[c.p] != null) out.push(el('span', { class: 'tag marks' }, [c.p + ' ' + T.marks[c.p]]));
    if (T.telegram) {
      var a = el('a', { class: 'tag tg', href: safeHref(T.telegram), target: '_blank', rel: 'noopener' }, ['Telegram ↗']);
      a.addEventListener('click', function (e) { e.stopPropagation(); });
      out.push(a);
    }
    return out;
  }
  function pdfLink(c, page, label, extra) {
    var a = el('a', { class: 'open', href: safeHref(c.u + (page ? '#page=' + page : '')), target: '_blank', rel: 'noopener' }, [label]);
    a.addEventListener('click', function () {
      track('pdf_open', Object.assign({ topper: c.t, paper: c.p, source: c.c || 'unknown', page: page || 0, link_domain: hostOf(c.u), outbound: true, transport_type: 'beacon' }, extra || {}));
    });
    return a;
  }
  // One card for every kind of copy. `qs` = the question rows that matched the query (only those
  // are listed then); with no text match the card lists every question from its shard on expand.
  function copyCard(c, qs, nameHit, forceOpen, ts) {
    var openIt = forceOpen || (ts.length > 0 && !nameHit) || !!state.topper;
    var tags = [el('span', { class: 'tag paper' }, [c.p])].concat(c.c ? [el('span', { class: 'tag' }, [c.c])] : []).concat(topperTags(c));
    var n = qs.length || c.n;
    var summary = el('summary', {}, [
      el('span', { class: 'name' }, [c.t]),
      el('span', { class: 'qn' }, [c.link ? 'link only' : n + (n === 1 ? ' question' : ' questions')]),
      el('span', { class: 'tags' }, tags)
    ]);
    var ql = el('div', { class: 'qlist' });
    var d = el('details', { class: 'copy', 'data-i': c.u, open: openIt ? '' : null }, [summary, ql]);
    if (c.link) {
      ql.appendChild(el('div', { class: 'q' }, [el('div', { class: 'txt' }, [c.note || 'Scanned answer copy — not text-searchable. Open it to read.']), pdfLink(c, 0, 'Open copy', { link_only: true })]));
      return d;
    }
    var filled = false;
    function fill() {
      if (filled) return;
      var rows = qs.length ? qs : copyRows(c);
      ql.innerHTML = '';
      if (!rows) {   // shard still downloading — the re-render on arrival fills this in
        ql.appendChild(el('div', { class: 'q loading' }, [el('div', { class: 'txt' }, ['Loading questions…']), pdfLink(c, 0, 'Open PDF')]));
        return;
      }
      filled = true;
      if (c.note) ql.appendChild(el('div', { class: 'q' }, [el('div', { class: 'txt' }, [c.note])]));
      rows.forEach(function (r) {
        var txt = el('div', { class: 'txt' });
        txt.innerHTML = highlight(r.q.txt, ts);
        var meta = [];
        if (r.q.m) meta.push(r.q.m + ' marks');
        if (r.q.w) meta.push(r.q.w + (/\d$/.test(r.q.w) ? ' words' : ''));
        var mspan = el('span', { class: 'qmeta' }, meta.length ? [meta.join('  ·  ')] : []);
        mspan.appendChild(reportLink(c.p, r.q.txt, c.u, r.page));
        txt.appendChild(mspan);
        ql.appendChild(el('div', { class: 'q' }, [txt, pdfLink(c, r.page, r.page ? 'Open PDF · p.' + r.page : 'Open PDF')]));
      });
    }
    summary.addEventListener('click', function () {
      if (!d.open) { track('copy_open', { topper: c.t, paper: c.p, source: c.c || 'unknown', questions: n }); fill(); }
    });
    if (openIt) fill();
    return d;
  }
  function highlight(text, ts) {
    var h = esc(text);
    ts.forEach(function (w) {
      if (w.length < 2) return;
      h = h.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
    });
    return h;
  }
  // A reader who spots OCR damage is the cheapest correction signal we have: one click to a
  // pre-filled issue (the issue form prefills by field id, not &body=).
  function reportLink(paper, qtext, url, page) {
    var q = String(qtext || '').slice(0, 500);
    var href = 'https://github.com/' + REPO + '/issues/new?template=report-question-error.yml' +
      '&title=' + encodeURIComponent('[fix] ' + paper + ' — ' + q.slice(0, 60)) +
      '&question=' + encodeURIComponent(q) + '&copy=' + encodeURIComponent((url || '') + (url && page ? '#page=' + page : ''));
    var a = el('a', { class: 'reportq', href: href, target: '_blank', rel: 'noopener' }, ['Report a problem']);
    a.addEventListener('click', function (e) { e.stopPropagation(); track('report_question', { paper: paper }); });
    return a;
  }

  /* ---------- questions view ---------- */
  function renderQuestions() {
    var box = $('#results'), meta = $('#resultmeta'), ts = terms(), list = [], loading = false, failed = false;
    ensureSyllabus();
    shardsFor(state.paper).forEach(function (name) {
      var sh = SHARDS[name];
      if (!sh) { if (SHARD_ERR[name]) failed = true; else { loading = true; ensureShard(name); } return; }
      sh.questions.forEach(function (q) {
        if (state.syl && q.s.indexOf(state.syl) < 0) return;
        if (ts.length && !matches(q.lc, ts, state.mode)) return;
        list.push(q);
      });
    });
    list.sort(function (a, b) { return b.refs.length - a.refs.length || a.txt.localeCompare(b.txt); });
    var sylTxt = state.syl ? ' in ' + sylLabel(state.syl) : '';
    if (loading && !list.length) meta.textContent = 'Loading questions…';
    else meta.textContent = fmt(list.length) + (list.length === 1 ? ' question' : ' questions') + (state.q ? ' for “' + state.q + '”' : '') + sylTxt + (loading ? ' · still loading…' : '');
    var open = openIds(box);
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(emptyBox(loading ? 'Loading questions…' : failed ? 'Question text unavailable' : 'No questions',
        loading ? 'Building the list of distinct Mains questions and their topper answers.' : failed ? 'The question text could not be downloaded. Reload the page to retry.' : 'Clear a filter or try other words.'));
      return;
    }
    list.slice(0, state.shown).forEach(function (q) { box.appendChild(questionCard(q, !!open[String(q.id)], ts)); });
    if (list.length > state.shown) {
      var more = el('button', { class: 'more' }, ['Show ' + Math.min(PAGE, list.length - state.shown) + ' more  ·  ' + fmt(list.length - state.shown) + ' hidden']);
      more.addEventListener('click', function () { state.shown += PAGE; renderQuestions(); });
      box.appendChild(more);
    }
  }
  function questionTags(q, prefix) {
    var tags = [el('span', { class: 'tag paper' }, [q.p])];
    if (q.m) tags.push(el('span', { class: 'tag marks' }, [q.m + ' marks']));
    var wn = q.w && (String(q.w).match(/\d+/) || [])[0];
    if (wn) tags.push(el('span', { class: 'tag' }, [wn + ' words']));
    var yrs = {};
    q.refs.forEach(function (r) { if (yearOf(r.c)) yrs[yearOf(r.c)] = 1; });
    var yl = Object.keys(yrs).sort();
    if (yl.length) tags.push(el('span', { class: 'tag year' }, [(prefix || '') + yl.join(', ')]));
    q.s.forEach(function (id) { tags.push(el('span', { class: 'tag syl' }, [sylLabel(id).split(' · ').pop()])); });
    return tags;
  }
  // every copy that answered this question, best rank first
  function answerRows(q, from) {
    return q.refs.slice().sort(function (a, b) { return (airOf(a.c) || 1e9) - (airOf(b.c) || 1e9); })
      .map(function (r) {
        var meta = [r.c.t];
        if (airOf(r.c)) meta.push('AIR ' + airOf(r.c));
        if (r.c.c) meta.push(r.c.c);
        return el('div', { class: 'q' }, [el('div', { class: 'txt' }, [meta.join('  ·  ')]), pdfLink(r.c, r.page, r.page ? 'Open · p.' + r.page : 'Open copy', { from: from })]);
      });
  }
  function questionCard(q, forceOpen, ts) {
    var head = el('div', { class: 'qhead' });
    head.innerHTML = highlight(dispQ(q.txt), ts);
    head.appendChild(reportLink(q.p, dispQ(q.txt), q.refs[0].c.u, q.refs[0].page));
    var n = q.refs.length;
    var summary = el('summary', {}, [head, el('span', { class: 'qn' }, [n + (n === 1 ? ' answer' : ' answers')]), el('span', { class: 'tags' }, questionTags(q))]);
    var body = el('div', { class: 'qlist' });
    var d = el('details', { class: 'copy qcard', 'data-i': q.id, open: forceOpen ? '' : null }, [summary, body]);
    var filled = false;
    function fill() { if (filled) return; filled = true; answerRows(q, 'question').forEach(function (r) { body.appendChild(r); }); }
    d.addEventListener('toggle', function () { if (d.open && !filled) { fill(); track('question_open', { paper: q.p, answers: n }); } });
    if (forceOpen) fill();
    return d;
  }

  /* ---------- practice ---------- */
  function pStore() { try { return JSON.parse(localStorage.getItem('tc-practice') || '{}'); } catch (e) { return {}; } }
  function pSave(o) { try { localStorage.setItem('tc-practice', JSON.stringify(o)); } catch (e) {} }
  // local calendar date — a UTC day boundary is 05:30 in IST and would break a genuine streak
  function pDate(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function pBumpStreak() {
    var o = pStore(), s = o.s || { d: '', n: 0, t: 0 }, today = pDate();
    if (s.d !== today) { s.n = s.d === pDate(new Date(Date.now() - 864e5)) ? s.n + 1 : 1; s.d = today; }
    s.t = (s.t || 0) + 1;
    o.s = s; pSave(o);
  }
  function practicedToday() { return (pStore().s || {}).d === pDate(); }

  // The <dialog> is a direct child of <main>. showModal() relayouts the whole document, so the
  // long result list is pulled out of layout while it is up and the scroll position restored after.
  var _parkScroll = 0, _parked = [];
  function openPracticeDialog() {
    var dlg = $('#practice');
    if (dlg.open) return;
    _parkScroll = window.pageYOffset || 0; _parked = [];
    ['#opt-body', '#results'].forEach(function (s) { var n = $(s); if (n && !n.hidden && n.offsetParent !== null) { n.hidden = true; _parked.push(n); } });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function unparkList() {
    if (!_parked.length) return;
    _parked.forEach(function (n) { n.hidden = false; }); _parked = [];
    window.scrollTo(0, _parkScroll);
  }
  function closePracticeDialog() { var dlg = $('#practice'); if (dlg.open) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); } unparkList(); }

  function wirePractice() {
    var dlg = $('#practice');
    $('#practice-open').addEventListener('click', function () {
      ensureShards(); ensureSyllabus();
      openPracticeDialog();
      setTimeout(function () { fillPracticeSyl(); renderPractice(); }, 0);
      track('practice_open', {});
    });
    $('#practice-close').addEventListener('click', closePracticeDialog);
    dlg.addEventListener('close', unparkList);
    dlg.addEventListener('cancel', unparkList);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closePracticeDialog(); });
    if (window.MutationObserver) new MutationObserver(function () { if (!dlg.open) unparkList(); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
    $$('#practice-papers button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        state.pp = b.dataset.pp; state.psyl = '';
        $$('#practice-papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.pp === state.pp)); });
        fillPracticeSyl();
      });
    });
    $('#practice-syl').addEventListener('change', function (e) { state.psyl = e.target.value; track('practice_topic', { paper: state.pp, topic: e.target.value || '(any)' }); });
    $('#practice-next').addEventListener('click', nextPracticeQ);
    $('#practice-open').classList.toggle('nudge', !practicedToday());
  }
  // deep link from an /optional/<subject>/ page or the Optionals tab: practise one subject
  function openPracticeFor(want, from) {
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
    var match = Object.keys(optSubjects()).filter(function (s) { return norm(s) === norm(want); })[0];
    state.pp = 'Optional'; state.psyl = match || '';
    $$('#practice-papers button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.pp === 'Optional')); });
    openPracticeDialog();
    setTimeout(function () { fillPracticeSyl(); if (match) nextPracticeQ(); else renderPractice(); }, 0);
    track('practice_open', { from: from || 'optional_page', subject: match || want });
  }
  // optional subjects with practisable questions, with counts (needs the optional shard)
  function optSubjects() {
    var m = {};
    if (SHARDS.optional) SHARDS.optional.questions.forEach(function (q) { m[q.p] = (m[q.p] || 0) + 1; });
    return m;
  }
  // the second dropdown: syllabus topics of a GS/Essay paper, or the list of optional subjects
  function fillPracticeSyl() {
    var wrap = $('#practice-syl-wrap'), sel = $('#practice-syl'), lbl = $('#practice-syl-label'), p = state.pp;
    if (p === 'Optional') {
      var subs = optSubjects();
      lbl.textContent = 'Subject';
      sel.innerHTML = '<option value="">Any optional subject</option>';
      Object.keys(subs).sort().forEach(function (s) { sel.appendChild(el('option', { value: s }, [s + ' · ' + subs[s]])); });
      if (!(state.psyl && subs[state.psyl])) state.psyl = '';
      sel.value = state.psyl;
      wrap.hidden = Object.keys(subs).length === 0;
      return;
    }
    lbl.textContent = 'Topic';
    var sh = p && SHARDS[shardOf(p)];
    if (!p || !SYL || !SYL.papers[p] || !sh) {
      wrap.hidden = true; state.psyl = '';
      sel.innerHTML = '<option value="">Any topic</option>';
      return;
    }
    var counts = {};
    sh.questions.forEach(function (q) { q.s.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; }); });
    sel.innerHTML = '<option value="">Any topic in ' + p + '</option>';
    (SYL.papers[p].nodes || []).forEach(function (n) { if (counts[n.id]) sel.appendChild(el('option', { value: n.id }, [n.t + ' · ' + counts[n.id]])); });
    if (!(state.psyl && counts[state.psyl])) state.psyl = '';
    sel.value = state.psyl;
    wrap.hidden = false;
  }
  function renderPractice() {
    var s = pStore().s || {};
    $('#practice-streak').textContent = s.n ? '🔥 ' + s.n + '-day streak · ' + (s.t || 0) + ' practised' : '';
    var body = $('#practice-body');
    if (PRACTICE_WANTED) { body.innerHTML = '<p class="hint">Loading questions…</p>'; return; }
    if (!body.dataset.has) body.innerHTML = '<p class="hint">Pick a paper (GS, Essay or Optional) and, if you like, a topic — then hit the button for a random Mains question and the toppers who answered it.</p>';
  }
  function nextPracticeQ() {
    var pp = state.pp || '', psyl = state.psyl || '', isOpt = pp === 'Optional';
    var names = isOpt ? ['optional'] : pp ? [shardOf(pp)] : SHARDS_ALL.filter(function (n) { return n !== 'optional'; });
    var missing = names.filter(function (n) { return !SHARDS[n]; });
    if (missing.length) { PRACTICE_WANTED = true; ensureShards(missing); renderPractice(); return; }
    PRACTICE_WANTED = false;
    var base = [];
    names.forEach(function (n) {
      SHARDS[n].questions.forEach(function (q) {
        if (isOpt ? (psyl && q.p !== psyl) : (psyl && q.s.indexOf(psyl) < 0)) return;
        base.push(q);
      });
    });
    if (!base.length) {
      var what = psyl ? '“' + (isOpt ? psyl : sylLabel(psyl).split(' · ').pop()) + '”' : '';
      $('#practice-body').innerHTML = '<p class="hint">No questions ' + (what ? 'for ' + what + ' yet — try ' + (isOpt ? '“Any optional subject”.' : '“Any topic”.') : (isOpt ? 'from OCR yet.' : 'for that paper yet.')) + '</p>';
      return;
    }
    // prefer questions several toppers answered — more likely a genuine repeated PYQ, more to compare
    var pool = base.filter(function (q) { return q.refs.length >= 3; });
    if (pool.length < 20) pool = base.filter(function (q) { return q.refs.length >= 2; });
    if (pool.length < 10) pool = base;
    var o = pStore(); o.seen = o.seen || {};
    var key = isOpt ? 'opt:' + (psyl || 'any') : (pp || 'any');
    var seen = o.seen[key] || [];
    var fresh = pool.filter(function (q) { return seen.indexOf(q.id) < 0; });
    if (!fresh.length) { fresh = pool; seen = []; }
    var q = fresh[Math.floor(Math.random() * fresh.length)];
    seen.push(q.id); o.seen[key] = seen.slice(-600); pSave(o);
    pBumpStreak();
    $('#practice-open').classList.remove('nudge');

    var body = $('#practice-body'); body.dataset.has = '1'; body.innerHTML = '';
    body.appendChild(el('div', { class: 'pq' }, [dispQ(q.txt)]));
    body.appendChild(el('div', { class: 'tags' }, questionTags(q, 'asked ')));
    var rows = answerRows(q, 'practice');
    body.appendChild(el('div', { class: 'pans-h' }, [rows.length + (rows.length === 1 ? ' topper answered this' : ' toppers answered this')]));
    var list = el('div', { class: 'qlist' });
    rows.forEach(function (r) { list.appendChild(r); });
    body.appendChild(list);
    $('#practice-next').textContent = 'Another question';
    renderPractice();
    track('practice_question', { paper: q.p, answers: rows.length });
  }

  /* ---------- optionals tab ---------- */
  function wireOptionals() {
    $('#opt-q').addEventListener('input', debounce(function (e) {
      state.optQ = e.target.value.trim().toLowerCase(); state.optShown = PAGE;
      ensureShard('optional');
      renderOptionals();
    }, 150));
  }
  function renderOptionals() {
    if (!DB) return;
    var body = $('#opt-body'); body.innerHTML = '';
    var opts = COPIES.filter(function (c) { return isOptional(c.p); });
    var counts = {};
    opts.forEach(function (c) { counts[c.p] = (counts[c.p] || 0) + 1; });

    if (state.optQ || state.optSubject !== 'all') {   // a subject picked, or a search: the list
      ensureShard('optional');
      var back = el('div', { class: 'backrow' }, [el('button', { class: 'backbtn' }, ['← All subjects']), el('h2', {}, [state.optSubject === 'all' ? 'Search results' : state.optSubject])]);
      back.querySelector('.backbtn').addEventListener('click', function () {
        state.optSubject = 'all'; state.optQ = ''; state.optShown = PAGE; $('#opt-q').value = ''; renderOptionals();
      });
      if (state.optSubject !== 'all' && optSubjects()[state.optSubject]) {
        var pbtn = el('button', { class: 'practice-btn', type: 'button' }, ['Practise a ' + state.optSubject + ' question']);
        pbtn.addEventListener('click', function () { openPracticeFor(state.optSubject, 'optionals_tab'); });
        back.appendChild(pbtn);
      }
      body.appendChild(back);
      var ts = state.optQ.split(/\s+/).filter(Boolean), sh = SHARDS.optional;
      var list = opts.filter(function (c) {
        if (state.optSubject !== 'all' && c.p !== state.optSubject) return false;
        if (!ts.length) return true;
        var blob = (c.t + ' ' + c.note + ' ' + c.c).toLowerCase();
        if (sh) (sh.byCopy[c.u] || []).forEach(function (r) { blob += ' ' + r.q.lc; });
        return matches(blob, ts, 'all');
      });
      if (!list.length) {
        body.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'big' }, ['Nothing here yet']),
          el('div', {}, ['No ' + (state.optSubject === 'all' ? 'optional' : state.optSubject) + ' copies match. ']),
          el('a', { href: '#submit', 'data-goto': 'submit' }, ['Add the first one →'])]));
        return;
      }
      var shown = state.optShown || PAGE;
      list.slice(0, shown).forEach(function (c) { body.appendChild(copyCard(c, [], false, true, ts)); });
      if (list.length > shown) {
        var more = el('button', { class: 'more' }, ['Show ' + Math.min(PAGE, list.length - shown) + ' more  ·  ' + (list.length - shown) + ' hidden']);
        more.addEventListener('click', function () { state.optShown = shown + PAGE; renderOptionals(); });
        body.appendChild(more);
      }
      return;
    }

    var grid = el('div', { class: 'subject-grid' });   // default: the subject grid
    OPTIONALS.forEach(function (sub, i) {
      var n = counts[sub] || 0;
      var card = el('button', { class: 'subject-card', 'data-has': n ? '1' : '0', style: '--accent-bar:' + BAR[i % BAR.length] }, [
        el('div', { class: 'sname' }, [sub]), el('div', { class: 'scount' }, [n ? n + (n === 1 ? ' copy' : ' copies') : 'no copies yet'])]);
      card.addEventListener('click', function () {
        state.optSubject = sub; state.optShown = PAGE; renderOptionals(); window.scrollTo(0, 0);
        track('optional_subject_view', { subject: sub, copies: n });
      });
      grid.appendChild(card);
    });
    body.appendChild(grid);
    if (!opts.length) {
      body.appendChild(el('div', { class: 'empty', style: 'margin-top:14px' }, [el('div', { class: 'big' }, ['This section is brand new']),
        el('div', {}, ['Pick a subject above to add the first copy, or ']), el('a', { href: '#submit', 'data-goto': 'submit' }, ['open the Submit form →'])]));
    }
  }

  /* ---------- collapsing toolbar ---------- */
  // Once you scroll past the search box into the results, the search + filters fold into a slim
  // sticky bar so the results have room; a "Filters" button re-opens them.
  var TB = {};
  function updateFilterCount() {
    var badge = $('.filters-toggle .ft-count'); if (!badge) return;
    var n = 0;
    if (state.paper !== 'all') n++; if (state.mode !== 'all') n++; if (state.qview !== 'copies') n++;
    if (state.syl) n++; if (state.topper) n++; if (state.source) n++; if (state.year) n++; if (state.sort !== 'best') n++;
    badge.textContent = String(n); badge.hidden = n === 0;
  }
  function wireToolbarCollapse() {
    var tb = $('.toolbar'), sentinel = $('.toolbar-sentinel'), toggle = $('#filters-toggle'), header = document.querySelector('header.site');
    if (!tb || !sentinel || !toggle || !header) return;
    var hdrPx = 0, io = null;
    function unslim() { tb.classList.remove('slim', 'open'); toggle.setAttribute('aria-expanded', 'false'); }
    TB.unslim = unslim;
    // The header is sticky at top:0, so the toolbar sticks just below it and the trigger line sits at
    // the header's bottom edge. Header height changes on font load, resize and the mobile tab-wrap —
    // track it and re-arm the observer (its rootMargin cannot be changed in place).
    function sync() {
      var v = Math.round(header.getBoundingClientRect().height);
      if (!v || v > Math.max(240, window.innerHeight * 0.5) || v === hdrPx) return;   // 0 = hidden tab; huge = bogus reflow
      hdrPx = v;
      document.documentElement.style.setProperty('--hdr', v + 'px');
      if (!('IntersectionObserver' in window)) return;
      if (io) io.disconnect();
      io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting || state.view !== 'browse') { unslim(); return; }
        // On a short result list, folding the filters away shrinks the page enough that the browser
        // clamps the scroll back past the trigger, which re-expands the toolbar — a rapid loop. Only
        // collapse when there is enough page below the fold that this cannot happen.
        if (!tb.classList.contains('slim')) {
          var ff = tb.querySelector('.toolbar-filters');
          if (document.documentElement.scrollHeight - window.innerHeight - window.scrollY < (ff ? ff.getBoundingClientRect().height : 0) + 48) return;
        }
        tb.classList.add('slim');
      }, { rootMargin: '-' + (v + 8) + 'px 0px 0px 0px', threshold: 0 });
      io.observe(sentinel);
    }
    sync(); requestAnimationFrame(sync); setTimeout(sync, 400);
    if ('ResizeObserver' in window) new ResizeObserver(sync).observe(header); else window.addEventListener('resize', debounce(sync, 150));
    window.addEventListener('load', sync);
    toggle.addEventListener('click', function () {
      var open = tb.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      track('toolbar_filters', { open: open });
    });
  }

  /* ---------- submit tab ---------- */
  var analysis = null;          // { count, numPages, questions, method } from the PDF analyser
  var analyseLoaded = null;     // promise for lazily loading assets/analyse.js
  // extract.js + analyse.js (and pdf.js / Tesseract from a CDN behind them) load only when a
  // submitter clicks — a student browsing copies never pays for them.
  function loadAnalyser() {
    if (analyseLoaded) return analyseLoaded;
    function inject(src) {
      return new Promise(function (resolve, reject) { var s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
    }
    analyseLoaded = (self.TC && self.TC.extract ? Promise.resolve() : inject('assets/extract.js')).then(function () { return inject('assets/analyse.js'); });
    return analyseLoaded;
  }
  function wireAnalyse() {
    var panel = $('#analyse'); if (!panel) return;
    var statusEl = $('#an-status'), resultEl = $('#an-result'), lastSource = null, lastLabel = '';
    function status(msg, kind) { statusEl.hidden = false; statusEl.textContent = msg; statusEl.className = 'an-status' + (kind ? ' ' + kind : ''); }
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
          renderAnalysis(res);
        })
        .catch(function (e) {
          status((e && e.message) || 'Could not read that PDF. Try downloading it and choosing the file.', 'bad');
          track('analyse_error', { message: String(e && e.message || e).slice(0, 120), source: label, ocr: !!opts.ocr });
        });
    }
    function renderAnalysis(res) {
      statusEl.hidden = true; resultEl.hidden = false;
      if (!res.count) {
        var canOcr = (res.method === 'no-text') && lastSource;
        resultEl.appendChild(el('p', { class: 'an-status bad' }, [
          res.method === 'no-text' ? 'No text layer — this is a scanned PDF.'
            : res.method === 'ocr-empty' ? 'OCR read ' + res.numPages + ' pages but found no printed questions (the copy may have only handwriting).'
              : 'Read ' + res.numPages + ' pages but found nothing that looks like a question.']));
        if (canOcr) {
          var btn = el('button', { type: 'button', class: 'btn ghost', style: 'margin-top:10px' }, ['OCR the printed questions  (slow — a few minutes)']);
          btn.addEventListener('click', function () { btn.disabled = true; run(lastSource, lastLabel, { ocr: true }); });
          resultEl.appendChild(btn);
          resultEl.appendChild(el('p', { class: 'an-note' }, ['Renders each page and reads only the printed question at the top (handwriting is ignored). Runs in your browser.']));
        }
        return;
      }
      resultEl.appendChild(el('p', { class: 'an-count' }, [
        '≈ ', el('strong', {}, [String(res.count)]), ' questions detected across ' + res.numPages + ' pages',
        res.method === 'ocr' ? ' (via OCR)' : '', res.skipped ? ' · ' + res.skipped + ' pages skipped' : '', '.',
        el('span', { class: 'an-note' }, [res.method === 'ocr' ? ' OCR of scanned text — expect some errors. Review against the PDF before it goes live.' : ' Heuristic — review against the PDF before it goes live.'])]));
      var listWrap = el('div', { class: 'an-list' });
      res.questions.slice(0, 14).forEach(function (q) {
        var extra = (q.marks && !/marks?\b/i.test(q.question)) ? '  (' + q.marks + ' marks)' : '';
        listWrap.appendChild(el('div', { class: 'an-q' }, [el('span', { class: 'an-pg' }, ['p.' + q.page]), el('span', { class: 'an-qt' }, [q.question + extra])]));
      });
      if (res.questions.length > 14) listWrap.appendChild(el('div', { class: 'an-q more' }, ['+ ' + (res.questions.length - 14) + ' more']));
      resultEl.appendChild(listWrap);
      resultEl.appendChild(el('p', { class: 'an-note' }, ['These are attached to your GitHub issue automatically so a maintainer can drop them straight in.']));
    }
    $('#an-file').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (f) run(f, 'file'); });
    $('#an-url').addEventListener('click', function () {
      var u = ($('#sform [name=url]').value || '').trim();
      if (!/^https?:\/\//i.test(u)) { status('Paste the PDF link in the field below first.', 'bad'); return; }
      run(u, 'url');
    });
  }

  // parse the Google Forms "pre-filled link" into { action, entries:[name, phone, email, note] }
  function gformConfig() {
    if (!VOLUNTEER_GFORM_PREFILL) return null;
    try {
      var u = new URL(VOLUNTEER_GFORM_PREFILL), id = (u.pathname.match(/\/forms\/d\/e\/([^/]+)/) || [])[1], entries = [];
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
  function volunteerMailto(v) { return 'mailto:' + VOLUNTEER_EMAIL + '?subject=' + encodeURIComponent('Volunteer — ' + v.name) + '&body=' + encodeURIComponent(volunteerText(v)); }
  // POST to the Google Form. `no-cors` gives an opaque response and a flaky promise, so fire,
  // retry once, then treat it as sent — the form always shows the "didn't hear back?" fallback.
  function postToGForm(cfg, v, done) {
    var vals = [v.name, v.phone, v.email, v.note || ''], body = new URLSearchParams();
    cfg.entries.forEach(function (name, i) { body.append(name, vals[i] || ''); });
    var post = function () { return fetch(cfg.action, { method: 'POST', mode: 'no-cors', body: body }); };
    var settled = false, finish = function () { if (!settled) { settled = true; done(); } };
    setTimeout(finish, 9000);
    post().then(finish, function () { setTimeout(function () { post().then(finish, finish); }, 1500); });
  }
  function readVolunteer(f) { var g = function (n) { return (f[n] && f[n].value || '').trim(); }; return { name: g('vname'), phone: g('vphone'), email: g('vemail'), note: g('vnote') }; }
  function wireVolunteer() {
    var cfg = gformConfig(), f = $('#vform'), note = $('#vform-note');
    if (!f) return;
    if (cfg) { var h = $('#vhint-mail'); if (h) h.textContent = 'No account or email app needed. Prefer to send it yourself? Use “Copy my details”.'; }
    var copyBtn = $('#vcopy');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var v = readVolunteer(f), blob = 'To: ' + VOLUNTEER_EMAIL + '\nSubject: Volunteer — ' + v.name + '\n\n' + volunteerText(v);
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
          note.innerHTML = 'Thank you — your details are in. I’ll reach out at <strong>' + esc(v.email) + '</strong>. No reply within a few days? Write to <a href="' + esc(volunteerMailto(v)) + '">' + VOLUNTEER_EMAIL + '</a>.';
        });
      } else if (cfg) {
        note.innerHTML = 'You appear to be offline. Please <a href="' + esc(volunteerMailto(v)) + '">email ' + VOLUNTEER_EMAIL + '</a> when you’re back, or use “Copy my details”.';
      } else {
        window.location.href = volunteerMailto(v);
        note.textContent = 'Opening your email app with everything filled in — just press send. No mail app? Use “Copy my details” and paste into ' + VOLUNTEER_EMAIL + '.';
      }
      track('volunteer_submit', { via: cfg ? 'gform' : 'mailto' });
    });
  }
  function wireSubmit() {
    wireAnalyse();
    var kind = 'copy', KINDS = ['copy', 'data', 'volunteer'];
    function setKind(k) {
      kind = k;
      KINDS.forEach(function (x) { var b = $('#kind-' + x); if (b) b.setAttribute('aria-pressed', String(x === k)); });
      $$('[data-only]').forEach(function (n) {
        var show = n.dataset.only.split(/\s+/).indexOf(k) >= 0;
        n.style.display = show ? '' : 'none';
        if (n.tagName === 'FORM') n.hidden = !show;
      });
      $('#sform [name=url]').required = k === 'copy';
    }
    KINDS.forEach(function (k) { var b = $('#kind-' + k); if (b) b.addEventListener('click', function () { setKind(k); track('submit_kind', { kind: k }); }); });
    setKind('copy');
    wireVolunteer();

    $('#sform').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, g = function (n) { return (f[n] && f[n].value || '').trim(); };
      // markdown table cells: a raw "|" or a newline would break .github/scripts/apply-submission.mjs
      var cell = function (s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); };
      var isCopy = kind === 'copy';
      var title = (isCopy ? '[copy] ' : '[data] ') + g('topper') + (g('air') ? ' — AIR ' + g('air') : '') + ' · ' + g('paper');
      var L = ['### ' + (isCopy ? 'New topper copy' : 'Topper data correction'), '', '| field | value |', '| --- | --- |',
        '| Topper | ' + cell(g('topper')) + ' |', '| AIR | ' + cell(g('air') || '—') + ' |', '| Year | ' + cell(g('year') || '—') + ' |', '| Paper / subject | ' + cell(g('paper')) + ' |'];
      if (isCopy) {
        L.push('| Copy link | ' + cell(g('url') || '—') + ' |', '| Source / coaching | ' + cell(g('source') || '—') + ' |', '| Marks in this paper | ' + cell(g('marks') || '—') + ' |');
        if (analysis && analysis.count) L.push('| Questions (auto-estimated) | ~' + analysis.count + ' over ' + analysis.numPages + ' pages · ' + analysis.method + ' |');
      } else {
        L.push('| Subject-wise marks | ' + cell(g('allmarks') || '—') + ' |');
      }
      L.push('| Submitted by | ' + cell(g('by') || 'anonymous') + ' |', '', '**Source / verification note**', '', g('note') || '_none provided_');
      if (isCopy && analysis && analysis.count) {
        var rows = (self.TC.extract).toCsvRows(analysis.questions, { topper: g('topper'), coaching: g('source'), subject: g('paper'), url: g('url') });
        var csv = 'topper,coaching,subject,page_number,question,metadata,url\n' + rows.join('\n');
        var how = analysis.method === 'ocr' ? 'OCR of a scanned PDF' : 'heuristic';
        var block = ['', '<details><summary>Auto-extracted questions — ' + analysis.count + ' rows for <code>data/submissions.csv</code> (' + how + ', please verify)</summary>', '', '```csv', csv, '```', '</details>'].join('\n');
        if (encodeURIComponent(L.join('\n') + block).length < 6200) L.push(block);   // GitHub's issue URL limit is ~8 KB
        else L.push('', '_' + analysis.count + ' questions were auto-extracted from the PDF; the CSV was too long for the pre-filled issue — the submitter can paste it in a comment._');
      }
      L.push('', '---', '_Sent from the Submit form on topperscopy.hashin.me._');
      var base = 'https://github.com/' + REPO + '/issues/new?';
      var url = base + 'labels=' + encodeURIComponent(isCopy ? 'submission,copy' : 'submission,data') + '&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(L.join('\n'));
      var blank = base + 'labels=submission&title=' + encodeURIComponent(title);
      if (url.length > 7800) { url = blank; $('#sform-note').textContent = 'The pre-filled issue was too long, so it opened blank — paste your details there.'; }
      else $('#sform-note').textContent = 'Opened a GitHub issue in a new tab with everything filled in. Review it and hit “Submit new issue”.';
      window.open(url, '_blank', 'noopener');
      var alt = $('#sform-alt'); alt.hidden = false; alt.href = blank;
      track('submit_issue_open', { kind: kind, paper: g('paper') || 'unknown', has_link: !!g('url'), extracted: analysis ? analysis.count : 0 });
    });
  }

  boot();
})();
