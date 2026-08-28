#!/usr/bin/env node
/*
 * build.js — turns the raw questions.csv (mirrored from upsckata.com "Topper Copies")
 * into the compact JSON files the static site consumes.
 *
 *   data/questions.csv   ->  data/copies.json      (grouped by source PDF)
 *                            data/toppers.json     (per-topper AIR / year / marks)
 *
 * toppers.json is seeded from whatever we can parse out of the PDF file names
 * (ForumIAS / Vision name their files "...UPSC-IAS-2025-Toppers-AIR-7...").
 * Everything else (subject-wise marks, missing ranks) is filled in later from
 * community submissions merged by a maintainer.
 *
 * Run:  node build.js
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const SRC = path.join(DATA, 'questions.csv');
const ATTRIBUTION = 'https://toppercopies.upsckata.com/';

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
  // "Type: question, Word limit: 150 words, Marks: 10 marks"
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

function main() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const rows = parseCSV(raw);
  const header = rows[0].map(h => h.trim());
  const H = k => header.indexOf(k);
  const data = rows.slice(1).filter(r => r.length >= 7 && r.some(x => x !== ''));

  // group by base PDF url
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
    const topper = (rs.map(r => r[H('topper')].trim()).find(Boolean)) || 'Unknown';
    const coaching = (rs.map(r => r[H('coaching')].trim()).find(Boolean)) || '';
    const paper = (rs.map(r => r[H('subject')].trim()).find(Boolean)) || 'Other';
    const { air, year } = fromFilename(base);

    const qs = rs.map(r => {
      const [marks, words] = parseMeta(r[H('metadata')] || '');
      const page = parseInt(r[H('page_number')], 10) || null;
      return [page, (r[H('question')] || '').trim(), marks, words];
    }).sort((a, b) => (a[0] || 0) - (b[0] || 0));

    copies.push({ i: i++, t: topper, c: coaching, p: paper, y: year, r: air, u: base, q: qs });

    if (topper !== 'Unknown') {
      const T = toppers[topper] || (toppers[topper] = {
        air: null, year: null, coaching: [], papers: [], copies: 0,
        marks: {}, verified: false, sources: []
      });
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

  const out = {
    generated: new Date().toISOString().slice(0, 10),
    attribution: ATTRIBUTION,
    stats: {
      questions: qCount,
      copies: copies.length,
      toppers: new Set(copies.map(c => c.t)).size,
      papers
    },
    copies
  };

  fs.writeFileSync(path.join(DATA, 'copies.json'), JSON.stringify(out));

  // merge any manual overrides that a maintainer keeps in toppers.overrides.json
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
    generated: out.generated,
    note: 'AIR/year auto-parsed from source PDF file names where available; marks and missing ranks come from community submissions. verified=true means a maintainer checked it.',
    toppers
  }, null, 0));

  const withAir = Object.values(toppers).filter(t => t.air).length;
  console.log(`copies.json: ${copies.length} copies, ${qCount} questions`);
  console.log(`toppers.json: ${Object.keys(toppers).length} toppers, ${withAir} with an auto-parsed AIR`);
  console.log('papers:', papers);
}

main();
