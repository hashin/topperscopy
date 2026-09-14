# Toppers Copy — project map

Free static site: a searchable directory of UPSC Mains topper answer copies. Live at
**https://topperscopy.hashin.me** (GitHub Pages, **Actions-based deploy** — `.github/workflows/deploy.yml`
runs `node build.js` fresh on every push to `main` and deploys the result; nothing generated is committed —
Cloudflare `CNAME topperscopy → hashin.github.io`, HTTPS enforced). No backend. Everything free.

Origin: a re-skin + extension of **upsckata.com "Topper Copies"** (credit it everywhere). That project's
`questions.csv` is our searchable GS/Essay core. We add optional subjects, per-topper AIR/marks,
link-only copies from other coaching sites, a submission workflow, dark mode, and a dataset backup.

## ⚡ Start here — the session protocol

This repo carries its own memory, because chat context does not survive a new session and this
project has twice been bitten by stale documentation (see `docs/MEMORY.md` for both cases).

**Before writing any code:**

1. Read **`docs/MEMORY.md`** — how the memory works, and the full protocol.
2. Read `docs/INTENT.md` (what Hashin has asked for) and `docs/DECISIONS.md` (why the code is like
   this, and what would reverse each choice). Both are short. Read them fully.
3. Read the last 2–3 entries of `docs/SESSIONS.md`.
4. Run `node build.js && npm run check`. Two seconds, and it tells you exactly which invariants
   hold right now. If something is already red before you touch anything, **say so**.

**Before finishing:** append to `docs/SESSIONS.md`; add any new want to `docs/INTENT.md`; add an ADR
to `docs/DECISIONS.md` for any non-obvious choice; promote any tracked invariant that now passes;
`npm run check` must pass.

**Never silently reverse a `DECISION-n`.** Supersede it properly, or leave it alone.

| Command | Does |
|---|---|
| `npm run check` | Every invariant, ~2 s, no browser. The honest status of the project. |
| `npm run check:all` | Adds the browser checks (CLS, the false-zero bug). |
| `npm run perf` | Full performance harness — sizes, vitals, cold-search latency. |
| `node build.js` | Regenerates everything. Precondition for both of the above. |

## Current work

- **`PERF-UX-AUDIT-2026-09-14.md`** — performance & UX audit, 22 items in 7 phases, each sized for
  one session. Start there for any speed/UI work; it carries measured baselines and a per-phase
  verification protocol. Harness in `tools/perf/`.
- `AUDIT-2026-09-09.md` — the earlier correctness audit (B1–B21). All items fixed; kept for history.
- `docs/` — intent, decisions, invariants, session log. The source of truth for *why*.

## ⚠️ Do not read these — they are large, generated, and gitignored

`data/copies.json` (~7.5 MB), `data/index.json`, `data/toppers.json`, `data/questions.csv` (~9 MB, source
mirror — tracked), `data/link-copies.json` (~1.6 MB, mostly VisionIAS — source, tracked), `data/qmeta.json` +
`data/qtext.json` (the deduped question index, split in two since audit Phase 3/T3 — see below),
`toppers.html`, `topper/*`, `question/*`, `paper/*`, `optional/*`, `sitemap*.xml`, `llms.txt`, `robots.txt`,
`dataset/*`. All produced by `build.js` — see `.gitignore`, which is why most of them **aren't in git at all**;
run `node build.js` locally to (re)create them from the source files below. Never open the generated ones to
"understand the project";
this file is the source of truth for their shape.

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
  **`i` (a copy's id) is a content hash of its URL, and `qid` is a content hash of paper+canonical-
  text — a hash of `data/qtext.json`'s key for that question, not the question text itself** (wire
  format 2; ids since Phase 4/I1, `DECISION-5`/`DECISION-11` — `stableId()` in `build.js`, with an
  explicit collision guard, retried deterministically on collision, fails the build loudly if it
  can't resolve). Ids are stable across builds: the same URL or the same canonical question text
  always hashes to the same id, so nothing downstream needs to reconcile two files that might
  disagree on what an id means (see AUDIT-2026-09-09 B1, which this removes the root cause of, not
  just a defence against). The same question answered by nine toppers used to be stored nine
  times — question text was ~71% of this file's bytes.
  **A qid is used only when the deduped entry's text faithfully *contains* this copy's own text.** The group
  keeps its longest member, which usually recovers a truncated scrape (1,406 rows now read more completely
  than before) — but `qKey()` only compares the first 110 normalised chars, so questions sharing a long
  preamble (the GS4 "three quotations of great thinkers" sets) group together with genuinely different
  wording, and a copy must never display another copy's question. Anything that is not a faithful superset
  gets a **negative id** into `data/qtext.json`'s `variants` (a hash of the variant text itself, negated —
  not push order, same reasoning as the main qid: a copy's own divergent wording must resolve correctly
  regardless of which build's `qtext.json` a visitor's browser happens to have cached), which
  preserves the exact wording without putting long GS4/Essay texts back into the file every visitor
  downloads on idle. Result: **every** row is an id, 0 inline strings, 92.2% byte-identical to the original
  + 7.8% more complete, **0 divergent**, and search returns the same copies it did before (verified against
  `dataset/questions.csv`, which still carries the original per-copy text). `app.js` also still accepts a
  literal string in that slot, so a stale format-1 file in a service worker cache keeps working.
  **Build order matters:** `writeQuestions()` runs *before* copies.json is written, because it produces the ids.
- `data/index.json` — boot payload: **only the text-searchable copies** (`!link`), minus `q`, plus `n`. Link-only copies are NOT here — they arrive with copies.json and app.js merges them into `DB.copies` + refreshes facets. Keeps boot ~26 KB gz regardless of link-only volume.
- `data/qmeta.json` + `data/qtext.json` — **deduped question index**, split in two by audit Phase 3/T3.
  `writeQuestions()` groups every searchable copy's `q` rows by `qKey()` (strip "Q.3)" numbering,
  lowercase, keep letters/digits incl. Devanagari, first 110 chars) + paper. Drops GS4 case-study
  sub-parts ("(a)…(b)…") and stray fragments. `qtext.json`'s `text` is an object **keyed by id**, not a
  position-indexed array (Phase 4/I1) — ids are now a sparse ~32-bit hash (up to ~4.29 billion), and an
  array indexed or sized by the raw id would try to allocate space up to that magnitude instead of the
  ~8k entries actually present. `assets/app.js` parses it into a `Map`, not a plain object — see below.
  - `data/qmeta.json` (~104 KB gz pre-I1; ids are bigger now, see the "Phase 4 landed" note in the
    audit) — `{generated, syllabus_version, count, byPaper, questions:[{i, p,
    m, w, s:[syllabus node ids], yr:[years], a:[[copyId, page], …]}]}`. No question text. This alone is
    enough to find/filter/count a question (syllabus filter, paper filter, Practice question-picking) —
    everything that doesn't need to be read.
  - `data/qtext.json` (question prose + the variant table) —
    `{text: {id: question text, …}, variants: {id: variant text, …}}`. Needed only to *render* or
    *text-match* a question, never to find one. `variants` lives here (not in qmeta.json) because it's
    also pure text used the same way (matched and displayed), so it belongs with the other prose, not the meta.
  Since format 2 (`copies.json`), `qtext.json` is also the **only** place question text lives, so it is
  required for full-text search and for showing questions on a copy card — not just for the question-first
  view. `qmeta.json` and `qtext.json` are fetched together (same trigger as the old single-file fetch) but
  resolved independently, so the ~104 KB meta file doesn't wait behind the ~1.4 MB text file. ~8.1k distinct,
  ~48% syllabus-mapped. Powers question-first view + Practice. Shard by paper post-OCR.
- `data/toppers.json` — `{toppers:{<name>:{air,year,coaching,papers,copies,marks,verified,sources,telegram?}}}`.
- `toppers.html`, `robots.txt`, `llms.txt`; fills `<!-- STATIC:START/END -->` and `<!-- LD:START/END -->` markers in `index.html` (noscript index + JSON-LD).
- **`writeTopperPages()` → `topper/<slug>/index.html`** — one static, crawlable, indexable page per topper
  (`Person` JSON-LD, their copies table + up to 8 sample questions). Returns `nameToSlug` (a `Map`), threaded
  into every other writer below so links between generated pages point at the right slug (handles same-name
  collisions via `dedupeSlug()` — e.g. two different "Aditya Srivastava"s become `aditya-srivastava` /
  `aditya-srivastava-2`).
- **`writeQuestionPages()` → `question/<slug>/index.html`** — one page per deduped question (the same dedupe
  `writeQuestions()` already computes), each listing every topper who answered it (rank-sorted), linking
  straight to the source PDF page. This is the actual SEO surface — the SPA and `toppers.html` are one URL
  each and invisible to search engines; these ~8k pages are what shows up for "<topic> UPSC Mains answer".
  `q.slug` holding this slug lives only on `writeQuestions()`'s in-memory list — **not** shipped in
  `qmeta.json`/`qtext.json` (audit T1 dropped it as dead weight: `app.js` never reads it, and the slug is
  already baked into the `question/` URL).
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
    `Map`s (not plain objects — see below) built from `data/qtext.json` (plus `QVAR`/`QVARLC`, also `Map`s,
    for the variant table, also in qtext.json since T3; `textOfId()` picks between them on the sign of the
    id) — `QTEXTLC` is the text lowercased **once at load**, so a keystroke no longer re-lowercases 5.5 MB
    of strings. `matchingQids()` scans those ~8.1k deduped strings once per query and returns `{q, v}` — a
    `Map` of `id -> 1` per question id and per variant id that matched; `filteredCopies()` tests raw rows
    against them (`qhit.q.get(v)` / `qhit.v.get(-v)`) and renders the resolved ones. Searching therefore
    needs `qtext.json`, so a text query fires both `ensureFull()` and `ensureQText()`.
    **Why `Map`, not a plain object (Phase 4/I1, `DECISION-11`):** ids are a sparse ~32-bit hash now,
    not `0..8101` — a plain object keyed by large sparse integers measured **~3.6× slower** to scan
    (`for...in` over ~8k entries) than the old position-indexed `Uint8Array`; a `Map` scanned with
    `.forEach()` measured within noise of the original (warmed, interleaved Node benchmark against the
    real corpus — never trust this kind of thing unmeasured, `DECISION-9`).
  - **Meta vs text (audit Phase 3/T3).** `QI`/`SYL` (question meta + syllabus tree) come from
    `loadQuestionIndex()` fetching `data/qmeta.json`; question *text* (`QTEXT`/`QTEXTLC`/`QVAR`/`QVARLC`)
    comes from `loadQuestionText()` fetching `data/qtext.json` — a separate promise (`qtPromise`/`qtState`),
    started alongside meta (`ensureQI()` always also calls `ensureQText()`) but resolved independently, so
    the much smaller qmeta.json doesn't wait behind the much larger qtext.json. Since Phase 4/I1, ids are
    content-derived and can't drift between the two files, so there is no reconciliation step — each is a
    plain `fetch()`, no build-mismatch retry (contrast T2's original design, which this phase removed).
    `qText(q)` resolves a `QI` row's text (`null` while qtext.json hasn't landed — every caller treats that
    as "not ready yet" and shows a loading state, never a false count, per `DECISION-6`).
  Browse default sort `year` = year-grouped, newest year first, best AIR first within a year (`yearOf`/`airOf`
  use toppers.json then the copy's own value). Search box matches topper names immediately + question text once
  loaded. Link-only copies render as "link only" cards. Theme toggle (`localStorage tc-theme`). GA custom events.
  - **Question-first view** (`#qview` toggle): `loadQuestionIndex()` lazy-fetches `qmeta.json`+`syllabus.json`
    (paper/syllabus filtering and counts work off this alone); `renderQuestions()` shows deduped questions
    once `qtext.json` has also landed → expand for the topper answer list (resolved via `COPYBYID`, built
    from `DB.copies`). `#syl` `<select>` (optgroups per paper) filters by syllabus node, populated from
    `qmeta.json` alone; picking one auto-switches to question view. `dispQ()` strips leading "Q.12" for display.
  - **Practice** (`#practice` `<dialog>`, opened by the `.practice-btn` in `.searchrow`): pick a paper (optionals
    disabled till OCR) → random question (prefers ≥3 answers) + its topper answers. Question *picking*
    (`nextPracticeQ()`) only needs `qmeta.json` (`q.a`/`q.p`/`q.s`); if `qtext.json` hasn't landed yet it
    still bumps the streak and picks a question, but shows "Loading question text…" and backfills that one
    DOM node in place via `PENDING_PRACTICE_TXT` once the text arrives, rather than blocking or re-picking.
    `localStorage tc-practice` = `{seen:{<paper>:[qids capped 600]}, s:{d:date, n:streakDays, t:totalAttempted}}`
    (Phase 4/I1 changed qids from small sequential ints to a hash — a visitor's existing `seen` list
    silently stops matching anything post-deploy, so Practice history effectively resets once; accepted,
    not worked around — see `DECISION-11`/`docs/SESSIONS.md`).
    `.practice-btn.nudge` dot shows until you practice that day.
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
  (plus the manifest + icons) is precached + stale-while-revalidate. The heavy files
  (`copies.json`/`qmeta.json`/`qtext.json`/`link-copies.json`, multi-hundred-KB to multi-MB) use
  cache-first-with-TTL instead (`HEAVY_TTL_MS`, 7 days since Phase 4/I1 — was 12h, sized around the old
  positional-id risk: stable ids mean a stale cache is merely missing recent content, never wrong) — a
  repeat visit serves them straight from cache with **no network request at all**, not just no re-render.
  No more `?b=` cache-buster query-string handling (Phase 4/I1 deleted it along with the buildId
  reconciliation it existed for). Bump `VERSION` on shell changes (or on `DATA_HEAVY`'s pattern).

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
299 unlabelled "Analytics/AIM" booklets stored as paper `Other`), Shankar IAS Parliament
(`shankariasparliament.com/upsc-toppers-list`, Sociology optional only so far — 11 toppers/2025, 35 PDFs;
SPA route, actual file server-redirects via an HTTP `Refresh` header off `/download-file/<id>`, resolved
with `fetch(url,{redirect:'manual'})` reading that header — **never navigate the tab straight to a
`download-file/<id>` or `uploads/downloads/*.pdf` URL, it triggers a real browser save-file prompt**).
All non-upsckata copies are **link-only** (scanned Drive/PDF, no question text yet).

## Open items

- **Questions-only OCR of all link-only copies** — user will trigger later (after compiling more
  optionals). Plan: Gemini 2.0 Flash on the top page-strip, ~$5 one-time, ~19k pages. Downloads
  automated by a resumable `ocr-pipeline/` script; output merges into `optionals.json` / `submissions.csv`.
- UnlockIAS deep year-archive (~+400 PDFs) not scraped — only featured toppers done.
- GS SCORE (`iasscore.in/toppers-copy`) is **login-gated** — no public URLs, can't add.
- theIAShub (`theiashub.com/toppers/upsc/2025`) is **login-gated, confirmed architecturally
  unusable even with an account** — 35 answer copies across 10 of the 38 listed UPSC-2025 toppers
  (GS I–IV/Essay labeled). Logged out, every file shows "Login to Download" with no PDF URL in the
  DOM or network. Logged in (2026-09-15, with Hashin's own account via the Claude-in-Chrome
  extension), the link (`/toppers/download_copy/<id>`) turned out to be a same-origin endpoint that
  **streams the file directly off theiashub.com's own server after an auth check** — not a redirect
  to a public CDN/S3 URL. There is no publicly-linkable URL to add at any point in this flow: a link
  to `download_copy/<id>` would hit the same login wall for every other site visitor, regardless of
  whose account fetched it. Same bucket as GS SCORE, for a slightly different mechanical reason
  (theirs never reveals a link at all; theIAShub reveals one, but it only resolves for an
  authenticated session). Decision: skip, don't re-host — see `docs/SESSIONS.md` 2026-09-15.
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
    - ~~Payoff for topperscopy alone is ~137 KB on first load~~ — **that number was wrong, corrected
      2026-09-14.** It counted only the *boot* payload. The payload that decides whether search feels
      instant is the search-gating one, and measured end-to-end against a real brotli origin the saving
      is **1,078 KB (2,220 KB → 1,142 KB, −49 %)** — 8× the old estimate. See
      `PERF-UX-AUDIT-2026-09-14.md` item **D2**, and `node tools/perf/compare-encodings.mjs`.
    - **Also wrong:** the choice is not only "move the nameservers". Netlify and Vercel both serve brotli
      on their free tiers and attach a custom domain via **a single CNAME added at Spaceship** — the zone
      stays put, every MX/SPF/apple-domain record is untouched, and the iCloud-mail risk is zero. Check
      their ~100 GB/month free-tier bandwidth caps against real traffic first.
    - Still true: GitHub Pages already serves this site from Fastly's Mumbai PoP (`x-served-by: cache-bom-*`),
      so the CDN-latency argument is largely moot for the audience. And still true that the *nameserver*
      migration is a whole-domain job to be done deliberately, never as a perf tweak.
    - **Do the data-format work first either way** (audit Phases 3–5): it is hosting-independent and cuts the
      search payload 1,994 KB → 751 KB on plain gzip. Brotli then multiplies it. Do not block on hosting.

## Conventions

- Match existing code style: vanilla ES5-ish in `app.js`, no frameworks, no bundler, no TypeScript.
- Keep it free and static. No paid services in the request path. Analyser/OCR libs load from CDN, lazily.
- Every "Open PDF/copy" link points to a third-party host — **nothing is re-hosted**. Keep credit to
  upsckata.com prominent (header, About, footer, JSON-LD, llms.txt).
