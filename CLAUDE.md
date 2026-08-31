# Toppers Copy — project map

Free static site: a searchable directory of UPSC Mains topper answer copies. Live at
**https://topperscopy.hashin.me** (GitHub Pages, `main` branch root, Cloudflare `CNAME topperscopy → hashin.github.io`, HTTPS enforced). No backend. Everything free.

Origin: a re-skin + extension of **upsckata.com "Topper Copies"** (credit it everywhere). That project's
`questions.csv` is our searchable GS/Essay core. We add optional subjects, per-topper AIR/marks,
link-only copies from other coaching sites, a submission workflow, dark mode, and a dataset backup.

## ⚠️ Do not read these — they are large and generated

`data/copies.json` (~7.5 MB), `data/index.json`, `data/toppers.json`, `data/questions.csv` (~9 MB),
`data/link-copies.json` (~1.6 MB, mostly VisionIAS), `toppers.html`, `dataset/*`. All produced/managed by
`build.js` or bulk scripts. `link-copies.json` / `optionals.json` are hand-editable in principle but huge —
edit via a script. Never open the generated ones to "understand the project"; this file is their shape. Never
open them to "understand the project" — this file is the source of truth for their shape.

## Source-of-truth files (the only things you edit for data)

| File | What | Shape |
|---|---|---|
| `data/questions.csv` | pristine mirror of upsckata.com — **never hand-edit**, keep re-syncable | `topper,coaching,subject,page_number,question,metadata,url` (subject = GS1..GS4/Essay) |
| `data/submissions.csv` | accepted GS/Essay copies **with** extracted question text | same 7 cols |
| `data/link-copies.json` | GS/Essay copies that are **only a link** (scanned, no text) | `{entries:[{topper,paper,url,air?,year?,source?,by?,note?,verified}]}` — `paper` = GS1..GS4/Essay |
| `data/optionals.json` | optional-subject copies | `{entries:[{topper,subject,url,air?,year?,marks?,source?,by?,note?,verified,questions?}]}` — `questions` = `[{page,question,marks,words}]` when known |
| `data/toppers.overrides.json` | maintainer AIR/year/marks corrections | `{"<name>":{air,year,verified,marks:{},sources:[]}}` — keys starting `_` ignored |

**Dedupe rule:** by PDF URL (`.split('#')[0]`, strip `?…`). Same topper may have entries from multiple sources.

## build.js  (`node build.js`, zero runtime deps)

Reads the 5 source files → writes:
- `data/copies.json` — `{generated, attribution, stats, copies:[{i,t,c,p,y,r,u,q:[[page,question,marks,words]],prov,link?,note?}]}`. **Every** copy (searchable GS/Essay + link-only). App lazy-loads it on idle/search/expand.
- `data/index.json` — boot payload: **only the text-searchable copies** (`!link`), minus `q`, plus `n`. Link-only copies are NOT here — they arrive with copies.json and app.js merges them into `DB.copies` + refreshes facets. Keeps boot ~26 KB gz regardless of link-only volume.
- `data/toppers.json` — `{toppers:{<name>:{air,year,coaching,papers,copies,marks,verified,sources}}}`.
- `toppers.html`, `sitemap.xml`, `robots.txt`, `llms.txt`; fills `<!-- STATIC:START/END -->` and `<!-- LD:START/END -->` markers in `index.html` (noscript index + JSON-LD).
- `dataset/` — consolidated CC-BY-4.0 backup: `questions.csv` (flat, all copies, `provenance` col), `copies.csv`, `toppers.csv`, `dataset.json` (nested), `manifest.json` (sha256s), `README.md`.

**`stats`** = GS/Essay searchable index only (used by JSON-LD, llms.txt). **`stats.all`** = grand total
incl. link-only + optionals (`{questions,copies,toppers,subjects,linkOnly}`) — the homepage headline.

## The app (static, vanilla, no build step for the browser)

- `index.html` — SPA shell. Tabs: browse / optionals / submit / about. Inline no-FOUC theme script.
  GA4 `G-VTL4V9JQBH` (mirrored as `GA_ID` in app.js). Self-hosted fonts. `<script src=assets/extract.js defer>` then `app.js defer`.
- `assets/app.js` — the whole SPA (IIFE, no deps). Loads `index.json` → renders the searchable core;
  `loadFull()` lazy-fetches `copies.json` on idle / search-focus / card-expand (Save-Data: deferred, not
  skipped) → attaches `q`, **adds the link-only copies** into `DB.copies`, calls `refreshFacets()`, re-renders.
  Browse default sort `year` = year-grouped, newest year first, best AIR first within a year (`yearOf`/`airOf`
  use toppers.json then the copy's own value). Search box matches topper names immediately + question text once
  loaded. Link-only copies render as "link only" cards. Theme toggle (`localStorage tc-theme`). GA custom events.
- `assets/style.css` — design system. Palette from 6 user swatches on warm paper; Fraunces + Inter.
  Light/dark via 3-state pattern (`:root` / `@media prefers-color-scheme` / `:root[data-theme=dark]`).
  Phones ≤680px drop `backdrop-filter`, 16px inputs.
- `assets/extract.js` — shared zero-dep question heuristic. `extractQuestions(pages)`, `toCsvRows()`. UMD (browser + node).
- `assets/analyse.js` — lazy-loaded (Submit tab only). pdf.js from CDN for text-layer PDFs; Tesseract.js
  from CDN for OCR of scans (renders each page, crops top ~42%, per-page 30s timeout). Never bundled — zero cost unless used.
- `assets/fonts/` — Inter + Fraunces, latin-subset woff2. `assets/og.jpg` — social image.
- `sw.js` — service worker, precache shell + fonts + `index.json` (bump `VERSION` on shell changes).

## extract.js (repo root) — maintainer CLI

`npm install` once (pulls `pdfjs-dist`, dev-only, **not used in CI**), then:
```
node extract.js <url|file.pdf> --topper "Name" --paper GS1 [--coaching X] [--air N] [--year Y] [--append|--json]
```
`--append` → `data/submissions.csv`.  `--json` → an `optionals.json` entry with embedded `questions[]`.
Text-layer only (no OCR). Then `node build.js`.

## Moderation

`.github/workflows/moderate.yml`: a repo **collaborator** (triage+) adds the `approved` label to a
submission issue → `.github/scripts/apply-submission.mjs` parses the issue body (markdown table +
fenced ```csv / ```json) → writes to `optionals.json` / `submissions.csv` / `toppers.overrides.json` →
`node build.js` → commits `[skip ci]` → comments + closes. Appoint a moderator = add a collaborator
(see `MODERATORS.md`). `.github/workflows/build.yml` auto-rebuilds on any push to the 5 source files.

## Workflow for any data change

1. Edit a source file (see table above) — respect the dedupe rule.
2. `node build.js`
3. Commit **with `[skip ci]`** (generated files change too; `[skip ci]` stops a redundant Action run).
4. Push. Pages redeploys in ~1 min. Verify at the live URL.

## Data sources ingested so far

upsckata.com (GS/Essay searchable core — 1,063 copies / 16,947 questions), Level Up IAS
(Anthropology/Sociology/PSIR/History optionals), Vishnu IAS (Nidhi Pai), UnlockIAS (GS/Essay + a few
optionals, ~69 featured toppers), Sleepy Classes (GS/Essay + Sociology/PSIR), Vajiram & Ravi (181
GS/Essay + IFS), LotusArise (Geography), De Facto Law (Law), IMS4Maths + SuccessClap (Mathematics),
VisionIAS (all 305 optionals incl. Philosophy/Psychology/Pub-Ad + all 3,720 GS/Essay 2013–25; direct
`cdn.visionias.in` PDFs — re-fetchable via `POST /student/module/ajax/resources.php?f=resources_data`
body `type=toppers_answers` while logged in, `d.result` = 4k rows). All non-upsckata copies
are **link-only** (scanned Drive/PDF, no question text yet).

## Open items

- **Questions-only OCR of all link-only copies** — user will trigger later (after compiling more
  optionals). Plan: Gemini 2.0 Flash on the top page-strip, ~$5 one-time, ~19k pages. Downloads
  automated by a resumable `ocr-pipeline/` script; output merges into `optionals.json` / `submissions.csv`.
- UnlockIAS deep year-archive (~+400 PDFs) not scraped — only featured toppers done.
- GS SCORE (`iasscore.in/toppers-copy`) is **login-gated** — no public URLs, can't add.
- Repo could be slimmed further by moving `build.js` into a Pages **deploy Action** and gitignoring all
  generated artifacts (`data/*.json`, `toppers.html`, `dataset/`). Not done — would need the Pages
  source switched to "GitHub Actions" and careful testing so the live site can't break.

## Conventions

- Match existing code style: vanilla ES5-ish in `app.js`, no frameworks, no bundler, no TypeScript.
- Keep it free and static. No paid services in the request path. Analyser/OCR libs load from CDN, lazily.
- Every "Open PDF/copy" link points to a third-party host — **nothing is re-hosted**. Keep credit to
  upsckata.com prominent (header, About, footer, JSON-LD, llms.txt).
