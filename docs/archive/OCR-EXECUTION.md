# OCR execution runbook

**Read `CLAUDE.md` first** — it has the project map, the source-of-truth file list, and the
data-change workflow. This document is the step-by-step for one specific project: reading the
printed question off every scanned answer copy, then using the result to improve the site.

Everything here is designed to cost **₹0**. No paid APIs, no servers, no hosting bill. If any
step would cost money, that's a bug in the plan — stop and say so.

---

## 0. Where things stand

| | |
|---|---|
| Copies on the site | 8,090 |
| Searchable (have question text) | 1,063 — **13%** |
| Link-only (a bare PDF link, no questions) | 7,027 |
| Distinct questions indexed | 7,281 |
| Questions with only **one** topper's answer | 4,801 — **66%** |
| Questions with 3+ toppers (what Practice mode needs) | 1,430 |

**The point of this project is not "more questions".** Coaching test series recycle the same
papers, so distinct questions will grow slowly. What grows is *toppers per question* — and a
question with twelve answers is a study session, where a question with one is a curiosity.

### Already built and committed

- `ocr-pipeline.mjs` — all stages, commands listed by running it with no arguments.
- `.github/workflows/ocr.yml` — sharded Tesseract pass (manual trigger).
- `.github/workflows/ocr-gemini.yml` — daily Gemini residue pass (gated off until enabled).
- `.github/ISSUE_TEMPLATE/report-question-error.yml` — volunteer error reports.
- `.ocr/` is gitignored — it's a scratch cache, never commit it.

### Not built yet (later phases, in order)

1. Paper-classification audit review (§5)
2. Syllabus mapping tool (§6)
3. "Report a problem" link in the app (§7)
4. Practice-mode timer (§8) — **explicitly deferred until OCR is done**

---

## 1. Prerequisites — do these before anything else

### 1a. Gemini API key (free tier, no card)

Ask the user to do this; do not attempt it yourself:

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with any Google account.
3. Click **Create API key** → **Create API key in new project**.
4. Copy the key (starts `AIza…`).
5. In GitHub: repo → **Settings → Secrets and variables → Actions → Secrets → New repository secret**
   - Name: `GEMINI_API_KEY`
   - Value: the key
6. Same page, **Variables** tab → **New repository variable**
   - Name: `OCR_GEMINI_ENABLED`, Value: `true`
   *(The Gemini workflow refuses to run until this is `true`, so a stray schedule can't fire early.)*

Free tier at time of writing: ~15 requests/minute, ~1,000–1,500/day, no billing attached. The
pipeline sleeps 4.2 s between requests and stops at a request budget, so it stays inside it.

### 1b. Confirm Actions can push

`.github/workflows/*.yml` already request `permissions: contents: write`. If a push fails with
403, check **Settings → Actions → General → Workflow permissions** is set to
*Read and write permissions*.

---

## 2. Smoke test — always do this first

Nothing below scales until this passes. Run it locally, not in Actions.

```bash
cd ~/Documents/GitHub/topperscopy
npm install
brew install poppler tesseract        # macOS. Linux: apt-get install poppler-utils tesseract-ocr
node ocr-pipeline.mjs plan
node ocr-pipeline.mjs freepass --source "Drishti IAS" --limit 3
node ocr-pipeline.mjs ocr --source "Drishti IAS" --limit 2
cat .ocr/ocr/*.json | head -c 2000
```

**Pass criteria** — at least one unit has a non-empty `questions` array, and the text in it
reads like a real UPSC question, not OCR noise.

**If it fails:**

| Symptom | Do this |
|---|---|
| `pdftoppm: not found` | Install poppler. |
| All units empty, `residuePages` full | Open one page PNG by hand (comment out the `unlinkSync`), look at it. If the crop cut the question off, raise `STRIP_FRACTION` in `ocr-pipeline.mjs`. If the scan is skewed/faint, that's expected — Gemini will catch it. |
| Text present but gibberish | Check the crop isn't landing on handwriting. If the printed header sits lower than 38% on this source, that source needs its own fraction. |
| Fewer than ~30% of units yield anything | **Stop and report.** Tesseract may be the wrong primary engine; PaddleOCR is the fallback plan. Do not run the full corpus on a bad engine. |

---

## 3. The Tesseract pass (the bulk of the work)

Run it on **GitHub Actions** — free and uncapped on public repos, and this repo is public.

1. GitHub → **Actions** → **OCR — Tesseract pass** → **Run workflow**
2. Inputs for the first real run:
   - `shards`: `10`
   - `limit_per_shard`: `40` ← **a deliberately small first run**
   - `source`: `VisionIAS`
3. Wait for it to finish (~30–60 min). It will commit `data/ocr-questions.csv` and rebuild.

**Checkpoint — do not skip.** Pull, then verify by hand:

```bash
git pull
node -e '
const fs=require("fs");
const rows=fs.readFileSync("data/ocr-questions.csv","utf8").trim().split("\n").slice(1);
console.log("rows:", rows.length);
rows.slice(0,15).forEach(r=>console.log(r.slice(0,150)));'
```

Open **three** of the resulting `url` values in a browser. Each should land on a page whose
printed question matches the extracted text. If two of three are wrong, stop and report.

Then scale up: same workflow, `shards: 20`, `limit_per_shard: 0`, `source` blank.

---

## 4. The Gemini residue pass

Only after §3 has run across the whole corpus.

- It runs itself daily at 01:20 UTC once `OCR_GEMINI_ENABLED` is `true`.
- To run it now: **Actions → OCR — Gemini residue pass → Run workflow**, `requests: 800`.
- It stops at the budget and on the first HTTP 429, so it cannot exceed the free tier.
- Expect roughly a week of daily runs to drain the backlog. That's fine — nothing is blocked
  on it, and the site improves a little each day.

---

## 5. Paper-classification audit (GS1 / GS2 / GS3 / GS4 / Essay)

Questions inherit their paper from whatever the source website said, and sources get it wrong —
we already found Vajiram IFoS GS papers filed as an "IFS optional subject". This checks it.

```bash
node ocr-pipeline.mjs audit-paper
```

Writes `.ocr/paper-audit.json`. Four independent signals, and a question is only *suggested*
for reclassification when **two or more agree**:

1. **Cross-paper syllabus score** — score the question's keywords against *every* paper's
   syllabus nodes, not just its own. If another paper scores more than double, that's a signal.
2. **Ethics vocabulary** — "integrity", "probity", "conscience", "dilemma", "case study" are a
   strong GS4 tell, and their total absence from a long GS4-filed question is a weak counter-tell.
3. **Essay shape** — essay topics are short, declarative, and carry no directive verb.
4. **Cluster consistency** — every question from the same test file should share a paper; an
   outlier row is suspect. *(Not yet implemented — add it as `audit-paper --clusters`.)*

**How to act on it:**

- Sort by `suggest` non-null, then by `answers` descending — fixing a question that 40 toppers
  answered is worth 40× fixing one nobody answered.
- Review the top ~50 by hand. For each genuine error, fix the `subject` column in the row's
  source file (`data/link-copies.json`, or the CSV row) — **never** edit `data/questions.json`,
  it's generated.
- Re-run `node build.js`, confirm the count moved, commit.
- Do not bulk-apply suggestions unreviewed. A wrong paper is a visible, embarrassing error.

---

## 6. Syllabus mapping tool

Today `build.js` `mapSyllabus()` scores a question's text against keyword lists in
`data/syllabus.json` and keeps the top two nodes scoring ≥8. It maps **48%** of questions.
`data/syllabus-overrides.json` (keyed by `qKey(text)`) can pin any question, and build.js
already reads it — but the file doesn't exist yet and there's no way to produce it.

Build **two** things:

### 6a. Maintainer tool — `syllabus-tool.html` (repo root, not linked from the site)

A single static page, opened with `file://`, no server:

- Loads `data/questions.json` and `data/syllabus.json` with `fetch`.
- Left: the syllabus tree for the selected paper, each node showing how many questions map to it.
- Right: a work queue — **unmapped questions first, most-answered first** (highest impact).
- For the selected question: show its text, its current auto-mapping, and the syllabus nodes of
  its paper as clickable chips. Clicking chips sets the mapping.
- Keyboard: `j`/`k` to move through the queue, `1`–`9` to toggle the first nine chips, `Enter`
  to accept and advance. Speed matters — there are thousands of questions.
- Accumulates into an object keyed by `qKey(text)` (copy that function verbatim from `build.js`
  so keys match) and offers **Download `syllabus-overrides.json`** plus a copy-to-clipboard.
- Persist progress in `localStorage` so the tab can be closed.

The maintainer drops the downloaded file into `data/`, runs `node build.js`, commits.

### 6b. Public view — a "Syllabus" tab in the app

In `assets/app.js`, alongside `browse` / `optionals` / `submit` / `about`:

- The official syllabus as an expandable tree, per paper.
- Each node shows question count and topper-answer count.
- Clicking a node lists its questions; clicking a question opens the same answer list Practice
  mode uses.
- A coverage bar per paper, and — from `localStorage` — how many nodes the user has practised.
  This turns the syllabus from a document into a progress map, which is the thing aspirants
  actually want.

Keep it static. No backend, no accounts, all state in `localStorage`.

---

## 7. Volunteer error reporting

The issue template `.github/ISSUE_TEMPLATE/report-question-error.yml` exists. Wire the site to it:

- Next to every question (browse view, Practice mode, syllabus view) add a small
  **"Report a problem"** link.
- It opens a pre-filled GitHub issue via query parameters:

```js
var url = 'https://github.com/hashin/topperscopy/issues/new'
  + '?template=report-question-error.yml'
  + '&title=' + encodeURIComponent('[fix] ' + q.q.slice(0, 60))
  + '&question=' + encodeURIComponent(q.q)
  + '&copy=' + encodeURIComponent(copyUrl);
```

(The `id:` of each field in the template is the query-parameter name.)

- Style it quietly — it should be findable, not shouty. `font-size: 12px`, muted colour.
- Add one line to the About view explaining that question text is machine-read and inviting
  corrections. Being upfront about it buys a lot of goodwill.

---

## 8. Practice-mode timer — **after OCR is done, not before**

The user was explicit about the order. Once §3 and §4 have landed:

- Show the question, hide the topper answers behind a **Start (7:00)** button — 7 minutes for a
  10-marker, 11 for a 15-marker, derived from the `m` field already on each question.
- A quiet countdown; on expiry (or "I'm done") reveal the answers.
- Track in `localStorage` only: questions attempted, current streak (already exists), time spent.
- Add **"Compare two"** — pick two toppers, open both PDFs at their exact pages. This is the
  single biggest payoff of the OCR work and should ship with the timer.

---

## 9. Rules that must not be broken

- **Never edit generated files**: `data/copies.json`, `data/index.json`, `data/questions.json`,
  `data/toppers.json`, `toppers.html`, `dataset/*`. Edit the source, run `node build.js`.
- **Never commit `.ocr/`.** It's gitignored; keep it that way.
- **Page anchors come only from the document actually read.** Do not copy a page number from one
  topper's booklet to another's — pagination differs per candidate and a wrong deep link is
  worse than no link. (`emit` already enforces this; don't "optimise" it away.)
- **Validation flags are held back, not published.** `emit` skips clusters that `validate`
  flagged. Don't override without reviewing them.
- **Every extracted question must pass `looksLikeQuestion()`** from `assets/extract.js`. That
  filter is what keeps OCR noise off the site.
- **A wrong question is worse than a missing one.** When unsure, drop the row.
- **Zero cost is a hard constraint**, not a preference. No paid API, no hosting, no service that
  bills. If something seems to need one, stop and ask.

---

## 10. Rollback

Every OCR batch lands in `data/ocr-questions.csv` and nothing else. To undo everything:

```bash
git rm data/ocr-questions.csv
node build.js
git add -A && git commit -m "revert ocr batch"
```

The site returns exactly to its pre-OCR state. That's why the OCR output lives in its own file
rather than being merged into `submissions.csv`.

---

## 11. Order of work

1. §1 prerequisites (user creates the Gemini key)
2. §2 smoke test — **hard gate**
3. §3 Tesseract, small run → checkpoint → full run
4. §5 paper audit (can run in parallel with §4, it needs no network)
5. §4 Gemini residue, daily, unattended
6. §7 report-a-problem link (small, ship it early — it makes every user a proofreader)
7. §6 syllabus tool, both halves
8. §8 Practice timer + compare-two

Report at every checkpoint. Do not skip §2, and do not scale past a checkpoint that failed.
