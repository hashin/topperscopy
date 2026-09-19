#!/usr/bin/env node
/* Refreshes the numbers baked into assets/og.jpg and quoted in README.md / index.html's
 * og:image:alt, without touching anything else — the hand-designed artwork, brand mark and
 * illustration in og.jpg stay byte-identical. Run by .github/workflows/update-hero.yml every
 * ~10 days; safe to run manually too (`node update-hero.mjs`).
 *
 * How the image patch works: og.jpg's background/illustration never changes, only the four
 * number spots do, so their pixel positions and background colours are fixed constants below
 * (measured once against the current artwork with a Python/PIL probe — see docs/SESSIONS.md
 * 2026-09-19 — not re-derived on every run). Replacement digits are rendered by an actual
 * browser (so the real Fraunces/Inter files are used, not a PIL font approximation), then
 * composited over the old text with `sharp`. If `og.jpg` is ever redesigned by hand, these
 * constants need re-measuring — this script does not know how to find them itself.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import sharp from 'sharp';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const floor = (n, step) => Math.floor(n / step) * step;
const fmt = n => Number(n || 0).toLocaleString('en-IN');

const copies = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/copies.json'), 'utf8'));
const { questions, copies: nCopies, toppers } = copies.stats.all;
let interviews = 0;
try { interviews = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/interview-list.json'), 'utf8')).total || 0; } catch {}

const N = { questions, copies: nCopies, toppers, interviews };
const R = {                                            // rounded, matching build.js's own convention
  questions: floor(questions, 500), copies: floor(nCopies, 500),
  toppers: floor(toppers, 100), interviews: floor(interviews, 100),
};
console.log(`stats: ${fmt(N.questions)} questions · ${fmt(N.copies)} copies · ${fmt(N.toppers)} toppers · ${fmt(N.interviews)} interviews`);
console.log(`rounded: ${fmt(R.questions)}+ / ${fmt(R.copies)}+ / ${fmt(R.toppers)}+ / ${fmt(R.interviews)}+`);

/* ---- 1. README.md ---- */
function patchReadme() {
  const file = path.join(ROOT, 'README.md');
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  s = s.replace(/Search \*\*[\d,]+\+ questions\*\* across \*\*[\d,]+\+ answer copies\*\* by \*\*[\d,]+\+? rank-holders\*\*/,
    `Search **${fmt(R.questions)}+ questions** across **${fmt(R.copies)}+ answer copies** by **${fmt(R.toppers)}+ rank-holders**`);
  s = s.replace(/\*\*[\d,]+\+ UPSC Personality Test transcripts\*\*/, `**${fmt(R.interviews)}+ UPSC Personality Test transcripts**`);
  fs.writeFileSync(file, s);
  console.log(before === s ? 'README.md: already current' : 'README.md: updated');
}

/* ---- 2. index.html's og:image:alt (outside build.js's own marker blocks — see CLAUDE.md) ---- */
function patchAlt() {
  const file = path.join(ROOT, 'index.html');
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  s = s.replace(
    /(<meta property="og:image:alt" content="Topper's Copy by Hashin: every UPSC Mains topper copy, one search box\. )[\d,]+( answer copies, )[\d,]+( questions, )[\d,]+( toppers — plus a Practice a question button\.">)/,
    `$1${fmt(N.copies)}$2${fmt(N.questions)}$3${fmt(N.toppers)}$4`
  );
  fs.writeFileSync(file, s);
  console.log(before === s ? 'index.html og:image:alt: already current' : 'index.html og:image:alt: updated');
}

/* ---- 3. assets/og.jpg — patch the four number spots in place ---- */
// [erase box (x0,y0,x1,y1), background fill colour] — measured once against the static artwork.
const ERASE = {
  copies:    { box: [60, 472, 165, 512], bg: [17, 28, 30] },
  questions: { box: [195, 472, 305, 512], bg: [17, 28, 30] },
  toppers:   { box: [334, 472, 420, 512], bg: [17, 28, 30] },
  sub:       { box: [60, 390, 545, 442], bg: [19, 30, 32] },
};
// where each rendered snippet's top-left lands once cropped to its own tight bbox
const PASTE = { copies: [67, 477], questions: [201, 477], toppers: [340, 477], sub: [67, 395] };
const FONTS = path.join(ROOT, 'assets/fonts');

async function patchOgImage() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family:'Fraunces'; src:url('file://${FONTS}/fraunces-latin.woff2') format('woff2'); font-weight:400 700; }
    @font-face { font-family:'Inter'; src:url('file://${FONTS}/inter-latin.woff2') format('woff2'); font-weight:400 700; }
    body{background:#111c1e;margin:0}
    .big{font-family:'Fraunces',serif;font-weight:600;font-size:32px;color:#F3EDE1;position:absolute;white-space:nowrap;letter-spacing:-0.3px}
    .sub{font-family:'Inter',sans-serif;font-weight:400;font-size:19px;line-height:1.5;color:#AAB5B7;position:absolute;top:350px;left:20px;width:480px}
  </style></head><body>
    <div class="big" style="top:20px;left:20px" id="copies">${fmt(N.copies)}</div>
    <div class="big" style="top:100px;left:20px" id="questions">${fmt(N.questions)}</div>
    <div class="big" style="top:180px;left:20px" id="toppers">${fmt(N.toppers)}</div>
    <div class="sub" id="sub">${fmt(R.questions)}+ questions, inside ${fmt(R.copies)}+ real topper answer copies &mdash; free, no login.</div>
  </body></html>`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-hero-'));
  const htmlPath = path.join(tmpDir, 'render.html');
  const pngPath = path.join(tmpDir, 'render.png');
  fs.writeFileSync(htmlPath, html);
  execFileSync('npx', ['--yes', 'playwright', 'screenshot', '--channel', 'chrome',
    '--viewport-size', '700,450', '--wait-for-timeout', '300', `file://${htmlPath}`, pngPath], { stdio: 'inherit' });

  const rendered = sharp(pngPath);
  const rawBuf = await rendered.raw().toBuffer({ resolveWithObject: true });
  const { data, info } = rawBuf;
  const bright = (x, y) => { const i = (y * info.width + x) * info.channels; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
  // tight bbox of "bright" (text) pixels inside a generous search window — same method as the
  // original manual probe (docs/SESSIONS.md 2026-09-19), just re-run fresh every time so it
  // tracks however wide this run's actual digits are.
  function tightBox(x0, y0, x1, y1, thresh = 80) {
    let minx = x1, miny = y1, maxx = x0, maxy = y0, found = false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (bright(x, y) > thresh) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); found = true; }
    }
    if (!found) throw new Error(`no text found in search window (${x0},${y0})-(${x1},${y1})`);
    return [minx, miny, maxx + 1, maxy + 1];
  }
  const boxes = {
    copies: tightBox(0, 0, 300, 90),
    questions: tightBox(0, 80, 300, 170),
    toppers: tightBox(0, 160, 300, 250),
    sub: tightBox(0, 340, 600, 420),
  };

  const composites = [];
  for (const key of ['copies', 'questions', 'toppers', 'sub']) {
    const [ex0, ey0, ex1, ey1] = ERASE[key].box;
    const [r, g, b] = ERASE[key].bg;
    composites.push({
      input: { create: { width: ex1 - ex0, height: ey1 - ey0, channels: 3, background: { r, g, b } } },
      left: ex0, top: ey0,
    });
    const [bx0, by0, bx1, by1] = boxes[key];
    const [px, py] = PASTE[key];
    const snippetWidth = bx1 - bx0, snippetHeight = by1 - by0;
    const eraseWidth = ex1 - ex0, eraseHeight = ey1 - ey0;
    if (px + snippetWidth > ex0 + eraseWidth + 5 || py + snippetHeight > ey0 + eraseHeight + 5) {
      console.warn(`WARNING: "${key}" replacement (${snippetWidth}x${snippetHeight}) may not fit its erase box (${eraseWidth}x${eraseHeight}) — the artwork may need a fresh look, not just a number swap.`);
    }
    composites.push({ input: await sharp(pngPath).extract({ left: bx0, top: by0, width: snippetWidth, height: snippetHeight }).toBuffer(), left: px, top: py });
  }

  const ogPath = path.join(ROOT, 'assets/og.jpg');
  await sharp(ogPath).composite(composites).jpeg({ quality: 90 }).toFile(ogPath + '.tmp');
  fs.renameSync(ogPath + '.tmp', ogPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('assets/og.jpg: patched');
}

patchReadme();
patchAlt();
await patchOgImage();
