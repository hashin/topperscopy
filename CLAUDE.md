# Toppers Copy — project map

Free static site: a searchable directory of UPSC Mains topper answer copies. Live at
**https://topperscopy.hashin.me** (GitHub Pages, **Actions-based deploy** — `.github/workflows/deploy.yml`
runs `node build.js` fresh on every push to `main` and deploys the result; nothing generated is committed —
Cloudflare `CNAME topperscopy → hashin.github.io`, HTTPS enforced). No backend. Everything free.

Origin: a re-skin + extension of **upsckata.com "Topper Copies"** (credit it everywhere). That project's
`questions.csv` is our searchable GS/Essay core. We add optional subjects, per-topper AIR/marks,
link-only copies from other coaching sites, a submission workflow, dark mode, and a dataset backup.

## ⚠️ Do not read these — they are large, generated, and gitignored

`data/copies.json` (~7.5 MB), `data/index.json`, `data/toppers.json`, `data/questions.csv` (~9 MB, source
mirror — tracked), `data/link-copies.json` (~1.6 MB, mostly VisionIAS — source, tracked), `data/questions.json`
(deduped index), `toppers.html`, `topper/*`, `question/*`, `paper/*`, `optional/*`, `sitemap*.xml`, `llms.txt`,
`robots.txt`, `dataset/*`. All produced by `build.js` — see `.gitignore`, which is why most of them **aren't in
git at all**; run `node build.js` locally to (re)create them from the source files below. Never open the
generated ones to "understand the project"; this file is the source of truth for their shape.

## Source-of-truth files (the only things you edit for data)

| File | What | Shape |
|---|---|---|
| `data/questions.csv` | mirror of upsckata.com — treat as append-mostly; **one sanctioned hand-edit: correcting a wrong `subject`** (a whole coaching copy scraped under the wrong GS paper). Never rewrite question text or reflow rows — keep it diff-clean. CRLF line endings; subject is the bare 3rd field | `topper,coaching,subject,page_number,question,metadata,url` (subject = GS1..GS4/Essay) |
| `data/submissions.csv` | accepted GS/Essay copies **with** extracted question text | same 7 cols |
| `data/link-copies.json` | GS/Essay copies that are **only a link** (scanned, no text) | `{entries:[{topper,paper,url,air?,year?,source?,by?,note?,verified}]}` — `paper` = GS1..GS4/Essay |
| `data/optionals.json` | optional-subject copies | `{entries:[{topper,subject,url,air?,year?,marks?,source?,by?,note?,verified,questions?}]}` — `questions` = `[{page,question,marks,words}]` when known |
| `data/toppers.overrides.json` | maintainer AIR/year/marks corrections | `{"<name>":{air,year,verified,marks:{},sources:[]}}` — keys starting `_` ignored |
| `data/syllabus.json` | **hand-authored** official UPSC syllabus, GS1–4 + Essay, 2 levels. `nodes[].kw` = lowercase phrases; build.js scores each question against its own paper's nodes | `{version, papers:{GS1:{name, nodes:[{id, t, kw:[]}]}, …}}` |
| `data/syllabus-overrides.json` | *(optional)* pin a question to node(s); key = build.js `qKey()` of the text | `{"<qKey>": ["gs2.federalism", …]}` |
| `data/questions.exclude.json` | *(optional)* maintainer denylist for junk "question" rows from the `questions.csv` mirror (upstream scraped an answer heading as a question). Drop by source URL or `qKey()` | `{urls:[…incl #page=N], keys:[…qKey()]}` — `_`-prefixed ignored |

**Dedupe rule:** by PDF URL (`.split('#')[0]`, strip `?…`). Same topper may have entries from multiple sources.

**Topper-name canonicalisation:** the source files spell one person many ways (`ADITYA SRIVASTAVA` /
`Aditya Srivastava`, `Muskan_Srivastava` from a PDF file name). Before grouping, `build.js` collapses
case- and punctuation-variants (`nameKey()` = lowercase, non-alphanumerics → space — same collapse `slug()`
does) onto one display spelling: the best-cased variant, then the most common. So you don't need to fix
casing in the source files; a genuinely new spelling just needs to differ by more than case/punctuation.

**Answer-fragment filter:** upsckata.com sometimes scrapes a heading the topper wrote *inside* an answer
(off the continuation page) as its own question — no marks, no word limit, no "15." number. `build.js`
`isAnswerFragment()` drops the clear cases (short, or opening with a mid-answer discourse marker like
"So,"/"Now"/"Why still"); anything it misses goes in `data/questions.exclude.json`.

## build.js  (`node build.js`, zero runtime deps)

Reads the 5 source files → writes:
- `data/copies.json` — `{generated, attribution, format:2, stats, copies:[{i,t,c,p,y,r,u,q:[[page,qid,marks,words]],prov,link?,note?}]}`. **Every** copy (searchable GS/Essay + link-only). App lazy-loads it on idle/search/expand.
  **`qid` is an index into `questions.json`, not the question text** (wire format 2). The same question
  answered by nine toppers used to be stored nine times — question text was ~71% of this file's bytes.
  **A qid is used only when the deduped entry's text faithfully *contains* this copy's own text.** The group
  keeps its longest member, which usually recovers a truncated scrape (1,406 rows now read more completely
  than before) — but `qKey()` only compares the first 110 normalised chars, so questions sharing a long
  preamble (the GS4 "three quotations of great thinkers" sets) group together with genuinely different
  wording, and a copy must never display another copy's question. Anything that is not a faithful superset
  gets a **negative id** into `questions.json`'s `variants[]` (1-based, negated: `-1` = `variants[0]`), which
  preserves the exact wording without putting long GS4/Essay texts back into the file every visitor
  downloads on idle. Result: **every** row is an id, 0 inline strings, 92.2% byte-identical to the original
  + 7.8% more complete, **0 divergent**, and search returns the same copies it did before (verified against
  `dataset/questions.csv`, which still carries the original per-copy text). `app.js` also still accepts a
  literal string in that slot, so a stale format-1 file in a service worker cache keeps working.
  Net: 2,352 KB → 292 KB gzipped (179 KB brotli).
  **Build order matters:** `writeQuestions()` runs *before* copies.json is written, because it produces the ids.
- `data/index.json` — boot payload: **only the text-searchable copies** (`!link`), minus `q`, plus `n`. Link-only copies are NOT here — they arrive with copies.json and app.js merges them into `DB.copies` + refreshes facets. Keeps boot ~26 KB gz regardless of link-only volume.
- `data/questions.json` — **deduped question index** (lazy, ~1.4 MB gz). Since format 2 this is also the
  **only** place question text lives, so it is required for full-text search and for showing questions on a
  copy card — not just for the question-first view. Carries `variants[]` (see above) alongside `questions[]`.
  It is deliberately the file that absorbed the variant text: it loads only on real search intent or a card
  expand, whereas `copies.json` is fetched on idle by everyone. `writeQuestions()` groups every
  searchable copy's `q` rows by `qKey()` (strip "Q.3)" numbering, lowercase, keep letters/digits incl. Devanagari,
  first 110 chars) + paper. Drops GS4 case-study sub-parts ("(a)…(b)…") and stray fragments. Each entry:
  `{i, p, q(text), m, w, s:[syllabus node ids], yr:[years], a:[[copyId, page], …]}`. ~7.3k distinct, ~48% syllabus-mapped.
  Powers question-first view + Practice. Shard by paper post-OCR.
- `data/toppers.json` — `{toppers:{<name>:{air,year,coaching,papers,copies,marks,verified,sources,telegram?}}}`.
- `toppers.html`, `robots.txt`, `llms.txt`; fills `<!-- STATIC:START/END -->` and `<!-- LD:START/END -->` markers in `index.html` (noscript index + JSON-LD).
- **`writeTopperPages()` → `topper/<slug>/index.html`** — one static, crawlable, indexable page per topper
  (`Person` JSON-LD, their copies table + up to 8 sample questions). Returns `nameToSlug` (a `Map`), threaded
  into every other writer below so links between generated pages point at the right slug (handles same-name
  collisions via `dedupeSlug()` — e.g. two different "Aditya Srivastava"s become `aditya-srivastava` /
  `aditya-srivastava-2`).
- **`writeQuestionPages()` → `question/<slug>/index.html`** — one page per deduped question (the same dedupe
  `questions.json` already computes), each listing every topper who answered it (rank-sorted), linking straight
  to the source PDF page. This is the actual SEO surface — the SPA and `toppers.html` are one URL each and
  invisible to search engines; these ~8k pages are what shows up for "<topic> UPSC Mains answer". `q.sl` in
  `questions.json` is this slug.
  **The question text is the `<h1>`** (the paper label is a `.kicker` eyebrow above it) —
  it is the unique, high-value string on the page and the one people actually search for. Pages with a
  **single answer get `noindex,follow`** and are left out of `sitemap-questions.xml`: they are ~2/3 of all
  question pages and too thin to earn an index slot, but they keep every link, and the next build promotes
  one automatically the moment a second topper's copy lands. `writeQuestionPages()` returns that set of
  indexable slugs and `writeSitemaps()` filters on it. JSON-LD stays `WebPage` + `ItemList` (+ a
  `BreadcrumbList`) — deliberately **not** `QAPage`, which requires answer *text* on the page, and every
  answer here is a link to someone else's PDF.
- **`writeHubPages()` → `paper/<gs1|gs2|gs3|gs4|essay|other>/index.html`** and **`optional/<subject-slug>/index.html`**
  — topic hub pages (top ~300 most-answered questions + full topper list per paper/subject).
- **`writeSitemaps()`** — `sitemap.xml` is a `<sitemapindex>` referencing `sitemap-main.xml` (home + toppers.html),
  `sitemap-toppers.xml`, `sitemap-questions.xml`, `sitemap-hubs.xml` (paper + optional). URLs are read straight
  off the `topper/` / `question/` / `paper/` / `optional/` directories after they're written.
- `dataset/` — consolidated CC-BY-4.0 backup: `questions.csv` (flat, all copies, `provenance` col), `copies.csv`, `toppers.csv`, `dataset.json` (nested), `manifest.json` (sha256s), `README.md`.

**`stats`** = GS/Essay searchable index only (used by JSON-LD, llms.txt). **`stats.all`** = grand total
incl. link-only + optionals (`{questions,copies,toppers,subjects,linkOnly}`) — the homepage headline.

**None of the above is committed to git** (see `.gitignore`) — it's all rebuilt fresh by
`.github/workflows/deploy.yml` on every push to `main` and deployed straight from there. Run `node build.js`
locally whenever you need these files to inspect or test against.

## The app (static, vanilla, no build step for the browser)

- `index.html` — SPA shell. Tabs: browse / optionals / submit / about. Inline no-FOUC theme script.
  GA4 `G-VTL4V9JQBH` (mirrored as `GA_ID` in app.js). Self-hosted fonts. `<script src=assets/extract.js defer>` then `app.js defer`.
- `assets/app.js` — the whole SPA (IIFE, no deps). Loads `index.json` → renders the searchable core;
  `loadFull()` lazy-fetches `copies.json` on idle / search-focus / card-expand (Save-Data: deferred, not
  skipped) → attaches `q`, **adds the link-only copies** into `DB.copies`, calls `refreshFacets()`, re-renders.
  - **Question text resolution (format 2).** `rawQ(c)` = the stored rows (`qid` or literal text); `qOf(c)` =
    the same rows with ids resolved through `QTEXT`, cached on `c.qr`, and `null` while the table is still
    loading (every caller already treats null as "not loaded" and re-renders after). `QTEXT`/`QTEXTLC` are
    built from `questions.json` (plus `QVAR`/`QVARLC` for the variant table; `textOfId()` picks between them
    on the sign of the id) — `QTEXTLC` is the text lowercased **once at load**, so a keystroke no
    longer re-lowercases 5.5 MB of strings. `matchingQids()` scans those ~8.1k deduped strings once per
    query and returns `{q, v}` — a `Uint8Array` flag per question id and per variant id; `filteredCopies()` tests raw rows against them
    and renders the resolved ones. Searching therefore needs `questions.json`, so a text query fires both
    `ensureFull()` and `ensureQI()` (and focusing the search box warms both).
  Browse default sort `year` = year-grouped, newest year first, best AIR first within a year (`yearOf`/`airOf`
  use toppers.json then the copy's own value). Search box matches topper names immediately + question text once
  loaded. Link-only copies render as "link only" cards. Theme toggle (`localStorage tc-theme`). GA custom events.
  - **Question-first view** (`#qview` toggle): `loadQuestionIndex()` lazy-fetches `questions.json`+`syllabus.json`;
    `renderQuestions()` shows deduped questions → expand for the topper answer list (resolved via `COPYBYID`,
    built from `DB.copies`). `#syl` `<select>` (optgroups per paper) filters by syllabus node; picking one
    auto-switches to question view. `dispQ()` strips leading "Q.12" for display.
  - **Practice** (`#practice` `<dialog>`, opened by the `.practice-btn` in `.searchrow`): pick a paper (optionals
    disabled till OCR) → random question (prefers ≥3 answers) + its topper answers. `localStorage tc-practice` =
    `{seen:{<paper>:[qids capped 600]}, s:{d:date, n:streakDays, t:totalAttempted}}`. `.practice-btn.nudge` dot
    shows until you practice that day.
- `assets/style.css` — design system. Palette from 6 user swatches on warm paper; Fraunces + Inter.
  Light/dark via 3-state pattern (`:root` / `@media prefers-color-scheme` / `:root[data-theme=dark]`).
  Phones ≤680px drop `backdrop-filter`, 16px inputs.
- `assets/extract.js` — shared zero-dep question heuristic. `extractQuestions(pages)`, `toCsvRows()`. UMD (browser + node).
- `assets/analyse.js` — lazy-loaded (Submit tab only). pdf.js from CDN for text-layer PDFs; Tesseract.js
  from CDN for OCR of scans (renders each page, crops top ~42%, per-page 30s timeout). Never bundled — zero cost unless used.
- `manifest.webmanifest` + `favicon.ico` + `assets/icon.svg` / `icon-32|180|192|512.png` — hand-generated
  (warm-paper "T" on the brand teal), committed **source** files, not build output. They make the site
  installable — the service worker was already there, only the manifest was missing.
- `assets/fonts/` — Inter + Fraunces, latin-subset woff2 (Fraunces is `font-display:optional`, not preloaded —
  headings only, never blocks or reflows). `assets/og.jpg` — social image, ~106 KB.
- `sw.js` — service worker. Shell (`index.html`, CSS/JS, Inter, `index.json`/`toppers.json`/`optionals.json`)
  (plus the manifest + icons) is precached + stale-while-revalidate. The 3 heavy files (`copies.json`/`questions.json`/`link-copies.json`,
  multi-MB) use cache-first-with-TTL instead (`HEAVY_TTL_MS`, 12h) — a repeat visit serves them straight from
  cache with **no network request at all**, not just no re-render. Bump `VERSION` on shell changes.

## extract.js (repo root) — maintainer CLI

`npm install` once (pulls `pdfjs-dist`, dev-only, **not used in CI**), then:
```
node extract.js <url|file.pdf> --topper "Name" --paper GS1 [--coaching X] [--air N] [--year Y] [--append|--json]
```
`--append` → `data/submissions.csv`.  `--json` → an `optionals.json` entry with embedded `questions[]`.
Text-layer only (no OCR). Then `node build.js`.

## Deploy

`.github/workflows/deploy.yml` — the only thing that ships the site. On every push to `main`: checkout →
`node build.js` (zero deps, no `npm install` needed) → stage the servable subset into `_site/` (excludes
`.git`, `.github`, `node_modules`, `.ocr`, the maintainer-CLI scripts, docs) → `actions/upload-pages-artifact`
→ `actions/deploy-pages`. GitHub Pages source is set to **build_type: workflow** (not the legacy
branch-serves-root mode) — `gh api repos/hashin/topperscopy/pages` should show that. Nothing writes back to
git, so there's no `[skip ci]` dance and no risk of a commit-triggered rebuild loop.

## Moderation

`.github/workflows/moderate.yml`: a repo **collaborator** (triage+) adds the `approved` label to a
submission issue → `.github/scripts/apply-submission.mjs` parses the issue body (markdown table +
fenced ```csv / ```json) → writes to `optionals.json` / `submissions.csv` / `toppers.overrides.json` →
`node build.js` (validation — fails the job if the data doesn't build) → commits **only the source-file
diff** (generated files are gitignored, so `git add -A` can't pick them up) → pushes (which triggers
`deploy.yml`) → comments + closes. Appoint a moderator = add a collaborator (see `MODERATORS.md`).
`ocr.yml` / `ocr-gemini.yml` follow the same pattern: `node build.js` to validate, then commit only
`data/ocr-questions.csv` (+ `data/optionals.json` for the Gemini pass).

## Workflow for any data change

1. Edit a source file (see table above) — respect the dedupe rule.
2. `node build.js` locally, to check it builds clean and to eyeball the output.
3. Commit the source file(s) only — the generated files are gitignored and won't be staged.
4. Push. `deploy.yml` rebuilds + redeploys in ~1–2 min. Verify at the live URL.

## Data sources ingested so far

upsckata.com (GS/Essay searchable core — 1,063 copies / 16,947 questions), Level Up IAS
(Anthropology/Sociology/PSIR/History optionals), Vishnu IAS (Nidhi Pai), UnlockIAS (GS/Essay + a few
optionals, ~69 featured toppers), Sleepy Classes (GS/Essay + Sociology/PSIR), Vajiram & Ravi (181
GS/Essay + IFS), LotusArise (Geography), De Facto Law (Law), IMS4Maths + SuccessClap (Mathematics),
VisionIAS (all 305 optionals incl. Philosophy/Psychology/Pub-Ad + all 3,720 GS/Essay 2013–25; direct
`cdn.visionias.in` PDFs — re-fetchable via `POST /student/module/ajax/resources.php?f=resources_data`
body `type=toppers_answers` while logged in, `d.result` = 4k rows),
NextIAS (`nextias.com/toppers-answers-ias`, 2,020 GS/Essay + 138 optionals incl. new **Economics** bucket,
255 toppers 2023–25; public S3/CDN PDFs, `<article>` per topper, year `<select id=yearSelect>`=all/2025/24/23;
299 unlabelled "Analytics/AIM" booklets stored as paper `Other`). All non-upsckata copies
are **link-only** (scanned Drive/PDF, no question text yet).

## Open items

- **Questions-only OCR of all link-only copies** — user will trigger later (after compiling more
  optionals). Plan: Gemini 2.0 Flash on the top page-strip, ~$5 one-time, ~19k pages. Downloads
  automated by a resumable `ocr-pipeline/` script; output merges into `optionals.json` / `submissions.csv`.
- UnlockIAS deep year-archive (~+400 PDFs) not scraped — only featured toppers done.
- GS SCORE (`iasscore.in/toppers-copy`) is **login-gated** — no public URLs, can't add.
- ~~`.git` history is ~280 MB~~ — **stale, resolved.** `git count-objects -vH` reports **16.7 MiB** in a
  single pack, 0 loose objects, 0 garbage. Gitignoring the generated files + Actions-based deploy already
  fixed it. There is **no history rewrite to consider** — do not run `git filter-repo` here.
- ~~Cloudflare record is grey-cloud~~ — **wrong, corrected 2026-09-08.** `hashin.me` is **not on Cloudflare
  at all**: `dig NS hashin.me` returns `launch1/launch2.spaceship.net`, i.e. DNS is served by Spaceship, the
  registrar. There is no zone to orange-cloud. Getting brotli / HTTP/3 / cache rules means **moving the
  domain's nameservers to Cloudflare**, which is a whole-domain migration, not a per-site toggle:
    - 6 subdomains (`www`, `blog`, `action`, `upscnotes`, `topperscopy`, `plato`) all CNAME to
      `hashin.github.io` — trivial, Cloudflare auto-imports these.
    - **Email is the real risk.** `hashin.me` runs iCloud custom-domain mail: `MX 10 mx01/mx02.mail.icloud.com`,
      `TXT "v=spf1 include:icloud.com ~all"`, `TXT "apple-domain=oDdYk7mJzXwDmyDz"`. If those don't carry over
      exactly, mail breaks silently.
    - Payoff for topperscopy alone is ~137 KB on first load (427 KB → ~290 KB) plus HTTP/3. Judged **not worth
      the risk on its own** — but it would benefit all 5 sites at once, so do it as a deliberate domain
      migration if ever, never as a perf tweak. Note GitHub Pages already serves this site from Fastly's
      Mumbai PoP (`x-served-by: cache-bom-*`), so the CDN-latency argument is largely moot for the audience.

## Conventions

- Match existing code style: vanilla ES5-ish in `app.js`, no frameworks, no bundler, no TypeScript.
- Keep it free and static. No paid services in the request path. Analyser/OCR libs load from CDN, lazily.
- Every "Open PDF/copy" link points to a third-party host — **nothing is re-hosted**. Keep credit to
  upsckata.com prominent (header, About, footer, JSON-LD, llms.txt).
