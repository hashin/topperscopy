/* Shared helpers for the tools/perf harness.
   Zero runtime impact — nothing here ships to the browser. See tools/perf/README.md. */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ---------- byte helpers ---------- */
export const gzip = b => zlib.gzipSync(Buffer.isBuffer(b) ? b : Buffer.from(b), { level: 9 }).length;
export const brotli = b => zlib.brotliCompressSync(Buffer.isBuffer(b) ? b : Buffer.from(b), {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
}).length;
export const KB = n => (n / 1024).toFixed(1) + ' KB';
export const MB = n => (n / 1048576).toFixed(2) + ' MB';

/* ---------- playwright resolution ----------
   playwright-core is a devDependency. If it is not installed locally we fall back to a
   globally installed playwright, which is what the Claude Code web sandbox provides. */
export async function chromium() {
  const require_ = createRequire(import.meta.url);
  const tries = ['playwright-core', 'playwright'];
  for (const name of tries) {
    try { return (await import(name)).chromium; } catch { /* next */ }
  }
  // global install (npm root -g)
  try {
    const groot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    for (const name of tries) {
      const p = path.join(groot, name, 'index.js');
      if (fs.existsSync(p)) return require_(p).chromium;
    }
  } catch { /* fall through */ }
  throw new Error(
    'playwright-core not found. Install it:  npm install -D playwright-core\n' +
    '(Chromium itself is expected at PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers.)'
  );
}

/* Locate a Chromium binary without downloading one. */
export function chromiumPath() {
  if (process.env.TC_CHROMIUM) return process.env.TC_CHROMIUM;
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers',
    path.join(process.env.HOME || '', '.cache', 'ms-playwright')].filter(Boolean);
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs.readdirSync(base).filter(d => d.startsWith('chromium') && !d.includes('headless_shell'));
    for (const d of dirs) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(base, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;   // let playwright use its own default
}

/* ---------- device / network profiles ---------- */
export const PROFILES = {
  'desktop':     { cpu: 1, down: 40e6 / 8,  up: 10e6 / 8,  lat: 20,  vw: 1440, vh: 900, mobile: false },
  '4g':          { cpu: 4, down: 9e6 / 8,   up: 1.5e6 / 8, lat: 170, vw: 390,  vh: 844, mobile: true },
  '3g':          { cpu: 4, down: 1.6e6 / 8, up: 750e3 / 8, lat: 300, vw: 390,  vh: 844, mobile: true }
};

/* ---------- local origin ---------- */
export const PORT_GZIP = 8099;
export const PORT_BR = 8098;

/* Start the GitHub-Pages-alike static server in-process. mode: 'gzip' | 'br'. */
export async function serve(mode = 'gzip', port = mode === 'br' ? PORT_BR : PORT_GZIP) {
  const http = await import('node:http');
  const TYPES = {
    '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
    '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8',
    '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.csv': 'text/csv',
    '.bin': 'application/octet-stream', '.webmanifest': 'application/manifest+json'
  };
  const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript|manifest|octet-stream))/;
  const cache = new Map();
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!path.resolve(file).startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
      const ct = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const ae = String(req.headers['accept-encoding'] || '');
      let body = buf, enc = null;
      if (COMPRESSIBLE.test(ct)) {
        const key = mode + ':' + file;
        if (mode === 'br' && ae.includes('br')) {
          if (!cache.has(key)) cache.set(key, zlib.brotliCompressSync(buf, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
          body = cache.get(key); enc = 'br';
        } else if (ae.includes('gzip')) {
          if (!cache.has(key)) cache.set(key, zlib.gzipSync(buf, { level: 9 }));
          body = cache.get(key); enc = 'gzip';
        }
      }
      const h = { 'content-type': ct, 'content-length': body.length,
                  'cache-control': 'max-age=600', date: new Date().toUTCString() };
      if (enc) h['content-encoding'] = enc;
      res.writeHead(200, h).end(body);
    });
  });
  await new Promise(r => server.listen(port, r));
  return { url: 'http://127.0.0.1:' + port, close: () => new Promise(r => server.close(r)) };
}

/* Open a throttled page against `base`. Returns { browser, ctx, page, cdp }. */
export async function openPage(profile = '4g', opts = {}) {
  const P = PROFILES[profile] || PROFILES['4g'];
  const cr = await chromium();
  const browser = await cr.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({
    viewport: { width: opts.vw || P.vw, height: opts.vh || P.vh },
    isMobile: P.mobile, hasTouch: P.mobile,
    deviceScaleFactor: opts.dsf ?? 1,
    colorScheme: opts.colorScheme || 'light'
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, downloadThroughput: P.down, uploadThroughput: P.up, latency: P.lat });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
  return { browser, ctx, page, cdp, P };
}

/* Wait until app.js has booted and wired the search box. */
export async function waitForApp(page, timeout = 60000) {
  await page.waitForFunction(
    () => { const m = document.querySelector('#resultmeta'); return m && m.textContent.trim().length > 0; },
    { timeout });
}

export function need(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    console.error(`missing ${file} — run \`node build.js\` first.`);
    process.exit(1);
  }
  return p;
}
