#!/usr/bin/env node
/*
 * extract.js — maintainer tool. Pull questions out of a topper PDF into
 * data/questions.csv rows, using the same heuristic the Submit form runs
 * in the browser (assets/extract.js).
 *
 *   npm install                       # once — installs pdfjs-dist (dev only)
 *   node extract.js <url|file.pdf> --topper "Shakti Dubey" --paper GS1 \
 *        [--coaching ForumIAS] [--air 1] [--year 2024] [--append]
 *
 * Without --append it prints the CSV rows to stdout for review.
 * With --append it writes them to data/submissions.csv (the accepted-submissions
 * store, kept separate from the pristine data/questions.csv mirror) — then run
 * `node build.js`, which also refreshes the dataset/ backup.
 *
 * For an optional-subject copy, use --json to emit a data/optionals.json entry
 * (with an embedded `questions` array) instead of CSV.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { extractQuestions, toCsvRows } = require('./assets/extract.js');

function parseArgs(argv) {
  const src = argv[0];
  const o = {};
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    o[k] = v;
  }
  return { src, o };
}

function linesFromItems(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]), x = it.transform[4];
    let row = null;
    for (let i = rows.length - 1; i >= 0 && i > rows.length - 8; i--) {
      if (Math.abs(rows[i].y - y) <= 2) { row = rows[i]; break; }
    }
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map(r => (r.parts.sort((a, b) => a.x - b.x), r.parts.map(p => p.s).join(' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean);
}

async function getPages(src) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (e) {
    throw new Error('pdfjs-dist is not installed. Run `npm install` first.');
  }
  let data;
  if (/^https?:/i.test(src)) {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${src}`);
    data = new Uint8Array(await r.arrayBuffer());
  } else {
    data = new Uint8Array(fs.readFileSync(src));
  }
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const tc = await pg.getTextContent();
    pages.push({ page: i, lines: linesFromItems(tc.items) });
  }
  return { pages, numPages: doc.numPages };
}

(async () => {
  const { src, o } = parseArgs(process.argv.slice(2));
  if (!src || src === '--help' || src === '-h') {
    console.log('node extract.js <url|file.pdf> --topper "Name" --paper GS1 [--coaching X] [--air N] [--year Y] [--append|--json]');
    process.exit(src ? 0 : 1);
  }

  const { pages, numPages } = await getPages(src);
  const { questions, count, method } = extractQuestions(pages);
  const url = /^https?:/i.test(src) ? src : (o.url || '');
  const meta = { topper: o.topper || '', coaching: o.coaching || o.source || '', subject: o.paper || o.subject || '', url };

  console.error(`${numPages} pages · ${count} questions detected (${method})`);
  if (!count) { console.error('No text layer found — this is probably a scan. Enter questions manually.'); process.exit(2); }

  if (o.json) {
    const entry = {
      topper: meta.topper, subject: (o.paper || o.subject || '').replace(/^Optional\s*[—-]\s*/i, ''),
      url, air: o.air ? Number(o.air) : undefined, year: o.year ? Number(o.year) : undefined,
      source: meta.coaching || undefined, by: o.by || undefined, verified: true,
      questions: questions.map(q => ({ page: q.page, question: q.question, marks: q.marks || undefined, words: q.words || undefined }))
    };
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  const rows = toCsvRows(questions, meta);
  if (o.append) {
    // accepted GS/Essay submissions go here, NOT into the pristine questions.csv mirror
    const csv = path.join(__dirname, 'data', 'submissions.csv');
    const HEADER = 'topper,coaching,subject,page_number,question,metadata,url\n';
    let body = fs.existsSync(csv) ? fs.readFileSync(csv, 'utf8') : HEADER;
    if (!body.trim()) body = HEADER;
    if (!body.endsWith('\n')) body += '\n';
    fs.writeFileSync(csv, body + rows.join('\n') + '\n');
    console.error(`Appended ${rows.length} rows to data/submissions.csv. Next: node build.js`);
  } else {
    console.log('topper,coaching,subject,page_number,question,metadata,url');
    console.log(rows.join('\n'));
  }
})().catch(e => { console.error('Error:', e.message || e); process.exit(1); });
