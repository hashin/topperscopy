# Toppers Copy

A free, static, community-maintained directory of **UPSC Civil Services Mains topper answer copies** — GS1–4, Essay, and optional subjects. Search across ~17,000 questions and open the exact page of each copy.

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
data/questions.csv          raw mirror of upsckata.com's questions.csv
build.js                    csv -> data/copies.json + data/toppers.json
                                +  toppers.html (static crawlable index)
                                +  sitemap.xml, llms.txt, robots.txt
                                +  fills <noscript> + JSON-LD in index.html
data/optionals.json         community optional-subject copies (hand-merged)
data/toppers.overrides.json maintainer-verified AIR/marks corrections
index.html, assets/, sw.js  the app (progressive enhancement over toppers.html)
```

Regenerate everything after changing the CSV or overrides:

```bash
node build.js
```

The GitHub Action in `.github/workflows/build.yml` does this automatically on push.

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

- **Split data load.** Boot fetches `data/index.json` — copy metadata only, ~26 KB gzipped — so the
  card list paints in well under a second on mobile. The full `data/copies.json` (question text,
  ~2 MB gzipped) loads in the background on `requestIdleCallback`, or immediately the moment the user
  focuses the search box or expands a copy. On `Save-Data` / 2G it isn't fetched until actually needed.
- Fonts (Inter + Fraunces) are self-hosted, latin-subset, variable, `font-display: swap` — no
  third-party font request. Both are `<link rel=preload>`ed; `index.json` is preloaded, `copies.json` prefetched.
- `content-visibility: auto` on result cards; results paginate 25 at a time.
- On phones (`<=680px`): the sticky header/toolbar drop `backdrop-filter` for a solid bar (kills
  scroll jank on mid Android), the colour wash is anchored instead of `fixed`, and all inputs are
  16px so iOS Safari doesn't zoom on focus. Desktop keeps the blur and fixed wash.
- Service worker (`sw.js`) precaches shell + fonts + `index.json`, runtime-caches `copies.json` (stale-while-revalidate).
- GA loads `async` and never blocks render.

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
- **For the maintainer (`extract.js` CLI).** Same heuristic, authoritative:
  ```bash
  npm install                                   # once — installs pdfjs-dist (dev only, not shipped, not in CI)
  node extract.js <url|file.pdf> --topper "Shakti Dubey" --paper GS1 --coaching ForumIAS --append
  node build.js
  # optional subject → emit a data/optionals.json entry with an embedded questions[] array:
  node extract.js <url> --topper "X" --paper "Optional — Sociology" --json
  ```

It's a heuristic, not OCR — handwritten scans with no text layer yield nothing (fill the count by
hand), and printed question headers extract with occasional misses. A maintainer always reviews.

## Contributing

- **Add a copy / fix marks:** use the [Submit form](https://topperscopy.hashin.me/#submit) or open an
  issue directly. A maintainer verifies each submission, then:
  - GS/Essay copy → append its rows to `data/questions.csv` (paste the analyser's CSV, or run
    `node extract.js … --append`);
  - optional-subject copy → add an entry to `data/optionals.json` (with a `questions[]` array if available);
  - topper data → add to `data/toppers.overrides.json` with `"verified": true`.
- Run `node build.js`, commit, done.

## Deploy (GitHub Pages + subdomain)

1. Push this repo to `github.com/hashin/topperscopy`.
2. Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/`.
3. `CNAME` in the repo already sets the custom domain to `topperscopy.hashin.me`.
4. DNS (Cloudflare, `hashin.me` zone): add `CNAME  topperscopy  ->  hashin.github.io` (DNS-only / grey cloud).
5. Wait for the cert, then enable "Enforce HTTPS".

## Licence

Code: MIT. Data: mirrored from upsckata.com — credit them. Rights holders wanting a link removed can
[open an issue](https://github.com/hashin/topperscopy/issues).
