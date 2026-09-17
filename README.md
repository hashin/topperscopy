# Topper's Copy by Hashin

A free, static, community-maintained directory of **UPSC Civil Services Mains topper answer copies** — GS1–4, Essay, and optional subjects. Search **28,000+ questions** across **9,100+ answer copies** by **1,700 rank-holders**, and open the exact page of each copy.

Live: **https://topperscopy.hashin.me**

## Credit

The question-level database — which topper answered which question, on which page of which PDF —
comes from **[upsckata.com — "Topper Copies"](https://toppercopies.upsckata.com/)**. This repo is an
independent, non-commercial mirror. It adds:

- an **Optionals** section (Sociology, Anthropology, History, PSIR, Geography, …), which the source
  database doesn't cover — compiled from institute pages and community submissions, and searchable
  from the same box;
- **per-topper tags** — AIR, exam year, subject-wise marks — auto-seeded from source PDF file names
  and topped up by submissions;
- an **Interviews** section — 3,800+ UPSC Personality Test transcripts (board, candidate, questions
  asked by each panel member, DAF topics, hobbies, education) — a separate mirror of upsckata's own
  interview-transcript archive;
- a **Submit** workflow so students can add missing copies and correct topper data.

No answer copy is hosted here. Every "Open PDF" link points to the file on the site that published it
(ForumIAS, Vision IAS, NextIAS, Lukmaan IAS, GS SCORE, Rau's IAS, …).

## How it's built

Pure static — no runtime backend, no build step for the browser, zero dependencies for the build.

```
data/questions.csv          mirror of upsckata.com's questions.csv — only sanctioned hand-edit: fixing a wrong `subject`
data/submissions.csv        accepted GS/Essay copy submissions (same 7-col schema)
data/ocr-questions.csv      questions read off scanned copies by ocr-pipeline.mjs
data/link-copies.json       GS/Essay copies that are only a link
data/optionals.json         optional-subject copies (some with OCR'd questions)
data/toppers.overrides.json maintainer-verified AIR / marks corrections
data/interviews.json        mirror of upsckata's Personality Test interview transcripts
        |
  build.js
        |
        +->  data/copies.json                 every copy, grouped by topper — the only file the app boots from
        +->  data/questions-<paper>.json      one shard per paper: deduped question text + [url, page] refs
        +->  data/interview-list.json         every interview's metadata — the Interviews tab's boot file
        +->  data/interview-text-<year>.json  one shard per year: {id: transcript text}, fetched per interview
        +->  topper/, question/, paper/, optional/, toppers*.html, sitemap*.xml, llms.txt, robots.txt
        +->  index.html  (<noscript> + JSON-LD between markers)
        +->  dataset/    (complete consolidated backup — see dataset/README.md — not loaded by the site)

index.html, assets/, sw.js  the app (progressive enhancement over toppers.html)
```

The copy's PDF URL is its key everywhere; there are no ids. A question shard is `{ urls: [...],
questions: [[text, [[urlIndex, page], …], [syllabus node ids], marks, words], …], fragments: [...] }`.

Regenerate everything after changing a source file:

```bash
node build.js
npm run check
```

`.github/workflows/deploy.yml` does the build on every push to `main` and deploys the result;
nothing generated is committed.

## Project memory — start here if you are picking this up cold

The repo carries its own context so a new session does not have to re-derive it:

| File | Answers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The project map — what every file does. |
| [`docs/MEMORY.md`](docs/MEMORY.md) | **Read first.** How the memory system works and the session protocol. |
| [`docs/INTENT.md`](docs/INTENT.md) | What this is for, and what has actually been asked for. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why the code is like this — including what was rejected and what would reverse it. |
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | What must never break, and the check that proves each one. |
| [`docs/SESSIONS.md`](docs/SESSIONS.md) | What each session did and learned. |
| [`docs/archive/`](docs/archive/) | The 2026-09 audits that shaped the code up to DECISION-17 — history, not architecture. |

```bash
node build.js        # the checks measure real output, so build first
npm run check        # ~2s, plain Node: every invariant and gzip budget, each citing the intent it protects
```

`npm run check` is the honest status of the project at any moment. Every check fails the run; the
gzip budgets live in a table at the top of `tools/check.mjs`.

## SEO & AI readability

- Rich `<head>`: canonical, Open Graph + Twitter cards, `theme-color`, `<link rel=alternate>` to the JSON.
- JSON-LD `@graph` on the home page — `WebSite` (+ SearchAction), `Organization`, `Dataset`
  (with `DataDownload` distributions), `FAQPage`. `toppers.html` carries an `ItemList`.
- `robots.txt` explicitly allows general and AI crawlers (GPTBot, ClaudeBot, PerplexityBot,
  Google-Extended, CCBot, …) and points to `sitemap.xml`.
- `llms.txt` — a plain-text brief for AI agents, linking the machine-readable data.
- `toppers.html` is a complete, JS-free, crawlable index of every topper and copy; the SPA is
  progressive enhancement on top. `index.html` also carries a `<noscript>` summary + full topper list.

## Performance

The whole design is two data shapes and one search engine (`docs/DECISIONS.md` DECISION-17):

- **Boot** fetches `data/copies.json` (~184 KB gzip) — every copy, grouped by topper, with AIR / year
  / marks already resolved. Browse and topper-name search work from that alone.
- **Question text** lives in one shard per paper, `data/questions-<paper>.json` (GS1 177 · GS2 162 ·
  GS3 107 · GS4 601 · Essay 23 · Other 26 · Optional 7 KB gzip). All are fetched on
  `requestIdleCallback` (delayed on 2G / Save-Data, never skipped) and immediately on search focus,
  first keystroke or card expand. A text query is `indexOf` over every question in the loaded shards
  the paper filter allows — about a millisecond. While a needed shard is still downloading the
  result line says "Searching inside N copies…" and never shows a zero.
- **Self-hosted fonts**, latin-subset. Inter is `font-display: swap` and preloaded; Fraunces is
  `font-display: optional` and deliberately not preloaded (headings only, never blocks or reflows).
- **Results paginate** 25 at a time; "Show more" appends in place.
- **Phones (≤680px):** the sticky header/toolbar drop `backdrop-filter`, and inputs are 16px so iOS
  Safari does not zoom on focus.
- **Service worker:** one stale-while-revalidate strategy for every same-origin GET; shell and
  `copies.json` precached.
- **GA loads `async`** and never blocks render.

Budgets for all of this are enforced by `npm run check`; `INV-6` there fails the build if this section
ever describes something the code does not have.

## Analytics

Google Analytics 4, Measurement ID `G-VTL4V9JQBH` (in `index.html` `<head>` and mirrored as `GA_ID`
in `assets/app.js`). `send_page_view` is off; the app sends SPA page views on tab change plus custom
events: `search`, `filter_change`, `copy_open`, `question_open`, `pdf_open` (outbound, with
topper/paper/source/page), `optional_subject_view`, `practice_open`, `practice_question`, `theme_change`,
`tab_view`, `submit_kind`, `submit_issue_open`, `click_outbound`, `app_ready`, `data_loaded`, `shard_loaded`.

## Question extraction

New copies get the same treatment as the seeded ones — a question count and per-question text linked
to the exact PDF page — via a shared heuristic in `assets/extract.js` (pure, no deps).

- **In the browser (Submit form).** The "Estimate the questions" panel lazy-loads `assets/analyse.js`,
  which pulls `pdf.js` from a CDN on first use, reads the chosen PDF **locally** (the file is never
  uploaded), reconstructs text lines from glyph positions, and runs `extract.js`. It shows an estimated
  count + preview and attaches a ready-to-merge CSV block to the GitHub issue.
- **OCR fallback (scanned PDFs).** When there's no text layer, an "OCR the printed questions" button
  appears. It lazy-loads Tesseract.js (~13 MB, CDN, only on click), renders each page with pdf.js,
  **crops the top ~42%** (where the printed question sits, above the handwriting), and OCRs just that
  strip. ~2–5 s/page in a foreground tab; runs in a Web Worker so the tab stays responsive; per-page
  30 s timeout so one bad page is skipped, not fatal. Result feeds the same `extract.js` heuristic.
  Works on uploaded files; a pasted link only works if the host sends CORS headers (most don't).
- **For the maintainer (`extract.js` CLI).** Same heuristic, authoritative (text layer only — no OCR):
  ```bash
  npm install                                   # once — installs pdfjs-dist (dev only, not shipped, not in CI)
  node extract.js <url|file.pdf> --topper "Shakti Dubey" --paper GS1 --coaching ForumIAS --append
  node build.js
  # optional subject → emit a data/optionals.json entry with an embedded questions[] array:
  node extract.js <url> --topper "X" --paper "Optional — Sociology" --json
  ```

It's a heuristic — printed question headers extract with occasional misses, OCR adds its own errors,
and pure-handwriting pages yield nothing. A maintainer always reviews before it goes live.

## Complete dataset (`dataset/`)

`build.js` also writes a consolidated, self-contained backup under `dataset/` — every question from
every copy (GS, Essay **and** optional subjects), plus per-topper AIR / year / marks, **including all
accepted submissions**, with a `provenance` column (`upsckata` / `submission` / `ocr` / `link`). The website never
loads it; it's an archive for reference and reuse (CC BY 4.0). `dataset/questions.csv` is the main
flat file; `dataset/dataset.json` is everything nested; `dataset/manifest.json` carries SHA-256
checksums and row counts. Full docs: [`dataset/README.md`](dataset/README.md).

## Submissions & moderation

Anyone submits via the [Submit form](https://topperscopy.hashin.me/#submit) (or an issue directly) —
it opens a GitHub issue labelled `submission`.

**Moderators** (repo collaborators — see [`MODERATORS.md`](MODERATORS.md)) review the copy, and if it's
genuine add the **`approved`** label. `.github/workflows/moderate.yml` then:

1. confirms the approver is a collaborator,
2. runs `.github/scripts/apply-submission.mjs` — parses the issue and writes:
   - optional-subject copy → entry in `data/optionals.json` (with `questions[]` if the issue carries them),
   - GS/Essay copy → rows appended to `data/submissions.csv` (never `questions.csv`, the clean mirror),
   - AIR / year / marks → `data/toppers.overrides.json`,
3. runs `node build.js`, commits, pushes — live in ~1–2 min,
4. comments a summary, labels the issue `merged`, closes it.

If it can't apply cleanly (e.g. a GS copy with no extracted questions) it comments why and drops the
label. To do it by hand: run `node extract.js "<url>" --topper "…" --paper GS1 --append`, then
`node build.js`, commit.

Appointing a moderator = adding a repo collaborator (Triage role is enough). Details in `MODERATORS.md`.

## Deploy (GitHub Pages + subdomain)

1. Push to `main` on `github.com/hashin/topperscopy`. `.github/workflows/deploy.yml` runs `node build.js`
   and deploys the servable subset (Settings → Pages → Source: **GitHub Actions**).
2. `CNAME` in the repo sets the custom domain to `topperscopy.hashin.me`; DNS at the registrar
   (Spaceship) has `CNAME  topperscopy  ->  hashin.github.io`. "Enforce HTTPS" is on.

## Licence

Code: MIT. Data: mirrored from upsckata.com — credit them. Rights holders wanting a link removed can
[open an issue](https://github.com/hashin/topperscopy/issues).
