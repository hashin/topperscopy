# Toppers Copy

A free, static, community-maintained directory of **UPSC Civil Services Mains topper answer copies** — GS1–4, Essay, and optional subjects. Search **26,621 questions** across **9,082 answer copies** by **1,694 rank-holders**, and open the exact page of each copy.

Live: **https://topperscopy.hashin.me**

## Credit

The question-level database — which topper answered which question, on which page of which PDF —
comes from **[upsckata.com — "Topper Copies"](https://toppercopies.upsckata.com/)**. This repo is an
independent, non-commercial mirror. It adds:

- an **Optionals** section (Sociology, Anthropology, History, PSIR, Geography, …), which the source
  database doesn't cover — filled entirely from community submissions;
- **per-topper tags** — AIR, exam year, subject-wise marks — auto-seeded from source PDF file names
  and topped up by submissions;
- a **Submit** workflow so students can add missing copies and correct topper data.

No answer copy is hosted here. Every "Open PDF" link points to the file on the site that published it
(ForumIAS, Vision IAS, NextIAS, Lukmaan IAS, GS SCORE, Rau's IAS, …).

## How it's built

Pure static — no runtime backend, no build step required to serve it.

```
data/questions.csv          mirror of upsckata.com's questions.csv — only sanctioned hand-edit: fixing a wrong `subject`
data/submissions.csv        accepted GS/Essay copy submissions (same 7-col schema)
data/optionals.json         accepted optional-subject copies
data/toppers.overrides.json maintainer-verified AIR / marks corrections
        |
  build.js
        |
        +->  data/copies.json + data/index.json + data/toppers.json   (served by the app)
        +->  toppers.html, sitemap.xml, llms.txt, robots.txt          (static / SEO)
        +->  index.html  (<noscript> + JSON-LD between markers)
        +->  dataset/    (complete consolidated backup — see dataset/README.md — not served)

index.html, assets/, sw.js  the app (progressive enhancement over toppers.html)
```

Regenerate everything after changing the CSV or overrides:

```bash
node build.js
```

The GitHub Action in `.github/workflows/build.yml` does this automatically on push.

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
| [`docs/IMPLEMENTATION-PROMPT.md`](docs/IMPLEMENTATION-PROMPT.md) | The prompt to paste into a new session to implement one audit phase. |

```bash
npm install          # playwright-core, dev only — not used by build.js or CI
node build.js        # the checks measure real output, so build first
npm run check        # ~2s: every invariant, each citing the intent it protects
npm run check:all    # adds the browser checks
npm run perf         # the full performance harness
```

`npm run check` is the honest status of the project at any moment. Checks are either **enforced**
(must pass) or **tracked** (known-failing, tied to an open audit item) — so the same file is both a
regression guard and a live to-do list. When a tracked check starts passing, it gets promoted and the
budget ceiling ratchets down.

## SEO & AI readability

- Rich `<head>`: canonical, Open Graph + Twitter cards, `theme-color`, `<link rel=alternate>` to the JSON.
- JSON-LD `@graph` on the home page — `WebSite` (+ SearchAction), `Organization`, `Dataset`
  (with `DataDownload` distributions), `FAQPage`. `toppers.html` carries an `ItemList`.
- `robots.txt` explicitly allows general and AI crawlers (GPTBot, ClaudeBot, PerplexityBot,
  Google-Extended, CCBot, …) and points to `sitemap.xml`.
- `llms.txt` — a plain-text brief for AI agents, linking the machine-readable data.
- `toppers.html` is a complete, JS-free, crawlable index of every topper and copy; the SPA is
  progressive enhancement on top. `index.html` also carries a `<noscript>` summary + full topper list.

## Performance — measured, not assumed

Full audit with repro commands: [`PERF-UX-AUDIT-2026-09-14.md`](PERF-UX-AUDIT-2026-09-14.md).
Every number here comes from `npm run perf` (real Chromium, CPU throttled 4x, network throttled).

**What is good today.** First paint is fast: **FCP/LCP 676 ms on 4G**, 1,044 ms on slow 3G, with the
first 25 cards already painted. Boot fetches `data/index.json` — copy metadata only, ~25 KB gzipped.

**What is not.** Search is gated on a large download:

| | gzip on the wire | gates |
|---|---:|---|
| `data/index.json` | 25 KB | the first 25 cards |
| `data/copies.json` | 330 KB | searching inside copies |
| `data/questions.json` | **1,639 KB** | searching inside copies |
| **total before a text query can be answered** | **1,994 KB** | |

Measured consequence: typing `federalism` costs **2,670 ms on 4G / 4,455 ms on slow 3G** before real
results appear — and for most of that wait the interface reads `0 copies for "federalism"`, for a
corpus that has 162 matching copies. That is the top item in the audit (P1).

**Where it is going.** A conventional inverted index over the same corpus is **292 KB gzipped**
(measured: `node tools/perf/index-proto.mjs`) and answers the same queries; question *text* is only
needed to display the ~25 matches on screen, not to find them. With the dead `sl` field dropped and
the text split out, the search-gating payload target is **751 KB on plain gzip (-62 %)**. Progress is
enforced by a ratcheting budget in `tools/check/budget.json`.

**Techniques actually in the code right now:**

- **Split data load.** Boot fetches `index.json` only. `copies.json` loads on `requestIdleCallback`,
  or immediately when the user focuses the search box. On `Save-Data` / 2G it is delayed further.
- **Self-hosted fonts**, latin-subset, variable, no third-party font request. Inter is `font-display:
  swap` and preloaded; Fraunces is `font-display: optional` and deliberately **not** preloaded — see
  audit P9(c) for why preloading a font the browser has been told not to use costs 65.8 KB for nothing.
- **Results paginate** 25 at a time.
- **Phones (<=680px):** the sticky header/toolbar drop `backdrop-filter` for a solid bar (a known
  scroll-jank source on mid Android), the colour wash is anchored instead of `fixed`, and inputs are
  16px so iOS Safari does not zoom on focus.
- **Service worker** precaches the shell, runtime-caches the heavy data files cache-first with a TTL.
- **GA loads `async`** and never blocks render.

> Previous versions of this section claimed `content-visibility: auto` on result cards, a
> `copies.json` prefetch, and that both fonts were preloaded. **None of the three existed in the
> code.** `INV-15` in `tools/check/invariants.mjs` now fails the build if this section describes an
> optimisation the code does not have.

## Analytics

Google Analytics 4, Measurement ID `G-VTL4V9JQBH` (in `index.html` `<head>` and mirrored as `GA_ID`
in `assets/app.js`). `send_page_view` is off; the app sends SPA page views on tab change plus custom
events: `search`, `filter_change`, `copy_open`, `pdf_open` (outbound, with topper/paper/source/page),
`optional_subject_view`, `theme_change`, `tab_view`, `submit_kind`, `submit_issue_open`,
`click_outbound`, `app_ready`, `data_loaded`.

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
accepted submissions**, with a `provenance` column (`upsckata` / `submission`). The website never
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

1. Push this repo to `github.com/hashin/topperscopy`.
2. Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/`.
3. `CNAME` in the repo already sets the custom domain to `topperscopy.hashin.me`.
4. DNS (Cloudflare, `hashin.me` zone): add `CNAME  topperscopy  ->  hashin.github.io` (DNS-only / grey cloud).
5. Wait for the cert, then enable "Enforce HTTPS".

## Licence

Code: MIT. Data: mirrored from upsckata.com — credit them. Rights holders wanting a link removed can
[open an issue](https://github.com/hashin/topperscopy/issues).
