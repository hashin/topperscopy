#!/usr/bin/env node
// find-new-sources.mjs — staged discovery tool for new UPSC topper-copy sources.
//
// This does NOT touch any source-of-truth file (questions.csv, link-copies.json, optionals.json,
// toppers.overrides.json, ...). It only writes docs/candidates/<date>-crawl.{json,md} for a human
// (Hashin) to review before anything gets merged into the real dataset by hand, per the workflow
// in CLAUDE.md.
//
// Why this is a script and not just a chat transcript: the *discovery* half (searching the open
// web for coaching sites we don't have yet) has to happen interactively — an agent session with
// WebSearch/WebFetch, making small targeted queries and reading real results, because there is no
// API key or search index wired into this repo. What CAN be automated, and re-run later without an
// agent, is the *verification* half: given a list of candidate copies someone (or some session)
// found, (a) confirm each PDF is still fetchable unauthenticated, with no login redirect, and
// (b) re-check every topper name against the CURRENT source-of-truth files for a collision, using
// the exact nameKey() fold from build.js. That's what this file does.
//
// Workflow to extend this later: run a fresh round of small WebSearch/WebFetch calls (see the
// session notes in docs/candidates/<date>-crawl.md for the pattern that worked — short, specific
// queries, not one broad crawl), add any newly-found copies to CANDIDATE_COPIES below with the
// site's entry in CANDIDATE_SITES, then `node find-new-sources.mjs` to re-verify everything and
// regenerate the dated report.
//
// Zero runtime deps, same spirit as build.js: only Node builtins (fetch is global since Node 18).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'docs', 'candidates');

const UA = 'Mozilla/5.0 (compatible; topperscopy-source-finder/1.0; +https://topperscopy.hashin.me)';
const REQUEST_DELAY_MS = 1200; // be polite: one request in flight per host, paced

/* ======================================================================
 * Sites checked this session — both the one that panned out and the ones that didn't.
 * Kept here (not just in the .md) so a re-run doesn't have to re-derive the "why skip" reasoning.
 * ====================================================================== */
const CANDIDATE_SITES = [
  {
    name: 'Toppers IAS (toppersias.in)',
    homepage: 'https://www.toppersias.in/sociology-toppers-answer-sheets.html',
    status: 'checked-no-new-content',
    note: 'Sociology-optional coaching site. Its PDFs ARE genuinely public (direct same-origin files ' +
      'under /images/answer-sheets/, no login, 200 + content-type: application/pdf on unauthenticated ' +
      'HEAD, robots.txt only disallows /user*) — but every one of its 6 listed toppers turned out to ' +
      'already be in the dataset at the exact same AIR/year via VisionIAS (cdn.visionias.in), i.e. this ' +
      'site is a full re-host of VisionIAS’s already-covered Sociology booklets under a second host, ' +
      'not a new original source. One listed topper (Neha Bandhu) has two dead PDF links (404), and one ' +
      '(Komal Aggarwal) is the site’s own mock/test-series paper, not an actual Mains copy. See ' +
      'KNOWN_SKIPS for the per-topper breakdown. Zero new candidates survived from this site.'
  },
  {
    name: 'PW OnlyIAS (pwonlyias.com)',
    homepage: 'https://pwonlyias.com/upsc-toppers-answer-sheet/',
    status: 'rejected',
    note: 'Next.js SPA — no .pdf reference anywhere in the server-rendered HTML (checked both the ' +
      'landing page and page source for "pdf": zero hits). Site has /login and /pricing sections, ' +
      'consistent with content behind a freemium gate. Could not confirm a public per-copy PDF URL ' +
      'without executing client-side JS / an account; skipped rather than guessed.'
  },
  {
    name: 'UPSCYatra (upscyatra.in)',
    homepage: 'https://upscyatra.in/topper-copies',
    status: 'rejected',
    note: 'A secondary aggregator, not a primary source: a sampled question page ' +
      '(/topper-copies/question/gs1-green-hydrogen-...) carries "coaching":"Nextias" in its own ' +
      'embedded data — i.e. it is re-displaying NextIAS material we already have, not new material ' +
      'of its own. It also exposes no PDF links of its own (per-question pages render answer text ' +
      'client-side with no href to a source PDF found in static HTML).'
  },
  {
    name: 'UPSC Path (upscpath.com)',
    homepage: 'https://upscpath.com/',
    status: 'rejected',
    note: 'SvelteKit app sitting behind a Cloudflare bot challenge (challenge-platform script seen ' +
      'on first load). Not pursued further — no static PDF links reachable without executing JS ' +
      'past the challenge, which this tool does not attempt.'
  },
  {
    name: 'iasbano.com',
    homepage: 'https://iasbano.com/upsc_Toppers_Answer_Sheet.php',
    status: 'rejected',
    note: 'Not a coaching institute — a domain-parking / ad-arbitrage page (generic dark-themed ' +
      '"link list" template, page <title> is just "Iasbano"). Its only two hrefs are ' +
      'intivesearch.com/privacy and /terms — an ad redirector, no actual content. Spam, not a source.'
  },
  {
    name: 'gurugovindmaheesh.com',
    homepage: 'https://gurugovindmaheesh.com/psir-toppers-copy/',
    status: 'rejected',
    note: 'Thin, single-post WordPress site with no real body content past SEO/schema markup and a ' +
      'header image — no PDF link, no download link, no topper name found anywhere on the page. ' +
      'Reads as an auto-generated SEO placeholder, not a real institute publishing real copies.'
  },
  {
    name: 'upscpdf.com',
    homepage: 'https://upscpdf.com/toppers-copy/page/9/',
    status: 'rejected',
    note: 'Content-farm blog reposting other institutes’ material with inconsistent attribution. ' +
      'One post ("Rishita Gupta Rank 18") linked to blog.iasscore.in/wp-content/uploads/... — that ' +
      'file now 404s, and blog.iasscore.in is the same institute as the already-excluded GS SCORE ' +
      '(iasscore.in), so not re-investigated further per the existing dead-end. Another post ' +
      '("History Optional Toppers Copy PDF") links to a genuinely public Google Drive file, but the ' +
      'post body names no topper, no AIR, no year — just "This Pdf Very Useful For UPSC Mains 2024" ' +
      '— so it cannot be attributed to a specific person for our per-topper schema. Skipped.'
  },
  {
    name: 'Diademy IAS (diademy.com)',
    homepage: 'https://diademy.com/commerce-accountancy-optional-for-upsc/',
    status: 'rejected',
    note: 'Real Commerce & Accountancy optional coaching institute in Delhi. Search results mentioned ' +
      'toppers "Garima Lohia" and "Ishu Agrawal" by name, but neither name appears anywhere on the ' +
      'actual page (checked the full text) — the AI search summary appears to have drawn on a ' +
      'different page or hallucinated the attribution. The one PDF the page does link to ' +
      '(Commerce-Optional-Mains-2025-B-Test-Series-copy.pdf) is the institute’s own test-series ' +
      'sample, not a named topper’s real Mains copy. Skipped for lack of verifiable attribution.'
  },
  {
    name: 'ConvertIAS (convertias.com)',
    homepage: 'https://www.convertias.com/toppercopies',
    status: 'rejected',
    note: 'Client-rendered SPA (only tracking-pixel scripts in the static HTML, 241 hrefs but zero ' +
      '.pdf references) — same class of problem as PW OnlyIAS and UPSC Path. Could not confirm a ' +
      'public per-copy PDF URL without executing client-side JS.'
  },
  {
    name: 'Vajirao & Reddy Institute (vajiraoinstitute.com)',
    homepage: 'https://www.vajiraoinstitute.com/UPSC-Toppers-Testimonials.aspx',
    status: 'rejected',
    note: 'Real, well-known Delhi institute, but its toppers page is video testimonials and ' +
      'achiever bios, not scanned answer copies — no PDF links found on the page at all.'
  },
  {
    name: "Vaid's ICS (vaidsics.com)",
    homepage: 'https://vaidsics.com/vaidsics-anthropology-upsc-toppers.php',
    status: 'rejected',
    note: 'Real, well-established Anthropology-optional institute (founded 1985). Its dedicated ' +
      'toppers page is a rankers list + FAQ, not scanned answer copies — the only PDFs anywhere on ' +
      'the site are a PYQ compilation and standard UPSC notification/result PDFs, no per-topper ' +
      'answer booklet found.'
  }
];

/* ======================================================================
 * Candidate copies found this session (from CANDIDATE_SITES entries marked verified-public) that
 * survived BOTH the live-fetch check and the collision/duplicate check against current data.
 * Each is re-verified live by verifyPdfPublic() on every run — this array is the discovery output,
 * not a claim that's trusted forever.
 *
 * This session's result: EMPTY. Every copy found on the one site whose PDFs are genuinely public
 * (Toppers IAS) turned out, on close checking, to already be in the dataset via VisionIAS at the
 * same AIR/year — see KNOWN_SKIPS for the per-topper breakdown, and EXISTING_DATA_ISSUES for a
 * pre-existing name-collision this checking process surfaced in the CURRENT dataset (unrelated to
 * anything from this crawl, but worth a look). A future run should add newly-found entries here
 * once a new site clears CANDIDATE_SITES with status 'verified-public' AND its copies clear both
 * checks below.
 * ====================================================================== */
const CANDIDATE_COPIES = [];

// Copies seen on toppersias.in that were deliberately NOT carried into CANDIDATE_COPIES, and why —
// kept here so a future run doesn't waste a request re-discovering the same dead ends.
const KNOWN_SKIPS = [
  {
    topper: 'Srushti Deshmukh', air: 5, year: 2018, subject: 'Sociology',
    reason: 'Already in data/link-copies.json and data/optionals.json at the same AIR/year, sourced ' +
      'from VisionIAS (cdn.visionias.in) and IAS Exam Portal. toppersias.in/1_srushti_deshmukh_rank_5.pdf ' +
      'is the same booklet on a third host — a duplicate copy of an already-covered person, not a new one.'
  },
  {
    topper: 'Sudhir Kumar', air: 42, year: 2017, subject: 'Sociology',
    reason: 'Already in data/link-copies.json and data/optionals.json at the same AIR/year, sourced ' +
      'from VisionIAS (cdn.visionias.in). Same reasoning as Srushti Deshmukh above — duplicate host.'
  },
  {
    topper: 'Sanya Chhabra', air: 84, year: 2018, subject: 'Sociology',
    reason: 'Already in data/optionals.json at the same AIR/year, sourced from VisionIAS ' +
      '(cdn.visionias.in/toppersanswerbooklet/...sanya_chhabra_rank_84.pdf). Duplicate host, not new.'
  },
  {
    topper: 'Neha Bhosle', air: 15, year: 2019, subject: 'Sociology',
    reason: 'Already in data/link-copies.json (Essay/GS1/GS4) and data/optionals.json (Sociology) at ' +
      'the same AIR/year, sourced from VisionIAS. Duplicate host, not new.'
  },
  {
    topper: 'Gaurav Kumar', air: 34, year: 2017, subject: 'Sociology',
    reason: 'Already in data/link-copies.json (GS1/Essay/GS4) and data/optionals.json (Sociology) at ' +
      'the same AIR/year, sourced from VisionIAS. Duplicate host, not new. (Do not confuse with the ' +
      '*different* Gaurav Kumar already in questions.csv at AIR 377/2025 — see EXISTING_DATA_ISSUES.)'
  },
  {
    topper: 'Neha Bandhu', air: 121, year: 2019, subject: 'Sociology',
    reason: 'Both PDF links on the page (1_neha_bandhu_rank_121.pdf, 2_neha_bandhu_rank_121.pdf) ' +
      '404 on toppersias.in — dead links, nothing to add.'
  },
  {
    topper: 'Komal Aggarwal', air: 303, year: 2022, subject: 'Sociology',
    reason: 'The linked PDFs are labelled "Sectional Test" / "Full Length Test" — Toppers IAS’s own ' +
      'mock/test-series papers, not an actual UPSC Mains answer copy. Out of scope for this dataset.'
  }
];

// Not a candidate at all — a data-quality finding this session's collision-check tooling surfaced
// in the CURRENT live dataset while cross-checking the Toppers IAS names above. Recorded here (and
// echoed in the .md report) because it fits the same "flag, don't silently fix" instruction as a new
// candidate's collision risk, even though nothing from this crawl caused it.
const EXISTING_DATA_ISSUES = [
  {
    finding: 'Two different real toppers are already merged under "Gaurav Kumar" in the live dataset.',
    detail: 'data/link-copies.json + data/optionals.json have a "Gaurav Kumar", AIR 34 / 2017, ' +
      'Sociology optional (source: VisionIAS). Separately, data/questions.csv has a "Gaurav Kumar", ' +
      'AIR 377 / 2025, Essay/GS2/GS3 (source: ForumIAS, filename ' +
      '"GAURAV-KUMAR-UPSC_IAS_2025_Toppers_AIR_377_..."). "Gaurav Kumar" is a common enough name that ' +
      'AIR 34/2017 and AIR 377/2025 are almost certainly two different people, 8 years apart — but ' +
      'nameKey()’s spelling-only fold already treats them as one person on the live site today. ' +
      'Same pattern as the open Preeti Kumari item in CLAUDE.md’s Open Items, but this one is ' +
      'already live, not just a pending addition. Needs Hashin to confirm and, if they are indeed two ' +
      'people, give one a distinguishing name variant.'
  }
];

/* ======================================================================
 * nameKey() — copied verbatim from build.js so collision checks fold names exactly the same way
 * the real build does. Keep this in sync if build.js's version ever changes.
 * ====================================================================== */
const nameKey = s => String(s || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Adapted from build.js's fromFilename(): questions.csv/submissions.csv/ocr-questions.csv carry no
// explicit air/year columns, so build.js recovers them (when present) from the PDF filename itself,
// e.g. ".../Shakti_Dubey_AIR-1_2024_GS1.pdf" -> {air: 1, year: 2024}.
//
// NOTE — deliberate divergence from build.js: its regex is `AIR[-_ ]?(\d{1,3})\b`. `\b` treats "_"
// as a word character, so it fails on an underscore-terminated token like
// "...AIR_377_Sample_ESSAY_1.pdf" (no boundary between "377" and the following "_"). That means
// build.js itself likely isn't resolving this Gaurav Kumar's AIR 377 from the filename either —
// worth a maintainer look separately. For OUR purpose here (collision detection needs the AIR even
// when build.js's own display logic might miss it), this uses `(?!\d)` instead of `\b` so a run of
// digits followed by "_" still counts as the end of the number.
function fromFilename(url) {
  const fn = decodeURIComponent(String(url || '').split('/').pop() || '');
  const air = (fn.match(/AIR[-_ ]?(\d{1,3})(?!\d)/i) || [])[1];
  const year = (fn.match(/(?<!\d)(20(?:1[5-9]|2[0-6]))(?!\d)/) || [])[1];
  return { air: air ? +air : null, year: year ? +year : null };
}

// Same CSV parser as build.js (state machine, handles quoted fields with embedded commas/newlines).
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

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/* ======================================================================
 * Build a nameKey -> [{air, year, source}] index from every source-of-truth file, so we can flag a
 * candidate whose folded name already exists with a DIFFERENT air/year (a likely different person
 * sharing a common name, per the Preeti Kumari / Gaurav Kumar pattern) versus one that's a genuine
 * duplicate of an existing record (same air/year — just a new host for a copy we already have).
 * ====================================================================== */
function loadExistingNameIndex() {
  const index = new Map(); // nameKey -> [{air, year, source, displayName}]
  const add = (name, air, year, source) => {
    if (!name) return;
    const k = nameKey(name);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push({ air: air ?? null, year: year ?? null, source, displayName: name });
  };

  // questions.csv / submissions.csv / ocr-questions.csv: topper,coaching,subject,page_number,question,metadata,url
  // These don't carry air/year directly (that's resolved by build.js from overrides + filename), so
  // we just record the name as "seen, no AIR on file here" — still useful to know the name exists.
  for (const f of ['questions.csv', 'submissions.csv', 'ocr-questions.csv']) {
    const file = path.join(DATA, f);
    if (!fs.existsSync(file)) continue;
    const rows = parseCSV(fs.readFileSync(file, 'utf8'));
    for (const r of rows) {
      if (!r[0] || r[0] === 'topper') continue; // skip header/blank
      const { air, year } = fromFilename(r[6]); // url is the 7th column
      add(r[0], air, year, f);
    }
  }

  const linkCopies = readJson(path.join(DATA, 'link-copies.json'), { entries: [] }).entries || [];
  for (const e of linkCopies) add(e.topper, e.air, e.year, 'link-copies.json');

  const optionals = readJson(path.join(DATA, 'optionals.json'), { entries: [] }).entries || [];
  for (const e of optionals) add(e.topper, e.air, e.year, 'optionals.json');

  const overrides = readJson(path.join(DATA, 'toppers.overrides.json'), {});
  for (const [name, o] of Object.entries(overrides)) {
    if (name.startsWith('_')) continue;
    add(name, o.air, o.year, 'toppers.overrides.json');
  }

  return index;
}

// A candidate collides if its folded name already exists AND every existing record under that key
// has an air/year that's known and DIFFERS from the candidate's. If the existing name only ever
// appears without an air/year on file (e.g. only seen in questions.csv), or if any existing record
// shares the same air+year, we don't call it a collision.
function checkCollision(candidate, index) {
  const k = nameKey(candidate.topper);
  const existing = index.get(k);
  if (!existing || !existing.length) return null;

  const sameAirYear = existing.some(e => e.air != null && e.year != null &&
    e.air === candidate.air && e.year === candidate.year);
  if (sameAirYear) return null; // genuine duplicate of a record we already have, not a collision

  const withAirYear = existing.filter(e => e.air != null || e.year != null);
  if (!withAirYear.length) return null; // name seen, but nothing on file to conflict with

  const conflict = withAirYear[0];
  return `"${candidate.topper}" already exists in ${conflict.source} as AIR ${conflict.air ?? '?'} / ` +
    `${conflict.year ?? '?'} — candidate claims AIR ${candidate.air ?? '?'} / ${candidate.year ?? '?'}. ` +
    `Same folded name (nameKey), different person unless confirmed otherwise.`;
}

/* ======================================================================
 * Live verification: is this PDF actually fetchable, unauthenticated, right now?
 * A HEAD request is enough to see status + content-type without downloading the file itself.
 * ====================================================================== */
async function verifyPdfPublic(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' });
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (res.status === 200 && ctype.includes('pdf')) return { ok: true, detail: `200 ${ctype}` };
    if (res.status === 200) return { ok: true, detail: `200 ${ctype || '(no content-type)'} — not labelled PDF, check manually` };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `fetch failed: ${err.message}` };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ======================================================================
 * Main
 * ====================================================================== */
async function main() {
  const nameIndex = loadExistingNameIndex();
  const results = [];
  let lastHost = null;

  for (const c of CANDIDATE_COPIES) {
    const host = new URL(c.url).host;
    if (host === lastHost) await sleep(REQUEST_DELAY_MS); // pace requests to the same host
    lastHost = host;

    const verify = await verifyPdfPublic(c.url);
    const collisionRisk = checkCollision(c, nameIndex);

    results.push({
      topper: c.topper,
      coaching: c.coaching,
      subject: c.subject,
      url: c.url,
      air: c.air,
      year: c.year,
      verifiedPublic: verify.ok,
      collisionRisk,
      note: c.note + (verify.ok ? '' : ` [RE-CHECK FAILED: ${verify.detail}]`)
    });

    console.log(`${verify.ok ? 'OK ' : 'FAIL'} ${c.topper} (${c.subject}, AIR ${c.air}/${c.year}) — ${verify.detail}` +
      (collisionRisk ? '  [COLLISION]' : ''));
  }

  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const jsonPath = path.join(OUT_DIR, `${today}-crawl.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2) + '\n');

  const verifiedCount = results.filter(r => r.verifiedPublic).length;
  const collisionCount = results.filter(r => r.collisionRisk).length;

  const md = [
    `# Candidate UPSC topper-copy sources — ${today}`,
    '',
    'Staged discovery list from an open-ended web search for coaching institutes/compilers publishing',
    'topper Mains answer copies not already in this dataset. **Nothing here has been merged** — every',
    'row needs a human (Hashin) to review before it touches `data/questions.csv`, `data/link-copies.json`,',
    '`data/optionals.json`, or `data/toppers.overrides.json`. See CLAUDE.md for the source-of-truth files',
    'and the collision-check convention (nameKey-based, spelling-only fold).',
    '',
    `Run at ${new Date().toISOString()}. ${verifiedCount}/${results.length} candidate copies still verify` +
      ` as publicly fetchable; ${collisionCount} flagged with a name collision risk.`,
    '',
    '## Sites checked',
    '',
    '| Site | Status | Why |',
    '|---|---|---|',
    ...CANDIDATE_SITES.map(s => `| [${s.name}](${s.homepage}) | ${s.status} | ${s.note.replace(/\|/g, '\\|')} |`),
    '',
    '## Verified candidate copies',
    '',
    ...(results.length
      ? [
          '| Topper | Coaching | Subject | AIR | Year | Public? | Collision risk | URL |',
          '|---|---|---|---|---|---|---|---|',
          ...results.map(r =>
            `| ${r.topper} | ${r.coaching} | ${r.subject} | ${r.air ?? ''} | ${r.year ?? ''} | ` +
            `${r.verifiedPublic ? 'yes' : 'NO — re-check failed'} | ${r.collisionRisk ? '**yes, see below**' : 'no'} | ${r.url} |`
          )
        ]
      : ['_None this run._']),
    '',
    '## Collision risks needing manual confirmation',
    '',
    ...(collisionCount
      ? results.filter(r => r.collisionRisk).map(r => `- **${r.topper}** (${r.subject}, AIR ${r.air}/${r.year}): ${r.collisionRisk}`)
      : ['_None this run._']),
    '',
    '## Known skips from Toppers IAS (not carried into the candidate list)',
    '',
    ...KNOWN_SKIPS.map(s => `- **${s.topper}** (AIR ${s.air}/${s.year}, ${s.subject}): ${s.reason}`),
    '',
    '## Pre-existing data issue surfaced while collision-checking (not from this crawl)',
    '',
    ...(EXISTING_DATA_ISSUES.length
      ? EXISTING_DATA_ISSUES.map(i => `- **${i.finding}** ${i.detail}`)
      : ['_None._']),
    '',
    '## Notes per candidate',
    '',
    ...(results.length ? results.map(r => `- **${r.topper}** — ${r.note}`) : ['_No candidates survived verification this run — see "Known skips" above._']),
    ''
  ].join('\n');

  const mdPath = path.join(OUT_DIR, `${today}-crawl.md`);
  fs.writeFileSync(mdPath, md);

  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
