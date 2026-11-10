// Ask the Internet Archive to snapshot every copy's PDF, so the site can offer an "Archived copy"
// link when a publisher's file disappears. Maintainer-only; nothing here ships to the site.
// Runs nightly from .github/workflows/wayback.yml; the ledger (data/wayback.json) is committed, so each
// run carries on where the last stopped.
//
//   MIRROR=off node build.js                       # needs data/copies.json (origin URLs, not R2 ones)
//   node tools/wayback-save.mjs --limit 100        # pilot: 100 URLs, round-robin over hosts
//   node tools/wayback-save.mjs --minutes 120      # everything not yet saved, stop starting new ones after 2 h
//   node tools/wayback-save.mjs --require-keys     # CI: refuse to run on the slow anonymous endpoint
//
// IA_ACCESS / IA_SECRET (archive.org account S3 keys) switch to the authenticated Save Page Now 2
// API, which has a far higher rate limit; without them it uses the anonymous GET /save/<url>.
// The ledger records every outcome: a re-run skips what is saved, and retries a failure only after
// RETRY_DAYS (a file that is dead at the publisher would otherwise be retried every night for ever).
// WAYBACK_LEDGER / WAYBACK_BASE override the ledger path and the archive.org origin (used to test against a mock).
import fs from 'node:fs';
import path from 'node:path';

const LEDGER = process.env.WAYBACK_LEDGER || 'data/wayback.json';
const BASE = process.env.WAYBACK_BASE || 'https://web.archive.org';
const SKIP_HOSTS = ['cdn.visionias.in'];      // 403 to everyone — nothing to snapshot (DECISION-30)
const RETRY_DAYS = 7;
const args = process.argv.slice(2);
const num = f => +(args[args.indexOf(f) + 1] || 0) || 0;
const limit = num('--limit') || Infinity;
const deadline = num('--minutes') ? Date.now() + num('--minutes') * 60000 : Infinity;
const POLL = +process.env.WAYBACK_POLL_MS || 5000, GAP = +process.env.WAYBACK_GAP_MS || 4000, WAIT = +process.env.WAYBACK_BUSY_MS || 60000;
const CONC = 2, TIMEOUT = 180000;             // IA allows only a few active Save Page Now sessions per account/IP
const sleep = ms => new Promise(f => setTimeout(f, ms));

const keyed = process.env.IA_ACCESS && process.env.IA_SECRET;
if (args.includes('--require-keys') && !keyed) { console.error('IA_ACCESS / IA_SECRET are not set'); process.exit(1); }

const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {};
// One entry per line, sorted: a nightly commit then shows only the URLs that changed.
const save = () => {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  const keys = Object.keys(ledger).sort();
  fs.writeFileSync(LEDGER, '{\n' + keys.map(k => JSON.stringify(k) + ': ' + JSON.stringify(ledger[k])).join(',\n') + '\n}\n');
};
const recentFail = e => e && !e.ok && e.at && Date.now() - Date.parse(e.at) < RETRY_DAYS * 864e5;

// Unique PDF URLs (a copy's identity ignores #page=), grouped by host.
const copies = JSON.parse(fs.readFileSync('data/copies.json', 'utf8'));
const byHost = {};
let saved = 0;
for (const t of Object.values(copies.toppers)) for (const c of t.copies) {
  const u = c[2].split('#')[0];
  let h; try { h = new URL(u).host; } catch { continue; }
  if (SKIP_HOSTS.includes(h)) continue;
  if (ledger[u]?.ok) { saved++; continue; }
  if (recentFail(ledger[u])) continue;
  (byHost[h] = byHost[h] || new Set()).add(u);
}
// Round-robin over hosts so a limited run covers all of them, and no host is hit back to back.
const lists = Object.values(byHost).map(s => [...s]);
const todo = [];
for (let i = 0; todo.length < limit && lists.some(l => i < l.length); i++)
  for (const l of lists) if (i < l.length && todo.length < limit) todo.push(l[i]);
console.log(`${saved} already saved, ${todo.length} URLs to try${keyed ? '' : ' (anonymous endpoint)'}`);

async function snapshot(u) {
  const t0 = Date.now();
  const sig = AbortSignal.timeout(TIMEOUT);
  if (keyed) {
    const auth = { Authorization: `LOW ${process.env.IA_ACCESS}:${process.env.IA_SECRET}`, Accept: 'application/json' };
    const r = await fetch(BASE + '/save', {
      method: 'POST', signal: sig, headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url: u, if_not_archived_within: '31536000', skip_first_archive: '1' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.job_id) return { ok: false, err: j.message || 'HTTP ' + r.status };
    for (;;) {                                  // poll the job until it settles
      await sleep(POLL);
      const s = await (await fetch(BASE + '/save/status/' + j.job_id, { signal: sig, headers: auth })).json();
      if (s.status === 'success') return { ok: true, ts: s.timestamp, ms: Date.now() - t0 };
      if (s.status === 'error') return { ok: false, err: s.message || s.status_ext };
    }
  }
  const r = await fetch(BASE + '/save/' + u, { signal: sig, redirect: 'manual' });
  const loc = r.headers.get('content-location') || r.headers.get('location') || '';
  const ts = (loc.match(/\/web\/(\d{14})/) || [])[1];
  if (r.status < 400 && ts) return { ok: true, ts, ms: Date.now() - t0 };
  return { ok: false, err: 'HTTP ' + r.status + (r.headers.get('x-archive-wayback-runtime-error') || '') };
}

// Two answers from IA are not failures: "too many active sessions" means wait and retry (the 100-URL pilot
// lost ~85 URLs by recording it as an error), and "the same snapshot had been made N hours ago" means the
// file is already archived (IA refuses a new capture for a year).
// A dropped connection ("fetch failed") is retried too: the snapshot may even have gone through, in which case the
// retry gets the "same snapshot" answer and counts as saved.
const BUSY = /limit of active Save Page Now sessions/, HAVE = /same snapshot had been made/, NET = /^(network:|timeout$)/;
async function attempt(u) {
  for (let n = 0; ; n++) {
    let r;
    try { r = await snapshot(u); }
    catch (e) { r = { ok: false, err: e.name === 'TimeoutError' ? 'timeout' : 'network: ' + String(e.cause?.code || e.cause?.message || e.message || e).slice(0, 70) }; }
    if (!r.ok && HAVE.test(r.err)) return { ok: true, already: true };
    if (!r.ok && BUSY.test(r.err) && n < 5) { await sleep(WAIT); continue; }
    if (!r.ok && NET.test(r.err) && n < 3) { await sleep(WAIT / 2); continue; }
    return r;
  }
}

let i = 0, done = 0;
const tried = [];
async function worker() {
  while (i < todo.length && Date.now() < deadline) {
    const u = todo[i++];
    ledger[u] = { ...(await attempt(u)), at: new Date().toISOString().slice(0, 10) };
    tried.push(u);
    if (++done % 10 === 0) { save(); console.log(`${done}/${todo.length}`); }
    await sleep(GAP);                             // stay well under IA's per-IP rate limit
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
save();
if (tried.length < todo.length) console.log(`stopped on the time limit: ${todo.length - tried.length} left for the next run`);

const tally = {};
for (const u of tried) {
  const h = new URL(u).host, e = ledger[u];
  const t = tally[h] = tally[h] || { ok: 0, fail: 0, errs: {} };
  if (e.ok) t.ok++; else { t.fail++; t.errs[e.err] = (t.errs[e.err] || 0) + 1; }
}
console.table(Object.fromEntries(Object.entries(tally).map(([h, t]) => [h, { ok: t.ok, fail: t.fail, errs: JSON.stringify(t.errs) }])));
const total = Object.values(ledger).filter(e => e.ok).length;
console.log(`ledger: ${total} saved, ${Object.keys(ledger).length - total} failed`);
