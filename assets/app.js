/* Toppers Copy — static client. Data credit: upsckata.com "Topper Copies". */
(function () {
  'use strict';

  var REPO = 'hashin/topperscopy';
  var PAPERS = ['GS1', 'GS2', 'GS3', 'GS4', 'Essay', 'Other'];
  var OPTIONALS = ['Sociology', 'Anthropology', 'History', 'PSIR', 'Geography',
    'Public Administration', 'Philosophy', 'Economics', 'Mathematics', 'Physics',
    'Chemistry', 'Commerce & Accountancy', 'Law', 'Management', 'Medical Science',
    'Agriculture', 'Statistics', 'Literature', 'Other'];
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
  var state = {
    view: 'browse', q: '', mode: 'all', paper: 'all',
    topper: '', source: '', year: '', sort: 'name', shown: PAGE,
    optSubject: 'all', optQ: ''
  };

  var BAR = ['#09A1A1', '#F6C992', '#D396A6', '#5484A4', '#ACC0D3', '#30525C'];

  /* ---------- boot ---------- */
  function boot() {
    wireTheme(); wireTabs(); wireBrowse(); wireOptionals(); wireSubmit();
    if (location.hash) setView(location.hash.replace('#', ''));

    Promise.all([
      fetch('data/copies.json').then(function (r) { return r.json(); }),
      fetch('data/toppers.json').then(function (r) { return r.json(); }).catch(function () { return { toppers: {} }; }),
      fetch('data/optionals.json').then(function (r) { return r.json(); }).catch(function () { return { entries: [] }; })
    ]).then(function (res) {
      DB = res[0]; TOPPERS = res[1].toppers || {}; OPTS = res[2].entries || [];
      onData();
    }).catch(function (e) {
      $('#sub').textContent = 'Could not load the database — ' + e.message;
      $('#results').innerHTML = '';
    });

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  function onData() {
    var s = DB.stats;
    $('#sub').textContent = fmt(s.questions) + ' questions across ' + fmt(s.copies) +
      ' copies from ' + fmt(s.toppers) + ' toppers';
    $('#statline').innerHTML =
      chipStat(s.questions, 'questions') + chipStat(s.copies, 'copies') +
      chipStat(s.toppers, 'toppers') + chipStat(countSources(), 'sources');
    $('#foot-stats').textContent = 'Data snapshot ' + DB.generated;
    $('#about-gen').textContent = 'Database snapshot: ' + DB.generated + ' · source: ' + DB.attribution;

    buildPaperSeg();
    fillSelect($('#topper'), topperOptions(), state.topper);
    fillSelect($('#source'), sourceOptions(), state.source);
    fillSelect($('#year'), yearOptions(), state.year);
    fillSelect($('#sform select[name=paper]'), PAPERS.filter(function (p) { return p !== 'Other'; })
      .map(function (p) { return [p, p]; })
      .concat(OPTIONALS.map(function (o) { return ['Optional — ' + o, 'Optional — ' + o]; })));

    renderBrowse();
    renderOptionals();
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
    state.view = v;
    $$('nav.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.view === v); });
    $$('.view').forEach(function (sec) { sec.hidden = sec.id !== 'view-' + v; });
    if (location.hash.replace('#', '') !== v) history.replaceState(null, '', '#' + v);
    window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  }

  /* ---------- browse ---------- */
  function wireBrowse() {
    $('#q').addEventListener('input', debounce(function (e) {
      state.q = e.target.value.trim(); state.shown = PAGE; renderBrowse();
    }, 160));
    $$('#mode button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.mode = b.dataset.mode;
        $$('#mode button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        renderBrowse();
      });
    });
    ['topper', 'source', 'year', 'sort'].forEach(function (id) {
      $('#' + id).addEventListener('change', function (e) { state[id] = e.target.value; state.shown = PAGE; renderBrowse(); });
    });
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
      });
      row.appendChild(b);
    });
  }

  function topperOptions() {
    var m = {};
    DB.copies.forEach(function (c) { m[c.t] = (m[c.t] || 0) + 1; });
    return Object.keys(m).sort().map(function (t) {
      var air = TOPPERS[t] && TOPPERS[t].air;
      return [t, t + (air ? ' · AIR ' + air : '') + ' (' + m[t] + ')'];
    });
  }
  function sourceOptions() {
    var m = {};
    DB.copies.forEach(function (c) { if (c.c) m[c.c] = (m[c.c] || 0) + 1; });
    return Object.keys(m).sort().map(function (x) { return [x, x + ' (' + m[x] + ')']; });
  }
  function yearOptions() {
    var m = {};
    DB.copies.forEach(function (c) { if (c.y) m[c.y] = (m[c.y] || 0) + 1; });
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

  function filteredCopies() {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return DB.copies.map(function (c) {
      if (state.paper !== 'all' && c.p !== state.paper) return null;
      if (state.topper && c.t !== state.topper) return null;
      if (state.source && c.c !== state.source) return null;
      if (state.year && String(c.y) !== state.year) return null;
      var qs = c.q;
      if (terms.length) {
        qs = qs.filter(function (q) { return matchQ(q[1], terms, state.mode); });
        if (!qs.length) return null;
      }
      return { c: c, qs: qs };
    }).filter(Boolean).sort(function (a, b) {
      if (state.sort === 'air') {
        var ra = (TOPPERS[a.c.t] && TOPPERS[a.c.t].air) || a.c.r || 1e9;
        var rb = (TOPPERS[b.c.t] && TOPPERS[b.c.t].air) || b.c.r || 1e9;
        return ra - rb || a.c.t.localeCompare(b.c.t);
      }
      if (state.sort === 'qty') return b.qs.length - a.qs.length;
      return a.c.t.localeCompare(b.c.t) || a.c.p.localeCompare(b.c.p);
    });
  }

  function renderBrowse() {
    if (!DB) return;
    var list = filteredCopies();
    var totalQ = list.reduce(function (n, x) { return n + x.qs.length; }, 0);
    $('#resultmeta').textContent = fmt(list.length) + ' ' + (list.length === 1 ? 'copy' : 'copies') +
      ' · ' + fmt(totalQ) + ' matching questions' + (state.q ? ' for “' + state.q + '”' : '');

    var box = $('#results'); box.innerHTML = '';
    if (!list.length) {
      box.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big' }, ['No matches']),
        el('div', {}, ['Try fewer words, switch to “All words”, or clear a filter.'])
      ]));
      return;
    }
    list.slice(0, state.shown).forEach(function (x) { box.appendChild(copyCard(x.c, x.qs)); });
    if (list.length > state.shown) {
      var n = Math.min(PAGE, list.length - state.shown);
      var more = el('button', { class: 'more' }, ['Show ' + n + ' more  ·  ' + (list.length - state.shown) + ' hidden']);
      more.addEventListener('click', function () { state.shown += PAGE; renderBrowse(); });
      box.appendChild(more);
    }
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

  function copyCard(c, qs) {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    var openIt = terms.length > 0 || !!state.topper;
    var tags = [el('span', { class: 'tag paper' }, [c.p])]
      .concat(c.c ? [el('span', { class: 'tag' }, [c.c])] : [])
      .concat(topperTags(c.t, c.p, c.y, c.r));

    var summary = el('summary', {}, [
      el('span', { class: 'name' }, [c.t]),
      el('span', { class: 'qn' }, [qs.length + (qs.length === 1 ? ' question' : ' questions')]),
      el('span', { class: 'tags' }, tags)
    ]);

    var ql = el('div', { class: 'qlist' });
    qs.forEach(function (q) {
      var txt = el('div', { class: 'txt' });
      txt.innerHTML = highlight(q[1], terms);
      var meta = [];
      if (q[2]) meta.push(q[2] + ' marks');
      if (q[3]) meta.push(q[3] + (/\d$/.test(q[3]) ? ' words' : ''));
      if (meta.length) txt.appendChild(el('span', { class: 'qmeta' }, [meta.join('  ·  ')]));
      var href = c.u + (q[0] ? '#page=' + q[0] : '');
      ql.appendChild(el('div', { class: 'q' }, [
        txt,
        el('a', { class: 'open', href: href, target: '_blank', rel: 'noopener' }, [q[0] ? 'Open PDF · p.' + q[0] : 'Open PDF'])
      ]));
    });

    var d = el('details', { class: 'copy' }, [summary, ql]);
    if (openIt) d.open = true;
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
          var blob = (o.topper + ' ' + (o.note || '') + ' ' + (o.source || '')).toLowerCase();
          if (blob.indexOf(state.optQ) < 0) return false;
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
      card.addEventListener('click', function () { state.optSubject = sub; renderOptionals(); window.scrollTo(0, 0); });
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
    var tags = [el('span', { class: 'tag paper' }, [o.subject])];
    if (o.air) tags.push(el('span', { class: 'tag air' }, ['AIR ' + o.air + (o.verified ? ' ✓' : '')]));
    if (o.year) tags.push(el('span', { class: 'tag' }, [String(o.year)]));
    if (o.marks) tags.push(el('span', { class: 'tag marks' }, [o.subject + ' ' + o.marks]));
    if (o.source) tags.push(el('span', { class: 'tag' }, [o.source]));

    var summary = el('summary', {}, [
      el('span', { class: 'name' }, [o.topper]),
      o.by ? el('span', { class: 'qn' }, ['via ' + o.by]) : null,
      el('span', { class: 'tags' }, tags)
    ]);
    var body = el('div', { class: 'qlist' }, [
      el('div', { class: 'q' }, [
        el('div', { class: 'txt' }, [o.note || 'Optional subject answer copy.']),
        el('a', { class: 'open', href: o.url, target: '_blank', rel: 'noopener' }, ['Open copy'])
      ])
    ]);
    return el('details', { class: 'copy', open: 'open' }, [summary, body]);
  }

  /* ---------- submit ---------- */
  function wireSubmit() {
    var kind = 'copy';
    function setKind(k) {
      kind = k;
      $('#kind-copy').setAttribute('aria-pressed', String(k === 'copy'));
      $('#kind-data').setAttribute('aria-pressed', String(k === 'data'));
      $$('[data-only]').forEach(function (n) { n.style.display = n.dataset.only === k ? '' : 'none'; });
      $('#sform [name=url]').required = k === 'copy';
    }
    $('#kind-copy').addEventListener('click', function () { setKind('copy'); });
    $('#kind-data').addEventListener('click', function () { setKind('data'); });
    setKind('copy');

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
      } else {
        L.push('| Subject-wise marks | ' + (g('allmarks') || '—') + ' |');
      }
      L.push('| Submitted by | ' + (g('by') || 'anonymous') + ' |', '',
        '**Source / verification note**', '', g('note') || '_none provided_', '',
        '---', '_Sent from the Submit form on topperscopy.hashin.me. Data concept credit: upsckata.com._');

      var body = L.join('\n');
      var base = 'https://github.com/' + REPO + '/issues/new?';
      var url = base + 'labels=' + encodeURIComponent(isCopy ? 'submission,copy' : 'submission,data') +
        '&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
      var blank = base + 'labels=submission&title=' + encodeURIComponent(title);

      if (url.length > 7000) {
        url = blank;
        $('#sform-note').textContent = 'Your note was long, so the issue opened without the pre-filled body — paste your details there.';
      } else {
        $('#sform-note').textContent = 'Opened a GitHub issue in a new tab with everything filled in. Review it and hit “Submit new issue”.';
      }
      window.open(url, '_blank', 'noopener');
      var alt = $('#sform-alt'); alt.hidden = false; alt.href = blank;
    });
  }

  boot();
})();
