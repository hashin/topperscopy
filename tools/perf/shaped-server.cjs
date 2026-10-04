// Local test server for tools/perf/*.cjs — static files with ETag/304 + gzip AND a shaped link: every response waits RTT ms, then all bodies share one
// BPS bandwidth budget (16 KB chunks, FIFO) — so service-worker fetches are throttled exactly like page fetches.
// GET /__stats returns {bytes, reqs, files} since the last /__stats and resets; GET /__swbump serves sw.js with VERSION tc-v99.
// Why shape here and not in Chrome: CDP throttling skips service-worker fetches.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const ROOT = process.env.ROOT, PORT = +process.env.PORT, BPS = +process.env.BPS || 0, RTT = +process.env.RTT || 0;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const gz = new Map();   // cache gzip bodies
let SWBUMP = false, free = 0, stats = { bytes: 0, reqs: 0, files: [] };
function send(res, buf) {
  if (!BPS) return res.end(buf);
  let off = 0;
  (function next() {
    if (off >= buf.length) return res.end();
    const n = Math.min(16384, buf.length - off), now = Date.now();
    free = Math.max(free, now) + n / BPS * 1000;
    setTimeout(() => { res.write(buf.subarray(off, off + n)); off += n; next(); }, free - now);
  })();
}
http.createServer((req, res) => {
  if (req.url === '/__stats') { res.end(JSON.stringify(stats)); stats = { bytes: 0, reqs: 0, files: [] }; return; }
  if (req.url === '/__swbump') { SWBUMP = true; res.end('ok'); return; }   // serve sw.js with a new VERSION from now on
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  setTimeout(() => {
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(f);
    if (SWBUMP && p === '/sw.js') body = Buffer.from(String(body).replace(/var VERSION = 'tc-v\d+'/, "var VERSION = 'tc-v99'"));
    const etag = '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
    const h = { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag };
    stats.reqs++;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    if (/gzip/.test(req.headers['accept-encoding'] || '')) { if (!gz.has(f + etag)) gz.set(f + etag, zlib.gzipSync(body)); body = gz.get(f + etag); h['Content-Encoding'] = 'gzip'; }
    stats.bytes += body.length; if (/data\//.test(p)) stats.files.push(p.replace('/data/', ''));
    res.writeHead(200, h); send(res, body);
  }, RTT);
}).listen(PORT);
