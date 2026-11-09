// Mirror every answer-copy PDF we link to into a Cloudflare R2 bucket, and keep a record of each one
// (data/pdf-mirror.json) so a file that goes missing — upstream or in the bucket — can be found, re-fetched and re-keyed (DECISION-32).
//
//   MIRROR=off node build.js                 # copies.json must hold the origin URLs, not R2 ones
//   node tools/mirror-pdfs.mjs plan          # add a manifest entry for every copy URL (no network); never deletes one
//   node tools/mirror-pdfs.mjs status        # counts by status / host, bytes mirrored
//   node tools/mirror-pdfs.mjs run [--limit N] [--host H] [--concurrency 4] [--minutes M] [--retry-gone] [--dry]
//   node tools/mirror-pdfs.mjs verify [--repair]   # list the bucket, compare with the manifest
//   node tools/mirror-pdfs.mjs selftest      # check the request signing against AWS's published test vector
//
// Env (GitHub Actions secrets): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET; R2_ENDPOINT overrides the host (tests).
//
// The manifest is keyed by the copy's origin URL — the URL build.js holds after DECISION-31's VisionIAS move — and records, per file:
//   status  pending | ok | failed (retried up to 3x) | gone (403/404/410/not a PDF) | skip (Drive, Telegram, too big) | dead
//   key     the object name in the bucket: <sha256>.pdf (plus a short suffix if two different URLs hold identical bytes,
//           because one URL is one copy — INV-3 — and two copies must not collapse into one)
//   was     for VisionIAS copies, the old cdn.visionias.in URL — the one every OCR row in data/*.csv still carries
//   topper/paper/source  who and what it is, so a lost file is recognisable without the site
// Every object also carries its origin URL in the x-amz-meta-src header, so the bucket alone can rebuild the manifest.
import fs from 'node:fs';
import crypto from 'node:crypto';

const MANIFEST = 'data/pdf-mirror.json';
const MAX_BYTES = 300 * 1024 * 1024;
const SKIP_HOSTS = { 'drive.google.com': 'google-drive', 't.me': 'telegram' };   // no stable direct file, or not a PDF
const DEAD_HOSTS = ['cdn.visionias.in'];                                      // VisionIAS lists no file for what is still on it (DECISION-31)
const UA = 'topperscopy-mirror (+https://topperscopy.hashin.me)';           // honest UA — we do not pose as a browser

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hostOf = u => { try { return new URL(u).host; } catch { return ''; } };

/* ---------- AWS Signature V4 (what R2's S3 API speaks), no dependencies ---------- */
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function signV4({ method, host, path, query = '', headers = {}, payloadHash, region, service, ak, sk, amzDate }) {
  const h = {};
  for (const [k, v] of Object.entries({ ...headers, host })) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const names = Object.keys(h).sort();
  const canonQuery = query.split('&').filter(Boolean).map(p => p.split('=')).map(([k, v = '']) => [k, v]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1).map(([k, v]) => k + '=' + v).join('&');
  const canonical = [method, path, canonQuery, names.map(n => n + ':' + h[n] + '\n').join(''), names.join(';'), payloadHash].join('\n');
  const day = amzDate.slice(0, 8), scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + sk, day), region), service), 'aws4_request');
  return `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hmac(key, toSign).toString('hex')}`;
}

function r2client() {
  const E = process.env, need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const missing = need.filter(k => !E[k]);
  if (missing.length) throw new Error('missing env: ' + missing.join(', '));
  const origin = E.R2_ENDPOINT || `https://${E.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, host = new URL(origin).host;
  return async function r2(method, key, { body, headers = {}, query = '' } = {}) {
    const path = '/' + E.R2_BUCKET + (key ? '/' + key : '');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const payloadHash = sha256(body || '');
    const hdr = { 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, ...headers };
    const authorization = signV4({ method, host, path, query, headers: hdr, payloadHash, region: 'auto', service: 's3', ak: E.R2_ACCESS_KEY_ID, sk: E.R2_SECRET_ACCESS_KEY, amzDate });
    return fetch(origin + path + (query ? '?' + query : ''), { method, headers: { ...hdr, authorization }, body, signal: AbortSignal.timeout(300000) });
  };
}

/* ---------- the manifest: one line per file, sorted, so a diff shows only what changed ---------- */
function load() {
  return fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    : { _meta: { base: '', note: 'base = the public URL of the R2 bucket (no trailing slash). While it is empty the site links to the original publishers; build.js switches a copy to R2 only when base is set and its entry is status ok.' }, files: {} };
}
function save(m) {
  const lines = Object.keys(m.files).sort().map(u => JSON.stringify(u) + ': ' + JSON.stringify(m.files[u]));
  const tmp = MANIFEST + '.tmp';
  fs.writeFileSync(tmp, '{\n"_meta": ' + JSON.stringify(m._meta) + ',\n"files": {\n' + lines.join(',\n') + '\n}\n}\n');
  fs.renameSync(tmp, MANIFEST);
}

const [, , cmd = 'status', ...argv] = process.argv;
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const flag = k => argv.includes('--' + k);

/* ---------- selftest: AWS's published "get-vanilla" vector (sigv4 test suite) ---------- */
if (cmd === 'selftest') {
  const got = signV4({ method: 'GET', host: 'example.amazonaws.com', path: '/', headers: { 'x-amz-date': '20150830T123600Z' }, payloadHash: sha256(''), region: 'us-east-1', service: 'service', ak: 'AKIDEXAMPLE', sk: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', amzDate: '20150830T123600Z' });
  const want = 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31';
  console.log(got === want ? 'selftest ok — signing matches the AWS test vector' : 'selftest FAILED\n got  ' + got + '\n want ' + want);
  process.exit(got === want ? 0 : 1);
}

/* ---------- plan: a manifest entry for every copy, from the built copies.json ---------- */
if (cmd === 'plan') {
  const cj = JSON.parse(fs.readFileSync('data/copies.json', 'utf8'));
  const m = load(), moves = fs.existsSync('data/visionias-urls.json') ? JSON.parse(fs.readFileSync('data/visionias-urls.json', 'utf8')) : {};
  const wasOf = {}; for (const [o, n] of Object.entries(moves)) if (!o.startsWith('_')) wasOf[n] = o;
  const base = (m._meta.base || '').replace(/\/$/, '');
  let added = 0, r2Seen = 0;
  for (const [name, t] of Object.entries(cj.toppers)) for (const c of t.copies) {
    const u = c[2].split('#')[0];
    if (base && u.startsWith(base + '/')) { r2Seen++; continue; }          // built without MIRROR=off — origin unknown
    if (m.files[u]) continue;
    const host = hostOf(u);
    const e = { status: 'pending', topper: name, paper: c[0], source: c[1] };
    if (wasOf[u]) e.was = wasOf[u];
    if (SKIP_HOSTS[host]) { e.status = 'skip'; e.err = SKIP_HOSTS[host]; }
    else if (DEAD_HOSTS.includes(host)) { e.status = 'dead'; e.err = 'no file listed by the publisher'; }
    m.files[u] = e; added++;
  }
  if (r2Seen) { console.error(`copies.json holds ${r2Seen} R2 URLs — rebuild with MIRROR=off first`); process.exit(1); }
  save(m);
  console.log(`manifest: ${Object.keys(m.files).length} files (+${added} new)`);
  process.exit(0);
}

if (cmd === 'status') {
  const m = load(), by = {}, hosts = {};
  let bytes = 0;
  for (const [u, e] of Object.entries(m.files)) {
    by[e.status] = (by[e.status] || 0) + 1;
    if (e.status === 'ok') bytes += e.bytes || 0;
    if (e.status === 'pending' || e.status === 'failed') hosts[hostOf(u)] = (hosts[hostOf(u)] || 0) + 1;
  }
  console.log(by, `\n${(bytes / 1e9).toFixed(2)} GB mirrored · base ${m._meta.base || '(not set — site still links to publishers)'}`);
  console.log('still to do, by host:', hosts);
  process.exit(0);
}

/* ---------- run: download, check it is a PDF, upload, record ---------- */
async function download(u) {
  const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(180000) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.http = r.status; throw e; }
  if (+r.headers.get('content-length') > MAX_BYTES) { const e = new Error('too big'); e.skip = true; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) { const e = new Error('too big'); e.skip = true; throw e; }
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { const e = new Error('not a PDF (' + (r.headers.get('content-type') || '?').slice(0, 30) + ')'); e.gone = true; throw e; }
  return buf;
}

if (cmd === 'run') {
  const m = load(), files = m.files, r2 = flag('dry') ? null : r2client();
  const limit = +arg('limit', 0) || Infinity, conc = +arg('concurrency', 4), only = arg('host'), deadline = Date.now() + (+arg('minutes', 0) || 1e9) * 60000;
  const keyOwner = new Map();
  for (const [u, e] of Object.entries(files)) if (e.status === 'ok') keyOwner.set(e.key, u);
  const due = ([, e]) => e.status === 'pending' || (e.status === 'failed' && (e.tries || 0) < 3) || (flag('retry-gone') && e.status === 'gone');
  const lists = {};                                                        // round-robin over hosts so no host is hit back to back
  for (const it of Object.entries(files).filter(due)) if (!only || hostOf(it[0]) === only) (lists[hostOf(it[0])] ||= []).push(it);
  const todo = [], ls = Object.values(lists);
  for (let i = 0; todo.length < limit && ls.some(l => i < l.length); i++) for (const l of ls) if (i < l.length && todo.length < limit) todo.push(l[i]);
  console.log(`${todo.length} files to mirror${flag('dry') ? ' (dry run)' : ''}`);
  if (flag('dry')) process.exit(0);

  const gate = new Map();
  const polite = async host => { const now = Date.now(), at = Math.max(now, gate.get(host) || 0); gate.set(host, at + 500); if (at > now) await sleep(at - now); };
  let next = 0, ok = 0, bad = 0, bytes = 0;
  async function one([u, e]) {
    await polite(hostOf(u));
    let buf;
    try { buf = await download(u); }
    catch (err) {
      e.err = String(err.message || err).slice(0, 80); e.tries = (e.tries || 0) + 1; e.at = new Date().toISOString().slice(0, 10);
      e.status = err.skip ? 'skip' : (err.gone || [403, 404, 410].includes(err.http)) ? 'gone' : 'failed';
      bad++; return;
    }
    try {
      const h = sha256(buf);
      let key = h + '.pdf';
      if (keyOwner.has(key) && keyOwner.get(key) !== u) key = h + '-' + crypto.createHash('sha1').update(u).digest('hex').slice(0, 8) + '.pdf';
      const head = await r2('HEAD', key);
      if (!(head.status === 200 && +head.headers.get('content-length') === buf.length)) {
        const meta = encodeURIComponent(u);
        const put = await r2('PUT', key, { body: buf, headers: { 'content-type': 'application/pdf', ...(meta.length < 1500 ? { 'x-amz-meta-src': meta } : {}) } });
        if (put.status !== 200) throw new Error('R2 PUT ' + put.status + ' ' + (await put.text()).slice(0, 120));
        const etag = (put.headers.get('etag') || '').replace(/"/g, '');
        if (etag && etag !== crypto.createHash('md5').update(buf).digest('hex')) throw new Error('R2 etag mismatch');
      }
      keyOwner.set(key, u);
      Object.assign(e, { status: 'ok', key, sha256: h, bytes: buf.length, at: new Date().toISOString().slice(0, 10) });
      delete e.err; delete e.tries; ok++; bytes += buf.length;
    } catch (err) { e.status = 'failed'; e.err = String(err.message || err).slice(0, 80); e.tries = (e.tries || 0) + 1; bad++; }   // a bucket error is not the file's fault
  }
  let sinceSave = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < todo.length && Date.now() < deadline) {
      await one(todo[next++]);
      if (++sinceSave % 25 === 0) { save(m); console.log(`${next}/${todo.length}  ok ${ok}  not ok ${bad}  ${(bytes / 1e9).toFixed(2)} GB`); }
    }
  }));
  save(m);
  console.log(`done: ${ok} mirrored (${(bytes / 1e9).toFixed(2)} GB), ${bad} not mirrored`);
  process.exit(0);
}

/* ---------- verify: is everything the manifest calls ok really in the bucket? ---------- */
if (cmd === 'verify') {
  const m = load(), r2 = r2client(), inBucket = new Set();
  let token = '';
  for (;;) {
    const q = 'list-type=2' + (token ? '&continuation-token=' + enc(token) : '');
    const r = await r2('GET', '', { query: q });
    if (r.status !== 200) throw new Error('list failed ' + r.status);
    const x = await r.text();
    for (const k of x.matchAll(/<Key>([^<]+)<\/Key>/g)) inBucket.add(k[1]);
    token = x.includes('<IsTruncated>true</IsTruncated>') ? (x.match(/<NextContinuationToken>([^<]+)</) || [])[1] : '';
    if (!token) break;
  }
  const okKeys = new Set(Object.values(m.files).filter(e => e.status === 'ok').map(e => e.key));
  const missing = Object.entries(m.files).filter(([, e]) => e.status === 'ok' && !inBucket.has(e.key));
  const extra = [...inBucket].filter(k => !okKeys.has(k));
  console.log(`bucket ${inBucket.size} objects · manifest ok ${okKeys.size} · missing from bucket ${missing.length} · in bucket but not in manifest ${extra.length}`);
  for (const [u] of missing.slice(0, 10)) console.log('  missing', u);
  if (flag('repair') && missing.length) { for (const [, e] of missing) { e.status = 'pending'; delete e.key; delete e.sha256; delete e.bytes; } save(m); console.log(`re-queued ${missing.length} as pending`); }
  process.exit(missing.length ? 1 : 0);
}

console.error('usage: node tools/mirror-pdfs.mjs plan | status | run | verify | selftest');
process.exit(2);
