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
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, x = this; clearTimeout(t); t = setTimeout(function () { fn.apply(x, a); }, ms); }; };

  var DB = null;        // copies.json
  var TOPPERS = {};     // toppers.json -> .toppers
  var OPTS = [];        // optionals.json -> .entries
  var state = {
    view: 'browse', q: '', mode: 'all', paper: 'all',
    topper: '', source: '', year: '', sort: 'name', shown: PAGE,
    optSubject: 'all', optQ: ''
  };

  /* ---------- boot ---------- */
  function boot() {
    wireTabs();
    wireBrowse();
    wireOptionals();
    wireSubmit();
    if (location.hash) setView(location.hash.replace('#', ''));

    Promise.all([
      fetch('data/copies.json').then(r => r.json()),
      fetch('data/toppers.json').then(r => r.json()).catch(function () { return { toppers: {} }; }),
      fetch('data/optionals.json').then(r => r.json()).catch(function () { return { entries: [] }; })
    ]).then(function (res) {
      DB = res[0];
      TOPPERS = res[1].toppers || {};
      OPTS = res[2].entries || [];
      onData();
    }).catch(function (e) {
      $('#tagline').textContent = 'could not load the database — ' + e.message;
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  function onData() {
    var s = DB.stats;
    $('#tagline').textContent = fmt(s.questions) + ' questions · ' + fmt(s.copies) +
      ' topper copies · ' + fmt(s.toppers) + ' toppers';
    $('#stats').innerHTML =
      stat(s.questions, 'questions') + stat(s.copies, 'copies') +
      stat(s.toppers, 'toppers') + stat(Object.keys(s.papers).length, 'papers');
    $('#foot-stats').textContent = 'built ' + DB.generated;
    $('#about-gen').textContent = 'Database snapshot: ' + DB.generated + '. Source: ' + DB.attribution;

    buildPaperChips();
    fillSelect($('#topper'), topperOptions(), state.topper);
    fillSelect($('#source'), Object.keys(s.papers).length ? sourceOptions() : [], state.source);
    fillSelect($('#year'), yearOptions(), state.year);
    fillSelect($('#sform select[name=paper]'), PAPERS.concat(OPTIONALS).map(function (p) { return [p, p]; }));
    buildOptSubjectChips();

    renderBrowse();
    renderOptionals();
  }

  var fmt = function (n) { return (n || 0).toLocaleString('en-IN'); };
  function stat(n, label) { return '<div><b>' + fmt(n) + '</b>' + label + '</div>'; }

  /* ---------- tabs ---------- */
  function wireTabs() {
    $$('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.dataset.view); });
    });
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
    $$('.view').forEach(function (s) { s.hidden = s.id !== 'view-' + v; });
    if (location.hash.replace('#', '') !== v) history.replaceState(null, '', '#' + v);
    window.scrollTo(0, 0);
  }

  /* ---------- browse ---------- */
  function wireBrowse() {
    $('#q').addEventListener('input', debounce(function (e) {
      state.q = e.target.value.trim(); state.shown = PAGE; renderBrowse();
    }, 180));
    $$('#mode button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.mode = b.dataset.mode;
        $$('#mode button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        renderBrowse();
      });
    });
    ['topper', 'source', 'year', 'sort'].forEach(function (id) {
      $('#' + id).addEventListener('change', function (e) {
        state[id] = e.target.value; state.shown = PAGE; renderBrowse();
      });
    });
  }

  function buildPaperChips() {
    var row = $('#papers'); row.innerHTML = '';
    var defs = [['all', 'All']].concat(PAPERS.filter(function (p) { return DB.stats.papers[p]; }).map(function (p) { return [p, p]; }));
    defs.forEach(function (d) {
      var c = el('button', { class: 'chip', 'data-paper': d[0], 'aria-pressed': state.paper === d[0] },
        [d[1] + (d[0] !== 'all' ? ' · ' + fmt(DB.stats.papers[d[0]]) : '')]);
      c.addEventListener('click', function () {
        state.paper = d[0]; state.shown = PAGE;
        $$('#papers .chip').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.paper === d[0]); });
        renderBrowse();
      });
      row.appendChild(c);
    });
  }

  function topperOptions() {
    var m = {};
    DB.copies.forEach(function (c) { m[c.t] = (m[c.t] || 0) + 1; });
    return Object.keys(m).sort().map(function (t) {
      var air = TOPPERS[t] && TOPPERS[t].air;
      return [t, t + (air ? ' (AIR ' + air + ')' : '') + ' — ' + m[t]];
    });
  }
  function sourceOptions() {
    var m = {};
    DB.copies.forEach(function (c) { if (c.c) m[c.c] = (m[c.c] || 0) + 1; });
    return Object.keys(m).sort().map(function (s) { return [s, s + ' — ' + m[s]]; });
  }
  function yearOptions() {
    var m = {};
    DB.copies.forEach(function (c) { if (c.y) m[c.y] = (m[c.y] || 0) + 1; });
    return Object.keys(m).sort().reverse().map(function (y) { return [y, y + ' — ' + m[y]]; });
  }
  function fillSelect(sel, pairs, keep) {
    if (!sel) return;
    var first = sel.querySelector('option');
    sel.innerHTML = '';
    if (first && first.value === '') sel.appendChild(first);
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
    $('#count').textContent = fmt(list.length) + ' copies · ' + fmt(totalQ) + ' matching questions' +
      (state.q ? ' for "' + state.q + '"' : '');
    var box = $('#results'); box.innerHTML = '';
    if (!list.length) { box.appendChild(el('div', { class: 'empty' }, ['nothing matches those filters.'])); return; }
    list.slice(0, state.shown).forEach(function (x) { box.appendChild(copyCard(x.c, x.qs, state.q)); });
    if (list.length > state.shown) {
      var more = el('button', { class: 'more' }, ['show ' + Math.min(PAGE, list.length - state.shown) + ' more (' + (list.length - state.shown) + ' hidden)']);
      more.addEventListener('click', function () { state.shown += PAGE; renderBrowse(); });
      box.appendChild(more);
    }
  }

  function topperTags(name, paper, copyYear, copyAir) {
    var T = TOPPERS[name] || {};
    var air = T.air || copyAir;
    var year = T.year || copyYear;
    var tags = [];
    if (air) tags.push(el('span', { class: 'tag air' }, ['AIR ' + air + (T.verified ? ' ✓' : '')]));
    if (year) tags.push(el('span', { class: 'tag' }, [String(year)]));
    var mk = T.marks && (T.marks[paper] != null ? T.marks[paper] : null);
    if (mk != null) tags.push(el('span', { class: 'tag marks' }, [paper + ' ' + mk]));
    return tags;
  }

  function copyCard(c, qs, query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    var open = !!terms.length || state.topper;
    var head = el('summary', {}, [
      el('span', { class: 'name' }, [c.t]),
      el('span', { class: 'tags' }, [el('span', { class: 'tag' }, [c.p])]
        .concat(c.c ? [el('span', { class: 'tag' }, [c.c])] : [])
        .concat(topperTags(c.t, c.p, c.y, c.r))),
      el('span', { class: 'qcount' }, [qs.length + ' Q'])
    ]);
    var ql = el('div', { class: 'qlist' });
    qs.forEach(function (q) {
      var txt = el('div', { class: 'txt' });
      txt.innerHTML = highlight(q[1], terms);
      var meta = [];
      if (q[2]) meta.push(q[2] + ' marks');
      if (q[3]) meta.push(q[3] + (/\d$/.test(q[3]) ? ' words' : ''));
      if (meta.length) txt.appendChild(el('div', { class: 'meta' }, [meta.join(' · ')]));
      var href = c.u + (q[0] ? '#page=' + q[0] : '');
      ql.appendChild(el('div', { class: 'q' }, [
        txt,
        el('a', { class: 'open', href: href, target: '_blank', rel: 'noopener' }, ['open PDF' + (q[0] ? ' · pg ' + q[0] : '')])
      ]));
    });
    var d = el('details', { class: 'copy' }, [head, ql]);
    if (open) d.open = true;
    return d;
  }

  function highlight(text, terms) {
    var h = esc(text);
    if (!terms.length) return h;
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
      state.optQ = e.target.value.trim().toLowerCase(); renderOptionals();
    }, 150));
  }
  function buildOptSubjectChips() {
    var row = $('#opt-subjects'); row.innerHTML = '';
    var counts = {};
    OPTS.forEach(function (o) { counts[o.subject] = (counts[o.subject] || 0) + 1; });
    var defs = [['all', 'All']].concat(OPTIONALS.map(function (s) { return [s, s]; }));
    defs.forEach(function (d) {
      var n = d[0] === 'all' ? OPTS.length : (counts[d[0]] || 0);
      var c = el('button', { class: 'chip', 'aria-pressed': state.optSubject === d[0] },
        [d[1] + (d[0] !== 'all' ? ' · ' + n : '')]);
      c.addEventListener('click', function () {
        state.optSubject = d[0];
        $$('#opt-subjects .chip').forEach(function (x) { x.setAttribute('aria-pressed', x === c); });
        renderOptionals();
      });
      row.appendChild(c);
    });
  }
  function renderOptionals() {
    if (!DB) return;
    var list = OPTS.filter(function (o) {
      if (state.optSubject !== 'all' && o.subject !== state.optSubject) return false;
      if (state.optQ) {
        var blob = (o.topper + ' ' + (o.note || '') + ' ' + (o.source || '')).toLowerCase();
        if (blob.indexOf(state.optQ) < 0) return false;
      }
      return true;
    });
    $('#opt-count').textContent = list.length + ' optional-subject copies';
    var box = $('#opt-results'); box.innerHTML = '';
    if (!list.length) {
      box.appendChild(el('div', { class: 'empty' }, [
        'no optional copies here yet. ',
        el('a', { href: '#submit', 'data-goto': 'submit' }, ['be the first to add one →'])
      ]));
      return;
    }
    list.forEach(function (o) {
      var tags = [el('span', { class: 'tag' }, [o.subject])];
      if (o.air) tags.push(el('span', { class: 'tag air' }, ['AIR ' + o.air + (o.verified ? ' ✓' : '')]));
      if (o.year) tags.push(el('span', { class: 'tag' }, [String(o.year)]));
      if (o.marks) tags.push(el('span', { class: 'tag marks' }, [o.subject + ' ' + o.marks]));
      if (o.source) tags.push(el('span', { class: 'tag' }, [o.source]));
      var head = el('summary', {}, [
        el('span', { class: 'name' }, [o.topper]),
        el('span', { class: 'tags' }, tags),
        el('span', { class: 'qcount' }, [o.by ? 'via ' + o.by : ''])
      ]);
      var body = el('div', { class: 'qlist' }, [
        el('div', { class: 'q' }, [
          el('div', { class: 'txt' }, [o.note || 'Optional subject answer copy.']),
          el('a', { class: 'open', href: o.url, target: '_blank', rel: 'noopener' }, ['open copy'])
        ])
      ]);
      box.appendChild(el('details', { class: 'copy', open: 'open' }, [head, body]));
    });
  }

  /* ---------- submit ---------- */
  function wireSubmit() {
    var kind = 'copy';
    function setKind(k) {
      kind = k;
      $('#kind-copy').setAttribute('aria-pressed', k === 'copy');
      $('#kind-data').setAttribute('aria-pressed', k === 'data');
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

      var lines = [
        '### ' + (isCopy ? 'New topper copy' : 'Topper data correction'),
        '',
        '| field | value |',
        '| --- | --- |',
        '| Topper | ' + g('topper') + ' |',
        '| AIR | ' + (g('air') || '—') + ' |',
        '| Year | ' + (g('year') || '—') + ' |',
        '| Paper / subject | ' + g('paper') + ' |'
      ];
      if (isCopy) {
        lines.push('| Copy link | ' + (g('url') || '—') + ' |');
        lines.push('| Source / coaching | ' + (g('source') || '—') + ' |');
        lines.push('| Marks in this paper | ' + (g('marks') || '—') + ' |');
      } else {
        lines.push('| Subject-wise marks | ' + (g('allmarks') || '—') + ' |');
      }
      lines.push('| Submitted by | ' + (g('by') || 'anonymous') + ' |');
      lines.push('', '**Source / verification note**', '', g('note') || '_none provided_', '',
        '---', '_Sent from the Submit form on topperscopy.hashin.me. Data concept credit: upsckata.com._');

      var body = lines.join('\n');
      var url = 'https://github.com/' + REPO + '/issues/new?labels=' +
        encodeURIComponent(isCopy ? 'submission,copy' : 'submission,data') +
        '&title=' + encodeURIComponent(title) +
        '&body=' + encodeURIComponent(body);

      if (url.length > 7000) {
        url = 'https://github.com/' + REPO + '/issues/new?labels=submission&title=' + encodeURIComponent(title);
        $('#sform-note').textContent = 'Your note was long, so the issue opened without the pre-filled body — paste your details in there.';
      } else {
        $('#sform-note').textContent = 'Opened a GitHub issue in a new tab with everything filled in. Review it and hit "Submit new issue".';
      }
      window.open(url, '_blank', 'noopener');
      var alt = $('#sform-alt');
      alt.hidden = false;
      alt.href = 'https://github.com/' + REPO + '/issues/new?labels=submission&title=' + encodeURIComponent(title);
    });
  }

  boot();
})();
