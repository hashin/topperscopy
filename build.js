#!/usr/bin/env node
/*
 * build.js — turns the source data into the compact JSON the app consumes,
 * the static/SEO artefacts, and the consolidated dataset/ backup.
 *
 *   data/questions.csv    (pristine mirror of upsckata.com "Topper Copies")
 *   data/submissions.csv  (accepted GS/Essay copy submissions, same schema)
 *   data/optionals.json   (accepted optional-subject copies)
 *   data/toppers.overrides.json  (maintainer-verified AIR / marks)
 *        |
 *        v
 *   data/copies.json, data/index.json, data/toppers.json   (served by the app)
 *   toppers.html, sitemap.xml, llms.txt, robots.txt        (static / SEO)
 *   index.html                                             (<noscript> + JSON-LD markers)
 *   dataset/questions.csv, copies.csv, toppers.csv,
 *   dataset/dataset.json, manifest.json, README.md         (complete backup, not served by the app)
 *
 * Run:  node build.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const SRC = path.join(DATA, 'questions.csv');
const SITE = 'https://topperscopy.hashin.me';
const ATTRIBUTION = 'https://toppercopies.upsckata.com/';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parseCSV(str) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (q) {
      if (c === '"') { if (str[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { if (cur.endsWith('\r')) cur = cur.slice(0, -1); row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function parseMeta(meta) {
  const words = (meta.match(/Word limit:\s*([^,]*)/i) || [])[1] || '';
  const marks = (meta.match(/Marks:\s*(.*)$/i) || [])[1] || '';
  const clean = s => s.trim().replace(/^[\[(]|[\])]$/g, '').replace(/\s*(marks|words)\s*$/i, '').trim();
  return [clean(marks), clean(words)];
}

function fromFilename(url) {
  const fn = decodeURIComponent(url.split('/').pop() || '');
  const air = (fn.match(/AIR[-_ ]?(\d{1,3})\b/i) || [])[1];
  const year = (fn.match(/\b(20(?:1[5-9]|2[0-6]))\b/) || [])[1];
  return { air: air ? +air : null, year: year ? +year : null };
}

function loadCsv(file, prov) {
  if (!fs.existsSync(file)) return [];
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];
  const h = rows[0].map(x => x.trim());
  const ix = { topper: h.indexOf('topper'), coaching: h.indexOf('coaching'), subject: h.indexOf('subject'), page: h.indexOf('page_number'), question: h.indexOf('question'), metadata: h.indexOf('metadata'), url: h.indexOf('url') };
  return rows.slice(1)
    .filter(r => r.length >= 7 && r.some(x => x !== ''))
    .map(r => ({
      topper: (r[ix.topper] || '').trim(),
      coaching: (r[ix.coaching] || '').trim(),
      subject: (r[ix.subject] || '').trim(),
      page: parseInt(r[ix.page], 10) || null,
      question: (r[ix.question] || '').trim(),
      metadata: r[ix.metadata] || '',
      url: (r[ix.url] || '').trim(),
      prov
    }));
}

function gitCommit() {
  try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); }
  catch (e) { return null; }
}

function build() {
  const data = [
    ...loadCsv(SRC, 'upsckata'),
    ...loadCsv(path.join(DATA, 'submissions.csv'), 'submission')
  ];

  const groups = new Map();
  for (const r of data) {
    if (!r.url) continue;
    const base = r.url.split('#')[0];
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(r);
  }

  const copies = [];
  const toppers = {};
  let i = 0;
  for (const [base, rs] of groups) {
    const topper = rs.map(r => r.topper).find(Boolean) || 'Unknown';
    const coaching = rs.map(r => r.coaching).find(Boolean) || '';
    const paper = rs.map(r => r.subject).find(Boolean) || 'Other';
    const { air, year } = fromFilename(base);
    const provs = [...new Set(rs.map(r => r.prov))];
    const prov = provs.length > 1 ? 'mixed' : provs[0];

    const qs = rs.map(r => {
      const [marks, words] = parseMeta(r.metadata || '');
      return [r.page, r.question, marks, words];
    }).sort((a, b) => (a[0] || 0) - (b[0] || 0));

    copies.push({ i: i++, t: topper, c: coaching, p: paper, y: year, r: air, u: base, q: qs, prov });

    if (topper !== 'Unknown') {
      const T = toppers[topper] || (toppers[topper] = { air: null, year: null, coaching: [], papers: [], copies: 0, marks: {}, verified: false, sources: [] });
      T.copies++;
      if (air && !T.air) T.air = air;
      if (year && !T.year) T.year = year;
      if (coaching && !T.coaching.includes(coaching)) T.coaching.push(coaching);
      if (paper && !T.papers.includes(paper)) T.papers.push(paper);
    }
  }

  // GS/Essay copies that are only a link (no extractable question text)
  const linkRaw = fs.existsSync(path.join(DATA, 'link-copies.json'))
    ? (JSON.parse(fs.readFileSync(path.join(DATA, 'link-copies.json'), 'utf8')).entries || []) : [];
  for (const e of linkRaw) {
    if (!e.url || !e.topper || !e.paper) continue;
    copies.push({ i: i++, t: e.topper, c: e.source || '', p: e.paper, y: e.year || null, r: e.air || null, u: e.url.split('#')[0], q: [], prov: 'link', link: 1, note: e.note || '' });
    const T = toppers[e.topper] || (toppers[e.topper] = { air: null, year: null, coaching: [], papers: [], copies: 0, marks: {}, verified: false, sources: [] });
    T.copies++;
    if (e.air && !T.air) T.air = e.air;
    if (e.year && !T.year) T.year = e.year;
    if (e.source && !T.coaching.includes(e.source)) T.coaching.push(e.source);
    if (e.paper && !T.papers.includes(e.paper)) T.papers.push(e.paper);
  }

  copies.sort((a, b) => a.t.localeCompare(b.t) || a.p.localeCompare(b.p));

  const papers = {};
  let qCount = 0, linkCount = 0;
  for (const c of copies) { papers[c.p] = (papers[c.p] || 0) + (c.q.length || (c.link ? 1 : 0)); qCount += c.q.length; if (c.link) linkCount++; }

  const generated = new Date().toISOString().slice(0, 10);
  // stats = the searchable GS/Essay question index (used by JSON-LD, llms.txt, static index)
  const searchable = copies.filter(c => !c.link);
  const stats = { questions: qCount, copies: searchable.length, toppers: new Set(searchable.map(c => c.t)).size, papers };

  // stats.all = grand total incl. link-only + optional-subject copies — for the homepage headline
  const optRaw = fs.existsSync(path.join(DATA, 'optionals.json'))
    ? (JSON.parse(fs.readFileSync(path.join(DATA, 'optionals.json'), 'utf8')).entries || []) : [];
  const optQ = optRaw.reduce((n, o) => n + (Array.isArray(o.questions) ? o.questions.length : 0), 0);
  const optSubjects = new Set(optRaw.map(o => o.subject).filter(Boolean));
  stats.all = {
    questions: qCount + optQ,
    copies: copies.length + optRaw.length,
    toppers: new Set(copies.map(c => c.t).concat(optRaw.map(o => o.topper))).size,
    subjects: Object.keys(papers).filter(p => p !== 'Other').length + optSubjects.size,
    linkOnly: linkCount + optRaw.length
  };

  fs.writeFileSync(path.join(DATA, 'copies.json'), JSON.stringify({ generated, attribution: ATTRIBUTION, stats, copies }));

  // lightweight index — copy metadata without the question text, for instant first paint on mobile
  const lite = copies.map(c => {
    const o = { i: c.i, t: c.t, c: c.c, p: c.p, y: c.y, r: c.r, u: c.u, n: c.q.length };
    if (c.link) { o.k = 1; if (c.note) o.note = c.note; }
    return o;
  });
  fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify({ generated, attribution: ATTRIBUTION, stats, copies: lite }));

  // maintainer overrides
  const ovPath = path.join(DATA, 'toppers.overrides.json');
  if (fs.existsSync(ovPath)) {
    const ov = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
    for (const [name, patch] of Object.entries(ov)) {
      if (name.startsWith('_')) continue;
      const T = toppers[name] || (toppers[name] = { air: null, year: null, coaching: [], papers: [], copies: 0, marks: {}, verified: false, sources: [] });
      Object.assign(T, patch, { marks: { ...T.marks, ...(patch.marks || {}) } });
    }
  }
  fs.writeFileSync(path.join(DATA, 'toppers.json'), JSON.stringify({
    generated,
    note: 'AIR/year auto-parsed from source PDF file names where available; marks and missing ranks come from community submissions. verified=true means a maintainer checked it.',
    toppers
  }));

  writeStaticIndex(copies, toppers, stats, generated);
  writeToppersPage(copies, toppers, stats, generated);
  writeSitemap(generated);
  writeLlms(stats, generated);
  writeRobots();
  const dsCounts = writeDataset(copies, toppers, generated, gitCommit());

  const withAir = Object.values(toppers).filter(t => t.air).length;
  const subs = copies.filter(c => c.prov !== 'upsckata').length;
  console.log(`index.json   ${lite.length} copies (${(fs.statSync(path.join(DATA, 'index.json')).size / 1024).toFixed(0)} KB)`);
  console.log(`copies.json  ${copies.length} copies, ${qCount} questions (${subs} copies from submissions)`);
  console.log(`toppers.json ${Object.keys(toppers).length} toppers, ${withAir} with an auto-parsed AIR`);
  console.log(`toppers.html + sitemap.xml + llms.txt + robots.txt written; index.html markers filled`);
  console.log(`dataset/     ${dsCounts.copies} copies, ${dsCounts.questions} questions, ${dsCounts.toppers} toppers, ${dsCounts.submissions} from submissions`);
}

/* ---- consolidated backup dataset (not served by the app) ---- */
function writeDataset(copies, toppers, generated, commit) {
  const DS = path.join(ROOT, 'dataset');
  fs.mkdirSync(DS, { recursive: true });
  const csv = v => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

  // fold optional-subject copies into the same shape as GS/Essay copies
  const optPath = path.join(DATA, 'optionals.json');
  const optIn = fs.existsSync(optPath) ? (JSON.parse(fs.readFileSync(optPath, 'utf8')).entries || []) : [];
  let oid = copies.length;
  const optCopies = optIn.map(o => ({
    i: oid++, t: o.topper || 'Unknown', c: o.source || '', p: 'Optional — ' + o.subject, optional: true,
    y: o.year || null, r: o.air || null, u: (o.url || '').split('#')[0], prov: 'submission',
    verified: !!o.verified,
    q: (Array.isArray(o.questions) ? o.questions : [])
      .map(x => [x.page || null, x.question || '', x.marks || '', x.words || ''])
      .sort((a, b) => (a[0] || 0) - (b[0] || 0))
  }));

  const all = copies.map(c => ({ ...c, optional: false })).concat(optCopies)
    .sort((a, b) => a.t.localeCompare(b.t) || String(a.p).localeCompare(String(b.p)));

  // per-topper aggregation across everything (incl. optionals)
  const agg = {};
  for (const c of all) {
    if (!c.t || c.t === 'Unknown') continue;
    const a = agg[c.t] || (agg[c.t] = { copies: 0, questions: 0, papers: new Set() });
    a.copies++; a.questions += c.q.length; a.papers.add(c.p);
  }
  const names = [...new Set([...Object.keys(toppers), ...Object.keys(agg)])].sort();

  // 1. questions.csv — the complete flat table
  const qHead = ['copy_id', 'topper', 'air', 'year', 'paper', 'optional', 'source', 'provenance', 'page', 'marks', 'word_limit', 'question', 'pdf_url', 'pdf_page_url'];
  const cHead = ['copy_id', 'topper', 'air', 'year', 'paper', 'optional', 'source', 'provenance', 'question_count', 'pdf_url'];
  const qLines = [qHead.join(',')];
  const cLines = [cHead.join(',')];
  for (const c of all) {
    cLines.push([c.i, csv(c.t), c.r || '', c.y || '', csv(c.p), c.optional ? 1 : 0, csv(c.c), c.prov, c.q.length, csv(c.u)].join(','));
    for (const [page, question, marks, words] of c.q) {
      qLines.push([
        c.i, csv(c.t), c.r || '', c.y || '', csv(c.p), c.optional ? 1 : 0, csv(c.c), c.prov,
        page || '', csv(marks), csv(words), csv(question), csv(c.u),
        page && c.u ? c.u + '#page=' + page : csv(c.u)
      ].join(','));
    }
  }
  fs.writeFileSync(path.join(DS, 'questions.csv'), qLines.join('\n') + '\n');
  fs.writeFileSync(path.join(DS, 'copies.csv'), cLines.join('\n') + '\n');

  // 2. toppers.csv
  const MK = ['GS1', 'GS2', 'GS3', 'GS4', 'Essay', 'Optional', 'Total', 'Interview'];
  const tHead = ['topper', 'air', 'year', 'verified', 'copies', 'questions', 'papers', ...MK.map(m => 'marks_' + m.toLowerCase()), 'sources'];
  const tLines = [tHead.join(',')];
  for (const name of names) {
    const T = toppers[name] || {}; const a = agg[name] || { copies: 0, questions: 0, papers: new Set() };
    tLines.push([
      csv(name), T.air || '', T.year || '', T.verified ? 1 : 0, a.copies, a.questions,
      csv([...a.papers].sort().join('; ')),
      ...MK.map(m => (T.marks && T.marks[m] != null ? T.marks[m] : '')),
      csv((T.sources || []).join('; '))
    ].join(','));
  }
  fs.writeFileSync(path.join(DS, 'toppers.csv'), tLines.join('\n') + '\n');

  // 3. dataset.json — single nested canonical dump
  const counts = {
    toppers: names.length,
    copies: all.length,
    questions: all.reduce((n, c) => n + c.q.length, 0),
    submissions: all.filter(c => c.prov && c.prov !== 'upsckata').length
  };
  const json = {
    meta: {
      name: 'Toppers Copy — complete dataset',
      description: 'Every question from every UPSC Civil Services Mains topper answer copy indexed by the Toppers Copy project, plus per-topper AIR / exam year / subject-wise marks. Consolidated backup — includes all accepted community submissions. No PDF files are included.',
      site: SITE,
      repository: 'https://github.com/hashin/topperscopy',
      generated,
      attribution: 'Question-level data collection credited to upsckata.com "Topper Copies" (' + ATTRIBUTION + '). Answer-copy PDFs belong to the institutes that published them (ForumIAS, Vision IAS, NextIAS and others); this project links to them and re-hosts nothing.',
      license: 'CC BY 4.0 for this compilation — see dataset/README.md',
      schema_version: 2,
      counts
    },
    toppers: names.map(name => {
      const T = toppers[name] || {}; const a = agg[name] || { copies: 0, questions: 0, papers: new Set() };
      return { name, air: T.air || null, year: T.year || null, verified: !!T.verified, marks: T.marks || {}, copies: a.copies, questions: a.questions, papers: [...a.papers].sort(), sources: T.sources || [] };
    }),
    copies: all.map(c => ({
      id: c.i, topper: c.t, air: c.r || null, year: c.y || null, paper: c.p, optional: !!c.optional,
      source: c.c || null, provenance: c.prov, pdf_url: c.u || null,
      questions: c.q.map(([page, question, marks, words]) => ({ page: page || null, question, marks: marks || null, words: words || null }))
    }))
  };
  fs.writeFileSync(path.join(DS, 'dataset.json'), JSON.stringify(json));

  // 4. manifest.json — checksums so a copy can be verified later
  const manifest = { generated, schema_version: 2, counts, files: {} };
  for (const f of ['questions.csv', 'copies.csv', 'toppers.csv', 'dataset.json']) {
    const buf = fs.readFileSync(path.join(DS, f));
    manifest.files[f] = {
      bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      rows: f.endsWith('.csv') ? buf.toString('utf8').trimEnd().split('\n').length - 1 : undefined
    };
  }
  fs.writeFileSync(path.join(DS, 'manifest.json'), JSON.stringify(manifest, null, 2));

  writeDatasetReadme(counts, generated);
  return counts;
}

function writeDatasetReadme(counts, generated) {
  const n = x => x.toLocaleString('en-IN');
  const md = `# Toppers Copy — complete dataset

A consolidated, self-contained backup of everything the [Toppers Copy](${SITE}) project has
collected: every question from every UPSC Civil Services Mains topper answer copy, plus per-topper
All-India Rank, exam year and subject-wise marks. **Accepted community submissions are included.**

This directory is a reference archive — the website does not load it. Regenerate it with \`node build.js\`.

- **Snapshot:** ${generated}
- **${n(counts.questions)}** questions · **${n(counts.copies)}** answer copies · **${n(counts.toppers)}** toppers
- **${n(counts.submissions)}** copies came from community submissions (the rest from the upstream mirror)

## Files

| File | What it is |
| --- | --- |
| \`questions.csv\` | The complete flat table — one row per question. The main reusable artefact. |
| \`copies.csv\` | One row per answer copy (index / summary). |
| \`toppers.csv\` | One row per topper — AIR, year, subject-wise marks, copy & question counts. |
| \`dataset.json\` | The same data as a single nested JSON (\`meta\`, \`toppers[]\`, \`copies[]\` with \`questions[]\`). |
| \`manifest.json\` | Generation date, source commit, and SHA-256 + row counts for each file. |

### \`questions.csv\` columns

\`copy_id\`, \`topper\`, \`air\`, \`year\`, \`paper\`, \`optional\` (0/1), \`source\`, \`provenance\`
(\`upsckata\` \\| \`submission\` \\| \`mixed\`), \`page\`, \`marks\`, \`word_limit\`, \`question\`,
\`pdf_url\` (the copy), \`pdf_page_url\` (deep link to the page).

## Provenance & licence

- The question-level data collection is credited to **[upsckata.com — "Topper Copies"](${ATTRIBUTION})**.
- Answer-copy PDFs are the property of the institutes that published them (ForumIAS, Vision IAS,
  NextIAS, Lukmaan IAS, GS SCORE, Rau's IAS and others). **No PDF files are in this dataset** —
  only links to them.
- Questions are extracted from PDFs heuristically and may contain misreads, duplicates or gaps.
  Always check \`pdf_page_url\` if something looks off.
- This **compilation** is released under **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**:
  reuse freely, credit "Toppers Copy (${SITE})" and upsckata.com.
- A rights holder who wants a copy removed can [open an issue](https://github.com/hashin/topperscopy/issues).
`;
  fs.writeFileSync(path.join(ROOT, 'dataset', 'README.md'), md);
}

/* ---- names & tags shared by static outputs ---- */
function topperMeta(name, toppers) {
  const T = toppers[name] || {};
  const bits = [];
  if (T.air) bits.push('AIR ' + T.air + (T.verified ? ' (verified)' : ''));
  if (T.year) bits.push('CSE ' + T.year);
  const mk = Object.entries(T.marks || {}).filter(([, v]) => v).map(([k, v]) => k + ' ' + v);
  if (mk.length) bits.push('marks — ' + mk.join(', '));
  return bits.join(' · ');
}

/* ---- inject static content + JSON-LD into index.html between markers ---- */
function writeStaticIndex(copies, toppers, stats, generated) {
  const idxPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(idxPath, 'utf8');

  const names = Array.from(new Set(copies.map(c => c.t))).sort();
  const topperLinks = names.map(n =>
    `<li><a href="toppers.html#${slug(n)}">${esc(n)}</a>${topperMeta(n, toppers) ? ' — ' + esc(topperMeta(n, toppers)) : ''}</li>`
  ).join('\n');

  const noscript =
`<noscript>
  <section class="prose" style="padding:24px 0">
    <h2>UPSC Mains topper answer copies — full index</h2>
    <p>${stats.questions.toLocaleString('en-IN')} questions from ${stats.copies.toLocaleString('en-IN')} answer
    copies by ${stats.toppers} rankers (GS Paper 1&ndash;4 and Essay), each linking to the exact page of the
    source PDF. Question data credited to <a href="${ATTRIBUTION}">upsckata.com — Topper Copies</a>.
    Optional-subject copies (Sociology, Anthropology, History, PSIR, Geography and more) are community-submitted.</p>
    <p><strong><a href="toppers.html">Open the full static index of every topper and copy &rarr;</a></strong>
    &nbsp;·&nbsp; <a href="data/copies.json">machine-readable data (JSON)</a>
    &nbsp;·&nbsp; <a href="/llms.txt">llms.txt</a></p>
    <h3>All ${stats.toppers} toppers</h3>
    <ul>
${topperLinks}
    </ul>
  </section>
</noscript>`;

  html = replaceBlock(html, 'STATIC', noscript);
  html = replaceBlock(html, 'LD', jsonLd(stats, generated));
  fs.writeFileSync(idxPath, html);
}

function replaceBlock(html, tag, content) {
  const re = new RegExp(`(<!--\\s*${tag}:START\\s*-->)[\\s\\S]*?(<!--\\s*${tag}:END\\s*-->)`);
  if (!re.test(html)) throw new Error(`marker ${tag} not found in index.html`);
  return html.replace(re, `$1\n${content}\n$2`);
}

function jsonLd(stats, generated) {
  const graph = [
    {
      '@type': 'WebSite',
      '@id': SITE + '/#website',
      url: SITE + '/',
      name: 'Toppers Copy',
      description: 'Searchable directory of UPSC Civil Services Mains topper answer copies — GS1–4, Essay and optional subjects.',
      inLanguage: 'en',
      publisher: { '@id': SITE + '/#org' },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: SITE + '/?q={search_term_string}' },
        'query-input': 'required name=search_term_string'
      }
    },
    {
      '@type': 'Organization',
      '@id': SITE + '/#org',
      name: 'Toppers Copy',
      url: SITE + '/',
      description: 'A free, open, community-maintained mirror and index of UPSC Mains topper answer copies.'
    },
    {
      '@type': 'Dataset',
      '@id': SITE + '/#dataset',
      name: 'UPSC Mains Topper Answer Copies — question index',
      description: `A structured index of ${stats.questions.toLocaleString('en-IN')} questions across ${stats.copies.toLocaleString('en-IN')} UPSC Civil Services Mains answer copies written by ${stats.toppers} rank-holders, covering General Studies Papers 1–4 and the Essay paper. Each record links to the exact page of the source PDF published by coaching institutes such as ForumIAS, Vision IAS and NextIAS.`,
      url: SITE + '/',
      keywords: ['UPSC', 'Civil Services Exam', 'Mains', 'answer copy', 'toppers', 'General Studies', 'Essay', 'IAS'],
      license: 'https://github.com/hashin/topperscopy/blob/main/LICENSE',
      isAccessibleForFree: true,
      creator: { '@id': SITE + '/#org' },
      dateModified: generated,
      distribution: [
        { '@type': 'DataDownload', name: 'Complete flat question table (CSV)', encodingFormat: 'text/csv', contentUrl: SITE + '/dataset/questions.csv' },
        { '@type': 'DataDownload', name: 'Complete dataset (nested JSON)', encodingFormat: 'application/json', contentUrl: SITE + '/dataset/dataset.json' },
        { '@type': 'DataDownload', name: 'Per-topper table (CSV)', encodingFormat: 'text/csv', contentUrl: SITE + '/dataset/toppers.csv' },
        { '@type': 'DataDownload', name: 'App index, grouped by copy (JSON)', encodingFormat: 'application/json', contentUrl: SITE + '/data/copies.json' }
      ],
      citation: ATTRIBUTION
    },
    {
      '@type': 'FAQPage',
      '@id': SITE + '/#faq',
      mainEntity: [
        ['What is Toppers Copy?', `A free, searchable directory of UPSC Civil Services Mains topper answer copies. It indexes ${stats.questions.toLocaleString('en-IN')} questions inside ${stats.copies.toLocaleString('en-IN')} answer copies by ${stats.toppers} rankers and links to the exact page of each source PDF.`],
        ['Where do the answer copies come from?', 'Every copy is hosted by the coaching institute or compiler that published it — ForumIAS, Vision IAS, NextIAS, Lukmaan IAS, GS SCORE, Rau’s IAS, Level Up IAS, UnlockIAS, Sleepy Classes and others — or the topper’s own Google Drive. Toppers Copy only links to those files and never re-hosts them. The GS question-level data is credited to upsckata.com’s "Topper Copies" project.'],
        ['Does it cover optional subjects?', 'Yes. Alongside GS1–GS4 and Essay, there is a community-built section for optional subjects — Sociology, Anthropology, History, PSIR, Geography, Public Administration, Philosophy, Economics, Literature and more.'],
        ['Is it free?', 'Yes, completely free and open source. No login, no ads.'],
        ['How can I add a missing copy or a topper’s marks?', 'Use the Submit form on the site. It opens a pre-filled GitHub issue that a maintainer verifies before it goes live.']
      ].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
    }
  ];
  return `<script type="application/ld+json">\n${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 0)}\n</script>`;
}

/* ---- toppers.html : the fully static crawlable index ---- */
function writeToppersPage(copies, toppers, stats, generated) {
  const byTopper = new Map();
  for (const c of copies) {
    if (!byTopper.has(c.t)) byTopper.set(c.t, []);
    byTopper.get(c.t).push(c);
  }
  const names = Array.from(byTopper.keys()).sort();

  const sections = names.map(name => {
    const list = byTopper.get(name).slice().sort((a, b) => (a.p).localeCompare(b.p));
    const meta = topperMeta(name, toppers);
    const rows = list.map(c => {
      const pdf = esc(c.u);
      return `      <tr><td>${esc(c.p)}</td><td>${esc(c.c || '—')}</td><td>${c.q.length}</td><td><a href="${pdf}" rel="nofollow noopener">source PDF</a></td></tr>`;
    }).join('\n');
    return `  <section id="${slug(name)}">
    <h2>${esc(name)}</h2>
    ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
    <table>
      <thead><tr><th>Paper</th><th>Source</th><th>Questions</th><th>Copy</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
  }).join('\n\n');

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'UPSC Mains toppers with published answer copies',
    numberOfItems: names.length,
    itemListElement: names.map((n, idx) => ({
      '@type': 'ListItem', position: idx + 1, name: n, url: SITE + '/toppers.html#' + slug(n)
    }))
  };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>All UPSC Mains toppers &amp; answer copies — full index | Toppers Copy</title>
<meta name="description" content="Complete static index of ${stats.toppers} UPSC Civil Services Mains rankers with published answer copies (GS1-4 and Essay), ${stats.copies} copies in total, each linking to its source PDF. Data credited to upsckata.com.">
<link rel="canonical" href="${SITE}/toppers.html">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta property="og:title" content="All UPSC Mains toppers & answer copies — full index">
<meta property="og:description" content="Static index of ${stats.toppers} rankers and ${stats.copies} answer copies, each linking to its source PDF.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/toppers.html">
<meta property="og:image" content="${SITE}/assets/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="675">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/assets/og.jpg">
<style>
  :root{color-scheme:light dark;--bg:#FBF9F5;--fg:#263A40;--muted:#7A8A8D;--line:#E9E3D8;--teal:#0A7C7B;--card:#fff}
  @media (prefers-color-scheme:dark){:root{--bg:#101C1D;--fg:#E9E2D5;--muted:#8AA0A0;--line:#2C4245;--teal:#55D6CF;--card:#172829}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:0 20px 80px}
  main{max-width:900px;margin:0 auto}
  header{max-width:900px;margin:0 auto;padding:32px 0 8px}
  h1{font-size:1.7rem;margin:0 0 6px}
  a{color:var(--teal)}
  .lead{color:var(--muted);margin:0 0 4px}
  nav.crumb{font-size:.9rem;color:var(--muted);margin:18px 0}
  section{border-top:1px solid var(--line);padding:18px 0}
  h2{font-size:1.15rem;margin:0 0 4px}
  .meta{color:var(--muted);font-size:.9rem;margin:0 0 10px}
  table{border-collapse:collapse;width:100%;font-size:.92rem}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600}
  .toc{columns:220px;gap:24px;font-size:.92rem;margin:14px 0 0}
  .toc a{display:block;padding:2px 0}
</style>
<script type="application/ld+json">
${JSON.stringify(itemList, null, 0)}
</script>
</head>
<body>
<header>
  <nav class="crumb"><a href="/">Toppers Copy</a> / All toppers</nav>
  <h1>Every UPSC Mains topper answer copy — full index</h1>
  <p class="lead">${stats.toppers} rankers · ${stats.copies} answer copies · ${stats.questions.toLocaleString('en-IN')} indexed questions · updated ${generated}</p>
  <p class="lead">This is the static, no-JavaScript index. The <a href="/">main site</a> lets you search inside every copy.
  Question data credited to <a href="${ATTRIBUTION}" rel="nofollow">upsckata.com — Topper Copies</a>.
  Answer-copy PDFs are hosted by the institutes that published them; nothing is re-hosted here.</p>
  <details><summary>Jump to a topper</summary>
    <div class="toc">
${names.map(n => `      <a href="#${slug(n)}">${esc(n)}</a>`).join('\n')}
    </div>
  </details>
</header>
<main>
${sections}
</main>
</body>
</html>
`;
  fs.writeFileSync(path.join(ROOT, 'toppers.html'), html);
}

function writeSitemap(generated) {
  const urls = [
    { loc: SITE + '/', priority: '1.0' },
    { loc: SITE + '/toppers.html', priority: '0.8' }
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${generated}</lastmod><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
}

function writeRobots() {
  const txt = `# Toppers Copy — https://topperscopy.hashin.me
# Search engines and AI agents are welcome to crawl and index this site and its data.
User-agent: *
Allow: /

# Named AI / research crawlers — explicitly allowed
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-Web
Allow: /
User-agent: anthropic-ai
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: CCBot
Allow: /
User-agent: Bytespider
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), txt);
}

function writeLlms(stats, generated) {
  const txt = `# Toppers Copy

> A free, open, community-maintained directory of UPSC Civil Services Examination (CSE)
> **Mains topper answer copies**. It indexes ${stats.questions.toLocaleString('en-IN')} questions inside
> ${stats.copies.toLocaleString('en-IN')} answer copies written by ${stats.toppers} rank-holders and links each
> question to the exact page of the source PDF. Covers General Studies Paper 1, 2, 3 and 4, the Essay paper,
> and a community-built section for optional subjects.

Site: https://topperscopy.hashin.me
Updated: ${generated}
Licence: MIT (code) — question data credited to upsckata.com "Topper Copies" (${ATTRIBUTION})

## What it contains

- Which UPSC Mains topper answered which question, in which paper, on which page of which PDF.
- Per-topper All-India Rank (AIR), exam year and, where submitted, subject-wise marks.
- Direct links to answer-copy PDFs hosted by ForumIAS, Vision IAS, NextIAS, Lukmaan IAS, GS SCORE, Rau's IAS, Level Up IAS, UnlockIAS, Sleepy Classes and others.
- Optional-subject copies: Sociology, Anthropology, History, PSIR, Geography, Public Administration,
  Philosophy, Economics, Literature and more (community-submitted).

## Machine-readable data

- Full question index (JSON, grouped by copy): https://topperscopy.hashin.me/data/copies.json
- Per-topper AIR / year / marks (JSON): https://topperscopy.hashin.me/data/toppers.json
- Raw source table (CSV): https://topperscopy.hashin.me/data/questions.csv
- Optional-subject submissions (JSON): https://topperscopy.hashin.me/data/optionals.json

## Complete dataset (backup, includes all accepted submissions)

- Flat table of every question (CSV): https://topperscopy.hashin.me/dataset/questions.csv
- Per-topper table (CSV): https://topperscopy.hashin.me/dataset/toppers.csv
- Per-copy index (CSV): https://topperscopy.hashin.me/dataset/copies.csv
- Everything as one nested JSON: https://topperscopy.hashin.me/dataset/dataset.json
- Checksums and counts: https://topperscopy.hashin.me/dataset/manifest.json
- Documentation: https://github.com/hashin/topperscopy/blob/main/dataset/README.md

## Human-readable pages

- Home / search: https://topperscopy.hashin.me/
- Full static index of every topper and copy: https://topperscopy.hashin.me/toppers.html
- Submit a copy or a correction: https://topperscopy.hashin.me/#submit

## Notes for citation

Attribute the question-level data collection to upsckata.com ("Topper Copies"). Answer-copy PDFs are the
property of the institutes that published them. This site re-hosts no PDFs; it only links to them.
`;
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), txt);
}

build();
