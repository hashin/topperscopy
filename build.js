#!/usr/bin/env node
/*
 * build.js — turns the raw questions.csv (mirrored from upsckata.com "Topper Copies")
 * into the compact JSON the app consumes, plus the static/SEO artefacts.
 *
 *   data/questions.csv  ->  data/copies.json     (grouped by source PDF, for the app)
 *                           data/toppers.json    (per-topper AIR / year / marks)
 *                           toppers.html         (fully static, crawlable index of every copy)
 *                           sitemap.xml
 *                           llms.txt             (machine summary for AI agents)
 *                           index.html           (static <noscript> + JSON-LD injected between markers)
 *
 * Run:  node build.js
 */

const fs = require('fs');
const path = require('path');

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

function build() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const rows = parseCSV(raw);
  const header = rows[0].map(h => h.trim());
  const H = k => header.indexOf(k);
  const data = rows.slice(1).filter(r => r.length >= 7 && r.some(x => x !== ''));

  const groups = new Map();
  for (const r of data) {
    const url = (r[H('url')] || '').trim();
    if (!url) continue;
    const base = url.split('#')[0];
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(r);
  }

  const copies = [];
  const toppers = {};
  let i = 0;
  for (const [base, rs] of groups) {
    const topper = rs.map(r => r[H('topper')].trim()).find(Boolean) || 'Unknown';
    const coaching = rs.map(r => r[H('coaching')].trim()).find(Boolean) || '';
    const paper = rs.map(r => r[H('subject')].trim()).find(Boolean) || 'Other';
    const { air, year } = fromFilename(base);

    const qs = rs.map(r => {
      const [marks, words] = parseMeta(r[H('metadata')] || '');
      const page = parseInt(r[H('page_number')], 10) || null;
      return [page, (r[H('question')] || '').trim(), marks, words];
    }).sort((a, b) => (a[0] || 0) - (b[0] || 0));

    copies.push({ i: i++, t: topper, c: coaching, p: paper, y: year, r: air, u: base, q: qs });

    if (topper !== 'Unknown') {
      const T = toppers[topper] || (toppers[topper] = { air: null, year: null, coaching: [], papers: [], copies: 0, marks: {}, verified: false, sources: [] });
      T.copies++;
      if (air && !T.air) T.air = air;
      if (year && !T.year) T.year = year;
      if (coaching && !T.coaching.includes(coaching)) T.coaching.push(coaching);
      if (paper && !T.papers.includes(paper)) T.papers.push(paper);
    }
  }

  copies.sort((a, b) => a.t.localeCompare(b.t) || a.p.localeCompare(b.p));

  const papers = {};
  let qCount = 0;
  for (const c of copies) { papers[c.p] = (papers[c.p] || 0) + c.q.length; qCount += c.q.length; }

  const generated = new Date().toISOString().slice(0, 10);
  const stats = { questions: qCount, copies: copies.length, toppers: new Set(copies.map(c => c.t)).size, papers };

  fs.writeFileSync(path.join(DATA, 'copies.json'), JSON.stringify({ generated, attribution: ATTRIBUTION, stats, copies }));

  // lightweight index — copy metadata without the question text, for instant first paint on mobile
  const lite = copies.map(c => ({ i: c.i, t: c.t, c: c.c, p: c.p, y: c.y, r: c.r, u: c.u, n: c.q.length }));
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

  const withAir = Object.values(toppers).filter(t => t.air).length;
  console.log(`index.json   ${lite.length} copies (${(fs.statSync(path.join(DATA, 'index.json')).size / 1024).toFixed(0)} KB)`);
  console.log(`copies.json  ${copies.length} copies, ${qCount} questions`);
  console.log(`toppers.json ${Object.keys(toppers).length} toppers, ${withAir} with an auto-parsed AIR`);
  console.log(`toppers.html + sitemap.xml + llms.txt + robots.txt written; index.html markers filled`);
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
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: SITE + '/data/copies.json' },
        { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: SITE + '/data/questions.csv' }
      ],
      citation: ATTRIBUTION
    },
    {
      '@type': 'FAQPage',
      '@id': SITE + '/#faq',
      mainEntity: [
        ['What is Toppers Copy?', `A free, searchable directory of UPSC Civil Services Mains topper answer copies. It indexes ${stats.questions.toLocaleString('en-IN')} questions inside ${stats.copies.toLocaleString('en-IN')} answer copies by ${stats.toppers} rankers and links to the exact page of each source PDF.`],
        ['Where do the answer copies come from?', 'Every copy is hosted by the coaching institute that originally published it — ForumIAS, Vision IAS, NextIAS, Lukmaan IAS, GS SCORE, Rau’s IAS and others. Toppers Copy only links to those files and never re-hosts them. The question-level data is credited to upsckata.com’s "Topper Copies" project.'],
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
- Direct links to answer-copy PDFs hosted by ForumIAS, Vision IAS, NextIAS, Lukmaan IAS, GS SCORE and Rau's IAS.
- Optional-subject copies: Sociology, Anthropology, History, PSIR, Geography, Public Administration,
  Philosophy, Economics, Literature and more (community-submitted).

## Machine-readable data

- Full question index (JSON, grouped by copy): https://topperscopy.hashin.me/data/copies.json
- Per-topper AIR / year / marks (JSON): https://topperscopy.hashin.me/data/toppers.json
- Raw source table (CSV): https://topperscopy.hashin.me/data/questions.csv
- Optional-subject submissions (JSON): https://topperscopy.hashin.me/data/optionals.json

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
