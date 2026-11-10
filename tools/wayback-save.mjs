// Ask the Internet Archive to snapshot every copy's PDF, so the site can offer an "Archived copy"
// link when a publisher's file disappears. Maintainer-only; nothing here ships to the site.
//
//   node build.js                                  # needs data/copies.json
//   node tools/wayback-save.mjs --limit 100        # pilot: 100 URLs, round-robin over hosts
//   node tools/wayback-save.mjs                    # everything not yet saved (resumable)
//
// IA_ACCESS / IA_SECRET (archive.org account S3 keys) switch to the authenticated Save Page Now 2
// API, which has a far higher rate limit; without them it uses the anonymous GET /save/<url>.
// The ledger records every outcome, so a re-run only retries what failed or was never tried.
import fs from 'node:fs';

const LEDGER = '.ocr/wayback.json';           // gitignored + excluded from deploy; move to data/ once adopted
const SKIP_HOSTS = ['cdn.visionias.in'];      // 403 to everyone — nothing to snapshot (DECISION-30)
const args = process.argv.slice(2);
const limit = +(args[args.indexOf('--limit') + 1] || 0) || Infinity;
const CONC = 3, TIMEOUT = 180000;

const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {};
const save = () => { fs.mkdirSync('.ocr', { recursive: true }); fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1)); };

// Unique PDF URLs (a copy's identity ignores #page=), grouped by host.
const copies = JSON.parse(fs.readFileSync('data/copies.json', 'utf8'));
const byHost = {};
for (const t of Object.values(copies.toppers)) for (const c of t.copies) {
  const u = c[2].split('#')[0];
  let h; try { h = new URL(u).host; } catch { continue; }
  if (SKIP_HOSTS.includes(h) || ledger[u]?.ok) continue;
  (byHost[h] = byHost[h] || new Set()).add(u);
}
// Round-robin over hosts so a limited run covers all of them, and no host is hit back to back.
const lists = Object.values(byHost).map(s => [...s]);
const todo = [];
for (let i = 0; todo.length < limit && lists.some(l => i < l.length); i++)
  for (const l of lists) if (i < l.length && todo.length < limit) todo.push(l[i]);
console.log(`${todo.length} URLs to save`);

const keyed = process.env.IA_ACCESS && process.env.IA_SECRET;
async function snapshot(u) {
  const t0 = Date.now();
  const sig = AbortSignal.timeout(TIMEOUT);
  if (keyed) {
    const auth = { Authorization: `LOW ${process.env.IA_ACCESS}:${process.env.IA_SECRET}`, Accept: 'application/json' };
    const r = await fetch('https://web.archive.org/save', {
      method: 'POST', signal: sig, headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url: u, if_not_archived_within: '31536000', skip_first_archive: '1' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.job_id) return { ok: false, err: j.message || 'HTTP ' + r.status };
    for (;;) {                                  // poll the job until it settles
      await new Promise(f => setTimeout(f, 5000));
      const s = await (await fetch('https://web.archive.org/save/status/' + j.job_id, { signal: sig, headers: auth })).json();
      if (s.status === 'success') return { ok: true, ts: s.timestamp, ms: Date.now() - t0 };
      if (s.status === 'error') return { ok: false, err: s.message || s.status_ext };
    }
  }
  const r = await fetch('https://web.archive.org/save/' + u, { signal: sig, redirect: 'manual' });
  const loc = r.headers.get('content-location') || r.headers.get('location') || '';
  const ts = (loc.match(/\/web\/(\d{14})/) || [])[1];
  if (r.status < 400 && ts) return { ok: true, ts, ms: Date.now() - t0 };
  return { ok: false, err: 'HTTP ' + r.status + (r.headers.get('x-archive-wayback-runtime-error') || '') };
}

let i = 0, done = 0;
async function worker() {
  while (i < todo.length) {
    const u = todo[i++];
    try { ledger[u] = await snapshot(u); }
    catch (e) { ledger[u] = { ok: false, err: e.name === 'TimeoutError' ? 'timeout' : String(e.message || e).slice(0, 80) }; }
    if (++done % 10 === 0) { save(); console.log(`${done}/${todo.length}`); }
    await new Promise(f => setTimeout(f, 4000));  // stay well under IA's per-IP rate limit
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
save();

const tally = {};
for (const u of todo) {
  const h = new URL(u).host, e = ledger[u];
  const t = tally[h] = tally[h] || { ok: 0, fail: 0, errs: {} };
  if (e.ok) t.ok++; else { t.fail++; t.errs[e.err] = (t.errs[e.err] || 0) + 1; }
}
console.table(Object.fromEntries(Object.entries(tally).map(([h, t]) => [h, { ok: t.ok, fail: t.fail, errs: JSON.stringify(t.errs) }])));
