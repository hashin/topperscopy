# Decisions — why the code is the way it is

Append-only architecture decision records. The point of each one is not the decision (you can read
that off the code) but **the alternatives that were rejected, and what would make us reverse it.**
Without the reversal trigger, a future session cannot tell a live constraint from a fossil.

**To supersede a decision:** do not edit it. Add a new `DECISION-n` that says
`Supersedes DECISION-m`, and edit the old one's header to `SUPERSEDED by DECISION-n` — nothing else.
The reasoning that turned out to be wrong is the most useful thing in the file.

**Template:**

```
## DECISION-n — one line, in the present tense
*Date · status · cites INTENT-n*
**Decision.** What we do.
**Why.** The reasoning at the time.
**Rejected.** What else was on the table and why it lost.
**Reverse if.** The observation that would make this wrong.
**Enforced by.** The check, or "not checkable".
```

---

## DECISION-1 — Everything stays free, static and backend-less
*2025 (origin) · active · cites INTENT-4*

**Decision.** No server, no database, no accounts, no paid service in the request path. The whole
site is files on a static host; `build.js` generates them with zero runtime dependencies.

**Why.** The project is a non-commercial gift to the aspirant community. A backend means hosting
bills, which means either Hashin subsidises it forever or the site eventually has to monetise the
students it was built to help. Static also means it cannot really go down.

**Rejected.** A small API for search (would make the search problem trivial — see DECISION-7 — but
introduces cost, uptime obligations, and a rate-limiting surface). Firebase/Supabase free tiers
(free until they are not, and they own the data).

**Reverse if.** The dataset grows past the point where a static index can be delivered to a phone —
realistically several times its current size. Not close: the measured target after
`PERF-UX-AUDIT-2026-09-14.md` Phase 5 is 751 KB gzip for a fully searchable corpus.

**Enforced by.** `INV-6` (no blocking third-party script), and the absence of any runtime dependency
in `package.json`.

---

## DECISION-2 — Vanilla ES5-ish JavaScript. No framework, no bundler, no TypeScript.
*2025 (origin) · active · cites INTENT-2, INTENT-4*

**Decision.** `assets/app.js` is one plain script. No build step for the browser.

**Why.** The critical path is the product (INTENT-2). React + ReactDOM is ~40 KB gzipped before a
line of application code, on a connection where 25 KB decides whether the first cards paint. A
bundler also adds a build step between "edit a file" and "see it work", which matters for a project
maintained in occasional sessions.

**Rejected.** React/Preact (bundle cost, no benefit — this UI is a list and a dialog). A bundler for
minification alone (`app.js` is 23.8 KB gzipped as-is; minifying buys maybe 4 KB and costs
readability in a file that future sessions must read to understand).

**Reverse if.** `app.js` passes ~40 KB gzipped and the complexity is genuinely structural rather
than accumulated. The September 2026 audit found the real costs were payload and data structure —
**no framework would have prevented a single measured problem.**

**Enforced by.** `INV-5`, `BUDGET-app_js`.

---

## DECISION-3 — Third-party code is lazy, never on the critical path
*2025 (origin) · active · cites INTENT-2*

**Decision.** Fonts are self-hosted and latin-subset. GA loads `async`. pdf.js and Tesseract.js load
from CDN **only when the user opens the Submit analyser** and clicks.

**Why.** Tesseract is ~13 MB. A student browsing copies must never pay for a feature only submitters
use.

**Rejected.** Google Fonts (a third-party connection on the critical path, and no longer even a
shared-cache benefit since browsers partitioned their caches). Self-hosting Tesseract (13 MB in the
repo, for a rarely-used path).

**Reverse if.** GA is dropped entirely, at which point the two `preconnect`s in `<head>` should go too.

**Enforced by.** `INV-6`, `INV-12`.

---

## DECISION-4 — Generated output is never committed; CI regenerates it every deploy
*2026-09 · active · cites INTENT-6*

**Decision.** `data/copies.json`, `data/questions.json`, `toppers.html`, `topper/`, `question/`,
`sitemap*.xml`, `llms.txt`, `dataset/` and friends are gitignored. `.github/workflows/deploy.yml`
runs `node build.js` fresh on every push and deploys the result.

**Why.** These are ~110 MB per build. Committing them grew `.git` without bound and made every diff
unreadable. `index.html` is the one exception — it is tracked *and* rewritten by `build.js`, because
its `<!-- MARKER -->` blocks carry the counts that SEO and the `<noscript>` fallback need.

**Rejected.** Committing the generated files so the repo is servable without a build (readable
diffs and repo size lost). Git LFS (cost, and a clone-time dependency).

**Reverse if.** Never, realistically. Note the trap it creates: **the generated files must exist
locally for the checks to run**, so `node build.js` is a precondition for `npm run check`.

**Enforced by.** `INV-7`, `INV-8`.

---

## DECISION-5 — Copy and question ids must be stable across builds
*2026-09-09 (partial, as a build stamp) → to be completed by `PERF-UX-AUDIT-2026-09-14.md` Phase 4*

**Decision.** The id on a copy is the join key between three independently-cached files
(`index.json`, `copies.json`, the question index). It must therefore not change when unrelated data
changes.

**Why.** Ids were positional (`i: i++` in row order). Appending one submission row re-pointed **87 %
of them** — and because the three files are cached separately, a visitor could hold a mismatched set
and see one copy's card with another copy's questions, with "Open PDF · p.N" links to the wrong page
of the wrong PDF. Documented and reproduced as `AUDIT-2026-09-09.md` B1.

**What was done (B1).** A build-id stamp in all three files, and the app refuses to merge across
builds. This makes wrong data impossible but leaves three costs: the two big files must load in
series, a mismatch re-downloads 1.64 MB, and nothing can be cached long.

**What is still to do (Phase 4, I1).** Derive the id from a hash of the copy URL. That removes the
whole class of problem rather than defending against it. **Must include an explicit collision guard**
— 8,075 ids in a 32-bit space is a ~0.75 % birthday chance, and it grows with the corpus.

**Reverse if.** Nothing. The stamp is a workaround; the hash is the fix.

**Enforced by.** `INV-3` (uniqueness). Stability itself is checked by the repro in the audit's
Phase 4 "Verify" block — id churn must be **0**.

---

## DECISION-6 — Search must degrade, never lie
*2026-09-14 · active · cites INTENT-3*

**Decision.** While the index is still downloading, the UI must never render a count that implies
"no such question". Topper-name search works from `index.json` alone and must keep working
throughout.

**Why.** Measured: for 2.7 s on 4G (4.5 s on slow 3G) the interface read `0 copies for "federalism"`
— for a corpus containing 162 matching copies. A student reads "0" and leaves. This was judged the
single worst bug on the site, and it is a *wording* bug sitting on top of a payload problem.

**Rejected.** A spinner with no count (loses the topper-name results that are genuinely ready).
Blocking the search box until data lands (worse — it hides a working feature).

**Reverse if.** Never. If a future change makes a partial result set possible, say what is partial.

**Enforced by.** `INV-16` (browser check: must never render "0 copies" mid-load).

---

## DECISION-7 — Search is an inverted index, not a substring scan
*2026-09-14 · planned, `PERF-UX-AUDIT-2026-09-14.md` Phase 5 · cites INTENT-1, INTENT-2*

**Decision.** Ship a token-prefix inverted index (dictionary + delta-varint postings) and fetch
question *text* separately, only to display matches.

**Why.** The current design downloads 1.64 MB gzip of question prose so the client can run
`indexOf()` over it. The index that answers the same queries is **292 KB gzip** — measured, not
estimated (`node tools/perf/index-proto.mjs`). The text is needed to *show* ~25 results, not to
*find* them.

**Rejected.** Lunr/FlexSearch/MiniSearch (all build their index at runtime from the same full text,
so they do not reduce the download at all — they add to it). A search API (DECISION-1).
Client-side brotli via WASM (a ~200 KB decoder to save ~900 KB — defensible, but strictly worse than
just shipping less data).

**Known trade-off, accept deliberately.** Today's search is substring: `eral` matches `federalism`.
A token index is prefix: `fed` matches `federalism`, `eral` matches nothing. This is what every
search box a student has used behaves like, and mid-word matching mostly produces noise — but it
**is** a behaviour change, and the audit specifies a fallback path for zero-result queries.

**Reverse if.** `tools/perf/search-parity.mjs` shows real queries losing results that students
actually wanted. Write that script **before** changing the engine.

**Enforced by.** `BUDGET-search` (ceiling ratchets 2050 → 800 KB as this lands).

---

## DECISION-8 — `tools/` is repo-only and never deployed
*2026-09-14 · active · cites INTENT-4*

**Decision.** `tools/perf/` and `tools/check/` are excluded from the site artifact in
`deploy.yml`. `playwright-core` is a **devDependency** and is not installed by CI.

**Why.** The harness measures the site; it is not part of it. CI runs `node build.js` with no
`npm install`, so a devDependency cannot slow or break the deploy.

**Reverse if.** Never. If a check ever needs to run in CI, add a separate workflow — do not publish
the tools.

**Enforced by.** `INV-9`.


## DECISION-9 — A browser measurement is not trusted until it has been shown to fail
*2026-09-14 · active · cites INTENT-2, INTENT-6*

**Decision.** Before a perf/UX measurement is used to justify or verify a change, it must be shown
to produce the FAILING result against the unfixed code. A check that has never failed proves nothing.

**Why.** Implementing Phase 1 produced four separate wrong measurements, three of them for the same
item (P4, "Show more"):

1. An unwarmed, non-interleaved micro-benchmark said to hoist an `Intl.Collator`. Warmed and
   interleaved, that change is **~3x slower**. (Already recorded as audit P6 = NO ACTION.)
2. `showmore.mjs` scrolled with `element.scrollIntoView()` on the very button it then clicked and
   removed. It reported ~785px of drift **identically before and after the fix** — a number
   produced entirely by the instrument.
3. The same test then clicked a button that was off-screen, which no user does.
4. The same test called `window.scrollTo(y)` while the page sets `html { scroll-behavior: smooth }`,
   so every measurement was taken mid-animation. This reported drift of **2,167px and 4,635px** on
   code whose real drift is **0px**.

Chasing (2) and (4) produced two code changes — preserving the Show-more button node, and
`overflow-anchor: none` on `#results` — that were made on false diagnoses. The button-preservation
was kept on its own merits; the `overflow-anchor` rule was **A/B'd and removed**, because with a
correct instrument it made no difference. Shipping it would have been dead CSS justified by a
comment citing a measurement that was wrong.

**The specific traps, all real in this codebase:**
- `html { scroll-behavior: smooth }` — always scroll with `behavior: 'instant'` and wait for
  `scrollY` to stop changing (`settle()` in `tools/perf/showmore.mjs`).
- Deferred scripts run **before** `DOMContentLoaded`, so `waitForSelector` cannot reach the
  pre-boot window. To test it, hold `app.js` in flight with `page.route` (see
  `tools/perf/lost-keystroke.mjs`).
- Node identity (`dataset` tags surviving a re-render) is a far more reliable signal than any
  geometry measurement for "was this appended or rebuilt".
- CLS only manifests where the data is slow enough to arrive — measure it on **3G**, not 4G. An
  earlier version of `INV-17` measured on 4G and passed at CLS 0, while 3G was 0.193.

**Rejected.** Trusting a single measurement because it is large and confident-looking. Every number
in this repo's audit that survived was one that could be made to flip by reverting the fix.

**Reverse if.** Never.

**Enforced by.** Not checkable — it is a rule about how checks are written. The measurement notes
are kept as comments at the top of `tools/perf/showmore.mjs` and `tools/perf/lost-keystroke.mjs`,
where the next person will actually read them.

---

## DECISION-10 — Question text and meta are two independently-loaded promises, not one split file
*2026-09-14 · active · cites INTENT-2, INTENT-3, AUDIT T3*

**Decision.** `qmeta.json` and `qtext.json` (Phase 3/T3) are fetched by two separate functions
(`loadQuestionIndex()` / `loadQuestionText()`) with two separate promises (`qiPromise`/`qtPromise`)
and states (`qiState`/`qtState`), both started from the same trigger (`ensureQI()` now also calls
`ensureQText()`) but resolved independently. The variant table (a copy's own divergent wording)
moved into `qtext.json`, not `qmeta.json` — it's pure text, matched and displayed the same way as
the main question text, so it belongs with the prose it has nothing structurally in common with
meta rows. `sw.js`'s `DATA_HEAVY` regex was extended to also cache `qtext.json` (not just
`qmeta.json`, which is all the audit's own T3 section named) — leaving a ~1.26 MB file on the
default stale-while-revalidate path would re-fetch it over the network on every single visit,
defeating the entire point of the split.

**Why.** The audit's stated goal is that "qmeta.json alone unlocks the syllabus filter, the paper
filter, the question-first view's counts, and Practice question-picking" — a claim that only holds
if code reading `QI` items never assumes `.q` (text) is present just because meta arrived. Two
places did assume exactly that, and would have shipped visible bugs if untouched:
`fillQuestions()` (expanding a copy card) was waiting on `qiPromise` to decide when `qOf(c)` was
safe to call, but `qOf(c)` actually resolves through `QTEXT` — waiting on the wrong promise could
resolve while text was still empty and the card would be stuck on "Loading questions…" forever,
never retried. `nextPracticeQ()` and `questionCard()` read `q.q` directly, which no longer exists
on a qmeta row — left unfixed, Practice would show a blank question with tags and a working answer
list underneath, and the question-first view would show blank card headlines. Both are exactly the
"quiet lie" `DECISION-6` was written to prevent, just in an area `DECISION-6` didn't originally
cover (the question-first view and Practice, not the main copy search).

**Rejected.** Gating all text-dependent UI (Practice, question-first view) on `qtext.json` being
fully loaded, same as before the split, and only shipping the syllabus-filter/paper-filter win. This
was the *simpler and lower-risk* option, and defensible under "no more, no less" scope discipline
— but it silently drops the audit's explicit "Practice question-picking" claim. Chose instead to
let Practice's selection (id pick, streak bump, seen-list update) proceed off `qmeta.json` alone,
showing "Loading question text…" and backfilling that one DOM node in place
(`PENDING_PRACTICE_TXT`) once `qtext.json` resolves — verified with a scratch Playwright script
(not committed) that forces the race by polling "Another question" every 80ms from page load: the
streak bumps and a question is selected (`{"seen":{"GS2":[2517]}}`) tens of picks before `qtext.json`
could plausibly have landed, showing the placeholder, then the real text lands without re-picking.
The question-first view took the more conservative middle path: paper/syllabus filtering and the
*count* work off meta alone (verified: "8,102 questions" and a populated syllabus `<select>` before
any query and before `qtext.json` arrives), but rendering actual question cards still waits on text
— a card with no visible content is a worse failure mode there than in Practice, where tags and the
answer list underneath still give the user something real to look at while the headline backfills.

**Reverse if.** A future session finds the `PENDING_PRACTICE_TXT` single-slot backfill is
insufficient (e.g. a feature request to prefetch/preview multiple questions at once) — at that
point it should become a small queue, not a single pending slot.

**Enforced by.** Not directly checkable as a code rule; verified this session with three scratch
Playwright scripts (see `docs/SESSIONS.md`, not committed) rather than assumed from the audit's
prose, per `DECISION-9`. `INV-16`/`INV-17` (browser-based, `npm run check:all`) still cover the
original copy-search "never show a false zero" case.
