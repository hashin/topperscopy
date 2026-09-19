# Topper's Copy by Hashin — project map

Free static site: a searchable directory of UPSC Mains topper answer copies. Live at
**https://topperscopy.hashin.me** (GitHub Pages; `.github/workflows/deploy.yml` runs `node build.js` on
every push to `main` and deploys the result — nothing generated is committed). No backend. Everything free.

Origin: a re-skin + extension of **upsckata.com "Topper Copies"** (credit it everywhere — README, About,
`llms.txt`, `dataset/README.md`). Its `questions.csv` is the GS/Essay searchable core. We add optional
subjects, per-topper AIR/marks, link-only copies from other coaching sites, a submission workflow, dark
mode, and a dataset backup.

## Start here — the session protocol

The repo carries its own memory (`docs/`), because chat context does not survive a session.
Before writing code: read `docs/MEMORY.md`, `docs/INTENT.md`, `docs/DECISIONS.md` (DECISION-17 is the
current architecture; earlier ones it supersedes are kept as history), the last 2–3 entries of
`docs/SESSIONS.md`, then run `node build.js && npm run check`. If something is red before you touch
anything, say so. Before finishing: append to `docs/SESSIONS.md`, add any new want to `docs/INTENT.md`,
an ADR to `docs/DECISIONS.md` for any non-obvious choice, and `npm run check` must pass.
**Never silently reverse a `DECISION-n`** — supersede it properly or leave it alone.

| Command | Does |
|---|---|
| `node build.js` | Regenerates everything below (~3 s, zero deps). Precondition for the check. |
| `npm run check` | `tools/check.mjs` — every invariant + gzip budget, ~2 s, no browser. |

## Do not open these with a file reader — large, generated, gitignored

`data/copies.json`, `data/questions-*.json`, `data/interview-list.json`, `data/interview-text-*.json`,
`toppers*.html`, `topper/`, `question/`, `paper/`, `optional/`, `sitemap*.xml`, `llms.txt`, `robots.txt`,
`dataset/` (all written by `build.js`), and the big source files `data/questions.csv` (9 MB),
`data/link-copies.json` (2.4 MB), `data/optionals.json`, `data/interviews.json` (11.5 MB). Inspect them
with `node -e` / `head` / `wc`. This file is the source of truth for their shape.

## Source-of-truth files (the only things you edit for data)

| File | What | Shape |
|---|---|---|
| `data/questions.csv` | mirror of upsckata.com — append-mostly; sanctioned hand-edits are correcting a wrong `subject`, and disambiguating a `topper` name that collides two different real people (see DECISION-22) — never reflow rows, keep CRLF | `topper,coaching,subject,page_number,question,metadata,url` (subject = GS1..GS4/Essay) |
| `data/submissions.csv` | accepted GS/Essay copies **with** extracted question text | same 7 cols |
| `data/ocr-questions.csv` | questions read off scanned copies by `ocr-pipeline.mjs` (Gemini) | same 7 cols |
| `data/link-copies.json` | GS/Essay copies that are **only a link** | `{entries:[{topper,paper,url,air?,year?,source?,note?,verified}]}` |
| `data/optionals.json` | optional-subject copies, some with OCR'd `questions[]` | `{entries:[{topper,subject,url,air?,year?,marks?,source?,note?,verified,questions?:[{page,question,marks,words}]}]}` |
| `data/toppers.overrides.json` | maintainer AIR/year/marks corrections | `{"<name>":{air,year,verified,marks:{},sources:[]}}` — `_`-keys ignored |
| `data/telegram.json` | topper Telegram channels, matched by name tokens | `{entries:{"<informal name>": url}}` |
| `data/syllabus.json` | hand-authored UPSC syllabus, GS1–4 + Essay, 2 levels; `nodes[].kw` = lowercase phrases scored against each question | `{version, papers:{GS1:{name, nodes:[{id,t,kw:[]}]}, …}}` |
| `data/syllabus-overrides.json` | pin a question to node(s); key = `qKey()` of the text | `{"<qKey>": ["gs2.federalism"]}` |
| `data/questions.exclude.json` | denylist for junk rows in the mirror, by URL (incl. `#page=N`) or `qKey()` | `{urls:[…], keys:[…]}` — `_`-prefixed ignored |
| `data/interviews.json` | mirror of upsckata's Personality Test interview transcripts — re-fetch by re-downloading `upsckata.com/data/interviews.json` whole; not credited to upsckata (Hashin, 2026-09-15 — see DECISION-19) | `{meta, docs:[{i,c,u,b,d,y,s,o,st,k,h,e,n,mk,pt,q,w,v,t}]}` — `i`=id, `b`=board, `d`=date, `y`=year, `s`=slot, `o`=optionals, `st`=states, `k`=DAF topics, `h`=hobbies, `e`=education, `n`=candidate name, `mk`=mocks attended, `pt`=personality-test marks/275, `q`/`w`=question/word count, `v`=Telegram views, `t`=full transcript text |

**A PDF URL (without `#page`) is a copy's identity, everywhere.** One copy per URL; the same topper may
appear from several sources. **Topper names** are canonicalised before anything else (`nameKey()` collapses
case + punctuation; the best-cased, then most common spelling wins), so `ADITYA SRIVASTAVA` and
`Aditya_Srivastava` are one person. **Answer fragments** upsckata scraped as questions ("Why still
untapped?…") are dropped by `isAnswerFragment()`; anything it misses goes in `questions.exclude.json`.

## build.js — reads top to bottom in the order it runs

1. **Parse** the CSVs + JSONs above (exclude list applied). 2. **Canonicalise names.** 3. **Copies + toppers
table** — every copy `{t,c,p,u,y,r,q,prov,link,optional,note}`; optional-subject copies have the subject as
`p`; AIR/year resolve once per topper (first copy in source order that carries one, then overrides).
4. **Dedupe questions** per paper — containment merge: bucket by the first 60 normalised chars, longest text
first, a text that is a substring of a kept text merges into it (refs move over) unless the kept text
continues with another numbered question. Rows that are not standalone questions (GS4 "(a)/(b)" sub-parts,
orphan sub-parts, stray fragments) are deduped separately as `fragments`. 5. **Syllabus mapping.** 6. **Write**:

- `data/copies.json` — `{generated, attribution, stats, toppers:{"<name>":{air?,year?,verified?,marks?,telegram?,sources?,
  copies:[[paper, source, url, nQuestions, linkOnly, note?], …]}}}`. Every copy. The only file the app boots from.
- `data/questions-<gs1|gs2|gs3|gs4|essay|other|optional>.json` — `{generated, paper, urls:[…], questions:[[text,
  [[urlIndex,page],…], [syllabusNodeIds], marks, words], …], fragments:[same]}`. Refs index the shard's own
  `urls` table; a copy's URL appears in exactly one shard. `optional` holds every optional subject.
- `stats` = GS/Essay searchable index (JSON-LD, llms.txt, noscript); `stats.all` = the homepage headline.

7b. **Interviews** — `writeInterviews()` maps `data/interviews.json` straight through (facet counts for
board/year/optional/state recomputed from the docs, not trusted from the source file's own `meta`) into:

- `data/interview-list.json` — `{generated, total, boards, years, optionals, states, interviews:[{i,b,n,d,y,
  s,o,st,k,h,e,mk,marks,q,w,v,u}]}`, no transcript text — the Interviews tab's one boot file.
- `data/interview-text-<year>.json` — `{generated, year, text:{"<id>": "<full transcript>"}}`, one shard per
  year, fetched only when a specific interview card is opened.

7. **Static pages** — `topper/<slug>/` (one per person; `dedupeSlug()` handles same-name collisions and the
returned name→slug map is used by every other writer), `question/<slug>/` (one per deduped GS/Essay question,
answers rank-sorted; a single-answer page is `noindex,follow` and left out of the sitemap — the real SEO
surface), `paper/<gs1…>/` and `optional/<subject>/` hubs, `toppers.html` + `toppers-N.html` (JS-free index,
200 per page), and the `<!-- STATIC -->` / `<!-- LD -->` / `<!-- META -->` marker blocks in the tracked
`index.html`. 8. **Sitemaps, robots.txt, llms.txt.** 9. **`dataset/`** — CC-BY backup (`questions.csv`,
`copies.csv`, `toppers.csv`, `dataset.json`, `manifest.json`, `README.md`); `copy_id` there is a row number.
Interviews are not part of `dataset/` or the SEO static pages — see 7b above; a future session can add
either if Hashin asks.

## The app — `index.html` + `assets/app.js` + `assets/style.css` + `sw.js`, vanilla, no build step

- **Boot:** `load('data/copies.json')` → `COPIES` (flat, each with its topper `T` attached), `COPYBYURL`, facets,
  first 25 cards. Then every shard is prefetched on idle (delayed on 2G/Save-Data, never skipped) and at once on
  search focus / first keystroke / card expand / Questions view / Practice. `load(url)` memoises one fetch per URL.
- **Search:** `terms = q.toLowerCase().split(/\s+/)`. A topper-name hit comes from `COPIES` (always ready). A
  text hit is `indexOf` per term over every question in every loaded shard the paper filter allows ("Exact
  phrase" = the joined query). If a needed shard is still loading, `#resultmeta` says "Searching inside N
  copies…" and never prints a zero. "Best match" = name hit ≫ number of matched questions (+0.5 if one contains
  the whole phrase). Paper chips: GS1–4, Essay, Other, **Optionals** (every optional subject).
- **Cards:** one `copyCard()` for every kind of copy; with a text match it lists only the matched questions,
  otherwise every question from the copy's shard (`byCopy` reverse map). Every change rebuilds the first
  `state.shown` cards and re-opens the ones that were open; "Show more" appends before its own button.
- **Questions view** (`#qview`), **syllabus filter** (`#syl`, from `data/syllabus.json`), **Practice**
  `<dialog>` (random question, prefers ≥3 answers; `localStorage tc-practice` = `{seen:{<paper>:[fnv(text)]},
  s:{d,n,t}}`), **Optionals tab** (subject grid over the same `COPIES`; its search box also matches question
  text once the `optional` shard is in), **Submit tab** (lazy `assets/extract.js` + `assets/analyse.js`; pdf.js /
  Tesseract from CDN only on click), URL sync (`?q=` `?paper=` `?syl=`; one `pushState` on empty→non-empty),
  theme toggle (`localStorage tc-theme`), GA4 `G-VTL4V9JQBH` events.
- **`sw.js`:** one stale-while-revalidate strategy for every same-origin GET; shell + `copies.json` precached.
  Bump `VERSION` on shell changes.
- **Interviews tab:** a wholly separate corpus (`data/interview-list.json`), loaded only when that tab
  opens — never prefetched on idle the way copy shards are (DECISION-19). Filters: board, year, optional
  subject, state. Free-text search matches candidate name, board, DAF topics, hobbies and education —
  **not** the transcript text, which is never loaded until a specific card is opened
  (`data/interview-text-<year>.json`, one shard per year). Not linked to `TOPPERS`/`COPIES` — a candidate's
  name here is never matched to a topper profile (see DECISION-19's "Rejected").

## Workflow for any data change

1. Edit a source file (table above). 2. `node build.js && npm run check`. 3. Commit only the source file(s) —
generated files are gitignored. 4. Push; `deploy.yml` rebuilds and redeploys in ~1–2 min.

**Deploy:** `.github/workflows/deploy.yml` — checkout → `node build.js` → rsync the servable subset into
`_site/` (excludes `.git`, `.github`, `tools/`, docs, the maintainer scripts and the big source files) →
GitHub Pages (`build_type: workflow`). **Moderation:** `moderate.yml` — a collaborator adds `approved` to a
submission issue → `.github/scripts/apply-submission.mjs` writes to the source files → `node build.js`
validates → commits only the source diff. `ocr.yml` / `ocr-gemini.yml` do the same for OCR output.
**Maintainer CLI:** `npm install` once (pdfjs-dist, not used by CI), then
`node extract.js <url|file.pdf> --topper "Name" --paper GS1 [--append|--json]`.

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

ForumIAS's optional-test-series page (`academy.forumias.com/optional-test-series/ToppersCopy.html`)
added 8 PSIR toppers (2026-09-15) — 9 of its 12 listed toppers had real, publicly-fetchable PDFs
(same-origin `.pdf` links, no login); 3 pointed at a YouTube channel instead of a copy and were
skipped. One (Preeti Kumari, AIR 130, "UPSC 2022" on that page) was skipped deliberately — the
dataset already has a different Preeti Kumari at AIR 301/2024, and this project's name
canonicalisation (`nameKey()`) is spelling-only, so adding it would have silently merged two
different people. Needs a human to confirm identity before it's added — see `docs/SESSIONS.md`
2026-09-15.

**piyushchaubey.com** (`/downloads`, a PSIR coaching site) is **login-gated** — the listing page shows
topper names/ranks but every "download" link goes to `/login?redirect=downloads` with no PDF URL
recoverable without an account. Same bucket as GS SCORE/theIAShub — skip, don't re-host.

**Interviews** (2026-09-15): `data/interviews.json` is a separate, whole-file mirror of
`upsckata.com/data/interviews.json` — 3,863 UPSC Personality Test transcripts, unrelated to the GS/Essay
`questions.csv` core above. Per Hashin's instruction this source is **not credited** (unlike the
GS/Essay core, which upsckata must be credited for everywhere). Re-fetch by re-downloading the file
whole; there is no per-transcript scraping in this repo. See DECISION-19.

## Open items

- **Preeti Kumari name collision** (2026-09-15) — ForumIAS's PSIR toppers page lists a "Preeti Kumari,
  AIR 130, UPSC 2022"; the dataset already has a different Preeti Kumari at AIR 301/2024 (Anthropology
  optional). Not added — needs Hashin to confirm whether these are the same person (re-attempted with
  a different optional) or two different people, then either merge deliberately (with a name variant if
  they're different) or add the AIR 130/2022 PSIR copy as-is if they're the same.
- **Questions-only OCR of all link-only copies** — user will trigger later (after compiling more
  optionals). Plan: Gemini 2.0 Flash on the top page-strip, ~$5 one-time, ~19k pages. Downloads
  automated by a resumable `ocr-pipeline/` script; output merges into `optionals.json` / `submissions.csv`.
- `ocr-pipeline.mjs audit-paper` (a maintainer-only diagnostic) still reads the deleted `qmeta.json` /
  `qtext.json`; point it at the `data/questions-*.json` shards before its next use.
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
      2026-09-14.** It counted only the *boot* payload. Measured end-to-end against a real brotli origin the
      saving on the old five-file search payload was **1,078 KB (2,220 KB → 1,142 KB, −49 %)**; re-measure
      against today's one-shard-per-query model before deciding anything.
    - **Also wrong:** the choice is not only "move the nameservers". Netlify and Vercel both serve brotli
      on their free tiers and attach a custom domain via **a single CNAME added at Spaceship** — the zone
      stays put, every MX/SPF/apple-domain record is untouched, and the iCloud-mail risk is zero. Check
      their ~100 GB/month free-tier bandwidth caps against real traffic first.
    - Still true: GitHub Pages already serves this site from Fastly's Mumbai PoP (`x-served-by: cache-bom-*`),
      so the CDN-latency argument is largely moot for the audience. And still true that the *nameserver*
      migration is a whole-domain job to be done deliberately, never as a perf tweak.

## Conventions

- Vanilla ES5-ish in `app.js`, no frameworks, no bundler, no TypeScript. `build.js` has zero runtime deps.
- Keep it free and static. No paid services in the request path. Analyser/OCR libs load from CDN, lazily.
- Every "Open PDF/copy" link points to a third-party host — **nothing is re-hosted**. Keep credit to
  upsckata.com where it is (README, About, `llms.txt`, `dataset/README.md`).
- Comments say *why*; a reader should never need `docs/archive/` to understand a line.
