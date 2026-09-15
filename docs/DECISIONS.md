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
*2026-09-09 (partial, as a build stamp) → completed 2026-09-14 by `PERF-UX-AUDIT-2026-09-14.md`
Phase 4 / I1 — SUPERSEDED by DECISION-17 (the mechanism: hashed ids are gone, the PDF URL is the key;
the intent — a ref can never point at the wrong copy — is kept, and is now true by construction).*

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

**Done (Phase 4, I1, 2026-09-14).** Ids are now a hash of the copy URL (copies) or paper+canonical-
text (questions), each with an explicit collision guard, exactly as planned here. The build-id
stamp and every consumer of it (`fetchAtBuild`'s retry, `loadFull`'s drop-and-rebuild branch, T2's
reconcile branches, `sw.js`'s cache-buster branch) are deleted. `DECISION-11` covers what this
actually required beyond the one-line plan above.

**Reverse if.** Nothing. The stamp was a workaround; the hash is the fix, and it's done.

**Enforced by.** `INV-3` (uniqueness). Stability is verified by the repro in the audit's Phase 4
"Verify" block (id churn must be **0** — confirmed, extended to questions and question *text*, and
to a canonical-text-change scenario, not just an appended row).

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
*2026-09-14 · SUPERSEDED by DECISION-17 · cites INTENT-1, INTENT-2*

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
*2026-09-14 · SUPERSEDED by DECISION-17 · cites INTENT-2, INTENT-3, AUDIT T3*

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

---

## DECISION-11 — Question text/variants are id-keyed `Map`s in memory, id-keyed JSON objects on
the wire; variant ids are content-hashed too
*2026-09-14 · SUPERSEDED by DECISION-17 · cites DECISION-5, AUDIT Phase 4/I1*

**Decision.** `data/qtext.json`'s `text` and `variants` are JSON objects keyed by the (now-hashed)
id, not arrays indexed by it. `assets/app.js` parses them into `Map`s (`QTEXT`, `QVAR`, and their
lowercased twins `QTEXTLC`, `QVARLC`), not plain objects — `matchingQids()` scans these `Map`s and
returns `Map`s. Copy-side `variantRef()` in `build.js` now hashes the variant TEXT
(`-stableId('variant|'+text, ...)`), with the same collision guard as copy/question ids, replacing
the previous push-order `-(variants.push(t))` scheme.

**Why.** Three things, found implementing `DECISION-5`'s plan, none named in the audit's I1 section:

1. **qtext.json was still an array-by-id.** T3 (same session, landed just before this phase) built
   `qtext.json` as `text: [t0, t1, ...]`, indexed directly by question id — correct only because
   ids were `0..8101`. The audit's proposed hash id (~32-bit, up to ~4.29 billion) turns
   `QTEXT[qq.i] = text` and `new Uint8Array(QTEXTLC.length)` into an attempt to allocate a multi-GB
   structure on the first search — an immediate crash, not a subtle bug. T3 and this audit item
   were scoped in the same session before either was reconciled against the other.
2. **Variant ids had the identical id-drift problem I1 exists to remove.** `variantRef()`'s ids were
   a fresh push-order counter every build — build-local, not content-derived. A copy's own
   divergent-wording reference could resolve to the wrong text across a build skew between its
   `copies.json` and `qtext.json` (both cached independently) — the exact bug class this whole
   phase exists to eliminate, just relocated onto the variant id instead of the main qid.
3. **A plain object keyed by large sparse integers is measurably slow to scan.** A warmed,
   interleaved Node benchmark against the real corpus (8,102 entries, not synthetic data) — because
   an unmeasured assumption here is exactly what `DECISION-9` exists to prevent — showed
   `matchingQids()`'s per-keystroke scan costing **0.98 ms** on the old position-indexed
   `Uint8Array`, **3.6 ms** (+264%) on a plain object with the same ~8k entries keyed by hash id
   (`for...in`), and **1.0 ms** (+1–7%, noise-level) on a `Map` scanned with `.forEach`. `Map` was
   the only option that didn't trade the correctness fix for a real, felt regression.

**Rejected.**
- *Keep qtext.json's array shape, defer question-id hashing to a later phase.* Reintroduces a
  second id namespace (build-local array position vs. stable hash) exactly where `DECISION-5`
  wants one clean scheme, and Phase 5's index keys off question ids too — deferring only moves the
  same work later with more to reconcile by then.
- *`Object.keys()` + indexed loop instead of `for...in`.* Measured: 2.6–2.8 ms, a real improvement
  over plain `for...in` but still +170% over the array baseline — not good enough given `Map` gets
  to parity for the same amount of code change.
- *Leave variant ids build-local, accept the residual risk.* Rejected because it's the same bug
  I1 exists to fix, just smaller in blast radius (only a copy's own divergent rows) — "mostly
  fixed, with one deliberately-kept exception" is a worse design than "fixed," and the fix
  (hash the variant text) costs nothing extra once `stableId()` already exists.
- *Fork a legacy id scheme to keep `data/questions.json` alive for a stale pre-T3 `app.js`.*
  Covered separately — see `docs/SESSIONS.md`'s Phase 4 entry. Deleted instead; `ocr-pipeline.mjs`'s
  `audit-paper` (its one real internal consumer) now reads `qmeta.json`+`qtext.json` directly.

**Reverse if.** Phase 5's inverted index replaces `qtext.json`'s role entirely with a purpose-built
compact format (`qindex.bin`) — at that point this decision's `Map`-vs-object tradeoff may no
longer apply to whatever replaces it, but the *reason* (measure before trusting a data-structure
choice under load) still does.

**Enforced by.** Not a static check — verified this session (not committed): id-churn = 0 for
copies, questions, and question text across both an appended row and a canonical-text-change
scenario; the collision guard's retry-and-resolve path and its fail-loudly path both exercised
directly; 10 real copies / 89 rendered question rows cross-checked against raw `copies.json`+
`qtext.json` data with zero mismatches (the actual AUDIT-2026-09-09 B1 failure mode, checked
directly rather than inferred from id uniqueness alone); the warmed micro-benchmark above,
re-confirmed in-browser after the `Map` fix landed. `BUDGET-search`'s ceiling in
`tools/check/budget.json` carries the real, measured byte cost of id-keyed storage (+330.3 KB,
+19.1% over Phase 3) — reported honestly rather than optimized away, since Phase 5 is where
payload compactness is in scope, not here.

---

## DECISION-12 — `qindex.bin` indexes variants too; postings use local positions; qtext.json
drops out of the search-gating budget; "superset" only holds for exact-phrase pre-verification
*2026-09-14 · SUPERSEDED by DECISION-17 · cites DECISION-7, DECISION-9, PERF-UX-AUDIT-2026-09-14.md Phase 5/E1*

**Decision.** Four things not settled by the audit's E1 section or its Phase-4 addendum:

1. `writeQIndex()` indexes every variant (a copy's own wording the deduped question doesn't
   faithfully contain — 3,103 of them) alongside the 8,102 canonical questions, not canonical
   questions alone. Local positions `0..qCount-1` are canonical questions (qmeta.json's own
   order); `qCount..qCount+vCount-1` are variants, sorted by numeric id ascending for a
   deterministic build. The translation table's sign is implicit in which half a position falls
   in — no extra bit needed.
2. Postings reference the local position (per the addendum's own fix), and the translation
   table is one `uint32` per position, unsigned, in that same two-part order.
3. `data/qtext.json` is removed from `BUDGET-search`'s file list and `tools/perf/sizes.mjs`'s
   `SEARCH_GATING` — the index is what answers a query now; text only renders the snippet and
   arrives after.
4. The audit's Verify section says the new engine must return "a superset for prefix queries."
   Measured (`tools/perf/search-parity.mjs`), that's backwards for mode `'all'`: every token
   that starts with prefix P also *contains* P as a substring, so NEW is always a *subset* of
   OLD there — OLD is the noisier engine (DECISION-7 already says this: "eral matches nothing"
   is a subset relationship, not a superset one). The one place "superset" is actually correct
   is an exact-phrase query's *unverified* AND-candidate set, shown before qtext.json has landed
   (labelled "phrase not yet checked") — that candidate set is provably a superset of the final,
   text-verified answer, and collapses to exact equality once verification runs.

**Why.**

1. Today's substring scan matches against both `QTEXTLC` and `QVARLC` — dropping variants from
   the index would silently stop matching those ~3.1k copies' own divergent wording (an
   Essay quote set, a GS4 case study's specific sub-question) the moment the query didn't
   happen to also hit their group's canonical text, and the only way it would ever come back is
   the *fallback-on-zero-total-results* path, which wouldn't fire when other canonical
   questions still matched the same query. `tools/perf/search-parity.mjs` — built to catch
   exactly this class of silent loss (DECISION-9) — is what confirms this isn't happening.
2. Measured, not assumed: this costs real bytes. `qindex.bin` is 475.2 KB gzip production
   (629.9 KB raw, 14,779 tokens), not the addendum's 327.7 KB canonical-only re-measurement —
   postings grew from 255.6 KB to 388.6 KB gzip because variant texts are exactly the
   long, divergent, low-token-reuse strings (GS4 "three quotations" sets, Essay topics) that
   compress worst as postings, and the translation table grew from 31.7 to 43.8 KB gzip
   proportional to the extra ~3.1k positions.
3. With the index gating the answer instead of the text, `qtext.json`'s ~1.4 MB gzip genuinely
   no longer sits on the critical path to "how many copies, which ones" — keeping it in the
   budget would report a number nothing in the running app actually waits on, the same category
   of stale-input mistake `docs/MEMORY.md` exists to prevent.
4. Point 4 was checked by proof, not vibes: for a single term, `NEW_docs ⊆ {docs containing that
   term's completion word} ⊆ {docs containing the term as any substring} = OLD_docs`, and AND
   composes subsets into subsets. `search-parity.mjs`'s first version treated *any* OLD-only id
   as a failure and reported 72/210 queries "regressing" — all 72 turned out to be exactly this
   subset relationship (or, for phrase queries, a substring straddling a token boundary the same
   way "estate" contains "state" — "this achievement" contains the literal substring "is a"
   without either word being a real token there). Re-checked by testing whether the term(s)
   genuinely tokenize as real words/adjacent-sequences in the specific lost document, not just
   diffing id sets: 0 unexplained regressions across 210 real queries.

**Rejected.**
- *Canonical questions only, matching the addendum's one measurement.* Cheaper (327.7 KB vs
  475.2 KB) but a real, silent correctness regression for ~3,103 copies — rejected for the same
  reason DECISION-11 rejected "mostly fixed, with one deliberately-kept exception."
- *Keep qtext.json in the search budget as a conservative superset.* Defensible as "what a
  fully-rendered search needs," but the budget's own stated purpose is "everything that must
  land before a text query can be answered" — qtext.json no longer gates that answer, so
  including it reports a number that doesn't describe the running app, which is precisely what
  `docs/MEMORY.md`'s founding incidents (a stale README, a stale CLAUDE.md figure) warn against.
- *Force the audit's "superset" wording to hold by weakening the new engine's precision (e.g.
  also union in raw substring hits for short/common terms).* Would reintroduce exactly the
  noise DECISION-7 accepted removing, to make a Verify-step assertion true that measurement
  shows was never correct as stated for that case.

**Reverse if.** A future corpus makes variant text a much larger share of total content (right
now variants are a bounded, submission-shaped minority) — at that point canonical-only indexing
with variants left to the substring fallback might be worth revisiting on its own numbers, not
this session's.

**Enforced by.** `tools/perf/search-parity.mjs` (0/210 unexplained regressions, re-run any time
the engine or the corpus changes materially); `BUDGET-search` in `tools/check/budget.json`
(ceiling ratcheted to the real 1132.0 KB, not the un-measured 751/800 KB projection); the size
comment in `tools/check/budget.json`'s `"search"` bucket carries the full measured breakdown.

---

## DECISION-13 — R1's card reuse preserves real open state, not a recomputed default; R3's URL
sync reads "was empty" fresh, never caches it
*2026-09-14 · point 1 SUPERSEDED by DECISION-14, then by DECISION-17 (the keyed card reconciliation
it governed is gone); point 2 active, unchanged · cites DECISION-9, PERF-UX-AUDIT-2026-09-14.md Phase 6/R1, R3*

**Decision.** Two rules, both found necessary by testing rather than stated in the audit:

1. `getCard()` (R1) never recomputes a card's open/closed state from `copyCard()`'s own
   auto-open-on-match heuristic once that card has been rendered once. A rebuilt card (content
   changed, id unchanged) carries forward the reused element's actual current `.open` — via a new
   `forceOpen` parameter on `copyCard()` that overrides the heuristic outright, not one that only
   forces it *open* — so a user's manual close is respected exactly as much as a manual open.
   `cardSig()` (the fingerprint that decides whether a card needs rebuilding at all) returns a
   constant for stub and link-only cards specifically, because neither of `copyCard()`'s branches
   for those two shapes applies `forceOpen` — they predate it, and their rendered output never
   depends on the query anyway — so routing them through the query-dependent signature would
   force a pointless rebuild every keystroke that silently reverts them to closed.
2. `syncUrl()` (R3) determines whether the query was previously empty by reading
   `location.search` fresh on every call (`!u.searchParams.get('q')` against the URL as it
   currently stands), never from a module-level flag updated only inside the "URL actually
   changed" branch.

**Why.**

1. Manually testing R1 (not in the audit's own Verify block, which only checks long-task
   duration) found that a card the user had expanded closed itself on the very next keystroke:
   `wireBrowse()`'s input handler calls `renderBrowse()` with no `reopen` list, and every
   pre-R1 render recomputed `openIt` from scratch, discarding the user's own toggle. This is
   exactly `INTENT-3` ("no lost keystrokes… feel smooth"), just not a millisecond number — the
   kind of defect DECISION-9's discipline (measure before trusting a diagnosis, but also don't
   assume a fix's *only* value is the number in the audit) is written to surface. The first
   implementation only forced cards *open* when reused (matching `reopen`'s historical, open-only
   semantics) — verified against a link-only card specifically (which the R2 work happened to
   surface first, see "Phase 6 landed"): with `cardSig()` not yet special-casing stub/link cards,
   every keystroke rebuilt them via `copyCard()`, whose stub/link branches never read
   `forceOpen` at all, so a manually-opened link-only card silently closed on the next keystroke —
   the identical bug R1 exists to fix, reintroduced for one card shape by R1's own first draft.
2. `tools/perf/history.mjs` (built to verify R3, per DECISION-9) caught this directly: type a
   query (`pushState`, since the URL was empty), switch tabs and back (replaceState only, no
   effect on the query param), press Back (pops the one `pushState` entry — URL and app state
   both correctly revert to empty), then type a **second** query. The first implementation cached
   "was empty" in a module var, updated only when `syncUrl()`'s own "did the URL actually change"
   branch ran — but the Back navigation's `popstate` handler calls `syncUrl()` too, and at that
   point the URL is *already* back to empty, so that call takes the early-return path and never
   touches the cached flag. The flag stayed `false` from the first query, so the second query's
   first keystroke incorrectly used `replaceState` instead of `pushState` — collapsing what should
   have been a second, independent history entry into the same one the first Back had already
   consumed. A second Back on the second search then fell off the app's own history stack
   entirely, landing on `about:blank`. Reading fresh from `location.search` removes the cache
   altogether: correctness follows from the URL, which is always authoritative, instead of from
   keeping a second copy of the same fact in sync with it by hand.

**Rejected.**
- *R1: only ever force cards open, never force them closed (mirroring `reopen`'s pre-existing
  semantics).* This is what the first draft did — rejected once the manual test above showed a
  user's own close was just as important to preserve as their open, and doing so costs nothing
  extra (the reused element's `.open` is already known).
- *R1: give stub/link-only cards a real signature and just accept they rebuild every keystroke.*
  Simpler, but reintroduces the exact bug class this item exists to remove for a whole card shape
  — rejected for the same reason DECISION-11 rejected "mostly fixed, with one deliberately-kept
  exception."
- *R3: keep the cached flag but also update it inside `applyUrlToState()`/the popstate handler.*
  Works, but requires every future code path that can change the URL out from under `syncUrl()`
  to remember to keep the cache honest — a second place to get it right, for no benefit over
  reading the one authoritative source (the URL itself) directly.

**Reverse if.** Never, for either half — both are the direct fix for a reproduced bug, not a
style preference.

**Enforced by.** Not statically checkable. R1: verified manually (expand a card, type further
keystrokes, open/closed state survives; a link-only card specifically, before and after the
`cardSig()` fix; the Phase-5 placeholder-backfill interaction with `data/qtext.json` held via
`page.route` and released, confirming no duplicate card and no lost open state). R3:
`tools/perf/history.mjs` (new, committed) — 6/6 checks, including the specific two-Back sequence
that reproduced the `about:blank` bug; re-run any time `syncUrl()`/`applyUrlToState()` change.

---

## DECISION-14 — Four bugs found in a pre-merge review of the Phases 2–6 PR, fixed in the same
commit: a card's raw `.open` isn't "the user chose this"; `LAST_QSCORE`'s sign convention;
Practice's stuck loading state; Back navigation desyncing Browse from the URL across a tab switch
*2026-09-14 · SUPERSEDED by DECISION-17 · cites DECISION-9, DECISION-13, PERF-UX-AUDIT-2026-09-14.md
Phase 6*

**Decision.** Before merging the branch carrying Phases 2–6 into `main`, a genuinely independent
multi-angle review (8 finder angles, `code-review` skill at `high` effort, run against the full
`main...HEAD` diff) surfaced four real, reproducible bugs — three in this session's own R1/R3
work, one in Phase 5's already-merged-to-this-branch scoring code. All four were verified by
direct reproduction (not just source-reading) and fixed in the same commit as the review.

1. **`getCard()`'s `forceOpen` used a card's raw `.open` reading as "the user's real choice,"
   but a card that was simply rendered closed because there was no query yet is not a choice —
   it is `copyCard()`'s own prior default, indistinguishable from a manual close by inspecting
   `.open` alone.** Fixed with an explicit `tcTouched` flag, set only inside `copyCard()`'s
   summary click handler (a real user interaction), and checked by `getCard()` instead of the
   raw `.open` value: `forceOpen` is now only ever set from a *touched* element's state.
2. **`matchingQidsIndexed()` stored `LAST_QSCORE` keyed by `idxIdOf()`'s raw signed id (negative
   for a variant), but every reader (`filteredCopies()`, and `qhit.q`/`qhit.v` from the same
   function) uses a positive-normalized key** — so a query whose only match was a copy's own
   variant wording scored 0 under "Best match," indistinguishable from a non-match. Fixed by
   normalizing the write side to `Math.abs(idxIdOf(idx, p))`.
3. **`loadQuestionIndex()`'s completion handler dropped the paired `renderPractice()` call
   `loadFull()`'s analogous handler still has**, leaving the Practice dialog stuck on "Loading
   questions…" once `qmeta.json` landed, since `nextPracticeQ()`'s own early-return path never
   retries on its own. Fixed by restoring the pair.
4. **The `popstate` listener only resyncs `state.q`/`paper`/`syl` while `state.view === 'browse'`**
   (DECISION-13's own R3 work), so a Back navigation that lands while the user is on a different
   tab is silently missed — switching back to Browse then shows stale results with no visible
   connection to what the URL says. Fixed in `setView()`: compare the URL's q/paper/syl against
   in-memory state whenever arriving at Browse, and only resync (via `applyUrlToState()`) when
   they actually disagree — calling `applyUrlToState()` unconditionally on every tab switch was
   rejected (see below) because it also resets `state.shown`, which would silently discard a
   legitimate "Show more" expansion on every ordinary Browse→About→Browse click.

**Why.** All four were found by an agent-driven review specifically instructed to verify
candidates by reproduction, not by trusting a plausible-sounding trace — and #1 in particular
*looked* correct from source alone (a manual test of the exact scenario named in DECISION-13's
own "Enforced by" section — expand a card, type further, state survives — passed both before and
after this fix, because that test never exercised a card that had *never* been touched becoming a
*new* match, only cards already known to be name-hits or already-matching). This is the same
lesson DECISION-9 exists to generalize: a test that passes proves the scenario it covers, not the
scenario it was meant to stand in for. Root cause for #1 and #4 both: state (`.open`, `state.q`)
was read as if it always meant "chosen by the user," when large parts of this codebase set it
programmatically too — the fix in both cases is to track *provenance* (was this a real user
action) rather than trust the current value's shape alone.

**Rejected.**
- *#1: keep `forceOpen = existing.open` but add an extra check for `nameHit`/other heuristics to
  guess when a card "should" have auto-opened.* Fragile and gets more special-cased with every
  new match type; a real touched/untouched distinction is the general fix.
- *#4: call `applyUrlToState()` unconditionally whenever `setView('browse')` runs.* Simpler, but
  verified live to reset `state.shown` (discarding "Show more" pagination) on every ordinary tab
  switch, not just the Back-navigation-elsewhere case it needs to fix — rejected once measured,
  not assumed safe.
- *#4: make `popstate` resync regardless of `state.view`.* Would fix the specific bug but
  re-renders `#results` while the user is looking at a different tab, for no visible benefit —
  the targeted comparison in `setView()` only does the (cheap) work when it's actually needed.
- *Leave any of the four as "documented, not fixed."* Considered for all four, applied to the
  four lower-severity/pre-existing findings from the same review (see the review's own report:
  the `FALLBACK_USED` scoring gap, name-hit vs. text-match ranking, a `DB` null-deref race in
  `boot()`, and the `INV-16` false-zero window before `qtext.json` loads) — all real, but each
  either degrades gracefully, is a product judgment call, self-heals, or needs more design work
  than a pre-merge review pass should absorb without its own dedicated scrutiny. The four fixed
  here were fixed because they are contained, freshly-understood (three are this session's own
  code), and user-visibly wrong in ordinary use, not edge cases.

**Reverse if.** Never, for the four fixes. The four *deferred* findings are candidates for a
future phase; revisit them with the same review discipline (reproduce before fixing) rather than
patching from the trace alone.

**Enforced by.** Not statically checkable — all four verified by direct reproduction with
throwaway Playwright scripts (not committed) before and after each fix: #1 via console-traced
`getCard()`/`copyCard()` calls against a real content match on a never-touched card; #2 via
`tools/perf/search-parity.mjs` (still 0/210 unexplained regressions after the fix); #3 read from
source (low-risk, mirrors the already-tested `loadFull()` pattern exactly); #4 via the literal
search→About→Back→Browse sequence, plus a no-regression check that plain tab-switching leaves
"Show more" pagination untouched. `npm run check:all` (24/24 enforced) and
`tools/perf/history.mjs` (6/6) re-run clean after all four fixes landed together.

---

## DECISION-15 — The four findings DECISION-14 deferred are fixed: fallback searches now score,
name matches outrank text matches, `boot()`'s `DB` race is closed, and the last `INV-16` gap
(substring fallback before `qtext.json` loads) is covered
*2026-09-14 · SUPERSEDED by DECISION-17 · cites DECISION-6, DECISION-7, DECISION-9, DECISION-14*

**Decision.** All four findings DECISION-14 deferred are fixed, each verified by direct
reproduction before and after (not from the trace alone — the same discipline DECISION-14 itself
asked for on revisit):

1. **The substring-fallback path (`matchingQidsSubstring`, DECISION-7) never populated
   `LAST_QSCORE`, so every fallback-triggered search tied at score 0 under "Best match."** New
   `scoreFallbackMatches(hitMaps, expansions, N)` reuses the `expansions` array `matchingQidsIndexed()`
   already computed — its per-term document frequency is still meaningful even when the index
   itself found no candidates — for a flat idf-sum score applied to every fallback match. A term
   the index has never seen (`df=0`) scores maximally rare, which is the right call: the fallback
   exists precisely for text the index can't describe. Matches from one fallback query still tie
   with each other (the substring scan has no way to rank within its own results); this only stops
   them tying with "no match" too, and stops them being invisible when mixed with real name-hit
   or indexed-match scores in the same render.
2. **`filteredCopies()` never assigned a score to `nameHit` copies, so an exact topper-name match
   always ranked behind any copy with a nonzero in-text score under "Best match."** New
   `NAME_HIT_SCORE` constant (`1e6`, declared with the other module constants — far above any
   realistic idf-sum, worst case ~9.3 per term) is used as `nameHit` copies' score instead of 0.
   Name hits now always sort first under "Best match"; among themselves they still tie and fall
   through to the year/AIR order, same as before.
3. **`boot()` could call `ensureFull()` (and thus `loadFull()`, which unconditionally dereferences
   `DB.copies`) before `DB` was assigned by `boot()`'s own `index.json`/`toppers.json`/
   `optionals.json` fetch**, on a fast repeat visit where `copies.json` resolves from the
   service-worker cache before those three do. New `dbReadyPromise`, assigned synchronously at the
   top of `boot()` — before the `?q=`/`?syl=` handling that can call `ensureFull()`/`ensureQI()` —
   holds that fetch chain; `loadFull()` now does `Promise.all([dbReadyPromise, copiesJson])`
   before touching `DB`, instead of assuming it already exists.
4. **The `!acc.size` branch of `matchingQidsIndexed()` — the index found zero prefix candidates —
   returned empty maps outright when `QTEXTLC` hadn't loaded yet, instead of signalling that the
   substring fallback (which needs that same text) simply hadn't had a chance to run.** This read
   to `renderBrowse()` as a CONFIRMED zero, printing "0 copies for X" for a query the fallback
   might yet answer — the exact bug `INV-16`/DECISION-6 exist to prevent, in a window that check
   (and the earlier E1/DECISION-12 work) never covered. New `SUBSTRING_PENDING` flag (same pattern
   as `FALLBACK_USED`/`PHRASE_PENDING`, reset alongside them), read into `renderBrowse()`'s
   `loading` computation, so this specific window now shows "Searching inside N copies…" instead.

**Why.** All four were exactly as DECISION-14 described them: real, but each needing either a
scoring design (#1, #2) or a careful ordering fix (#3) or a new pending-flag (#4) rather than a
quick patch — the reason they were deferred rather than folded into the original pre-merge pass.
Fixing them properly, on their own, with room to verify each by reproduction rather than by
re-reading the same trace that found them, is exactly the "future phase, same review discipline"
DECISION-14's own "Reverse if" asked for.

**Rejected.**
- *#1: score fallback matches per-document somehow (e.g. count of matched terms actually present
  in that document's text).* The substring scan (`matchingQidsSubstring`) doesn't retain
  per-document term-match detail, only a yes/no hit — recovering it would mean re-scanning each
  matched document's text a second time, real cost for a rarely-hit path (DECISION-7's fallback is
  already the last resort). The flat idf-sum is free (the data is already in hand) and correctly
  ranks a fallback match above "no match," which is the actual bug being fixed.
- *#2: derive `NAME_HIT_SCORE` from something proportional to match quality (e.g. exact full-name
  match vs. a partial one).* `matchName()` is a simple all-terms-substring check with no notion of
  "how exact," and building one just for ranking weight is more machinery than the actual need —
  a name match should simply win, not be finely graded against other name matches.
- *#3: guard every `DB.copies` access with a null check instead of fixing the ordering.* Papers
  over the actual bug (a promise race) with defensive checks at every call site, and a null check
  can't tell "not loaded yet" from "loaded, this copy is legitimately gone" — the ordering fix
  removes the race rather than working around its symptom, in keeping with DECISION-14's own
  "track provenance" lesson.
- *#4: give `SUBSTRING_PENDING` a distinct resultmeta suffix (like `FALLBACK_USED`'s "no word
  match" label or `PHRASE_PENDING`'s "phrase not yet checked").* Unnecessary — the flag only
  needs to feed `loading`, and the existing "Searching inside N copies…" / "· still scanning
  inside the copies…" messaging already covers every case `loading` is true, including this one.
  A distinct label would explain nothing a student needs to act on differently.

**Reverse if.** Never — these are direct fixes for reproduced bugs DECISION-14 already
established were real, not style preferences up for revisiting.

**Enforced by.** Not statically checkable — verified by direct reproduction with throwaway
Playwright scripts (not committed): #1 confirmed via a temporary debug log of `LAST_QSCORE`'s
contents after a fallback query (score 9.32, matching the expected max-rarity idf for a term with
zero index document-frequency; removed before commit); #2 confirmed live (searching "ram" surfaces
name-matching toppers in the first 3 results, ahead of coincidental text matches); #3 confirmed by
reproducing the exact race — holding `data/index.json` in flight while `data/copies.json` resolves
immediately reproduces a **second, wasted fetch of `copies.json`** on the pre-fix code (the silent
crash-and-retry signature: `loadFull()`'s own `.catch()` swallows the `TypeError` on `DB.copies`,
setting `fullState='error'` and `fullPromise=null`, so `scheduleFull()`'s later idle callback
re-fetches from scratch) — and confirmed gone (single fetch) on the fixed code, same reproduction;
#4 confirmed via `data/qtext.json` held in flight (resultmeta reads "Searching inside N copies…",
not a confirmed zero) then released (resolves correctly to the fallback's real count and "no word
match" label). `tools/perf/search-parity.mjs` (0/210 unexplained regressions) and
`tools/perf/history.mjs` (6/6) re-run clean; `npm run check:all` 24/24 enforced.

---

## DECISION-16 — DECISION-15's #4 fix (`SUBSTRING_PENDING`) only covered "All words" mode; "Exact
phrase" mode had the identical false-zero window, unfixed
*2026-09-15 · SUPERSEDED by DECISION-17 · cites DECISION-6, DECISION-14, DECISION-15*

**Decision.** Pre-merge review of PR #6 (the branch carrying DECISION-15's four fixes) found one
more real, reproducible bug in `matchingQidsIndexed()`: the `mode === 'exact'` branch has its own
"index found nothing, fallback scan needs `QTEXTLC` and it hasn't loaded yet" case, and unlike the
`else if (!acc.size)` branch a few lines below it (DECISION-15's #4), it did not set
`SUBSTRING_PENDING` — it fell straight through to `return signedMapsFromPositions(idx, acc)` with
`acc` still empty, which `renderBrowse()` reads as a **confirmed** zero. Fixed by adding the same
check DECISION-15's #4 uses, guarded on `!verified.size` (true exactly when `acc.forEach` above
matched nothing — either because `acc` started empty, or because a nonempty `acc` verified against
text and came up empty; the `acc.size && !QTEXT` guard two lines above already returns early via
`PHRASE_PENDING` for the one case where `QTEXTLC` could be null with a nonempty `acc`, so by the
time execution reaches `!verified.size`, `QTEXTLC` being falsy only ever means `acc` was empty from
the start):

```js
if (!verified.size) { SUBSTRING_PENDING = true; return { q: new Map(), v: new Map() }; }
```

placed right after the existing `if (!verified.size && QTEXTLC) { … fallback … }` check, so it only
fires when that check's `QTEXTLC` condition was the reason it didn't run.

**Why.** DECISION-15's own "Enforced by" section for #4 says it was "confirmed via `data/qtext.json`
held in flight" — but that reproduction (like the fix itself) only exercised the default "All
words" mode. Verified directly with a throwaway Playwright script (`tools/perf/_lib.mjs`'s
`serve()`/`openPage()`, `page.context().route('**/data/qtext.json', …)` held via an unresolved
route, never fulfilled until the test explicitly continues it): typing a query with one term not a
prefix of any indexed token (`"zzzqxvvzyzzqx federalism"`) in "All words" mode correctly shows
"Searching inside 9,082 copies…" while `qtext.json` is held; switching to "Exact phrase" mode and
typing the same query showed **`"0 copies for "zzzqxvvzyzzqx federalism""`** — a confirmed
false zero, identical in kind to the bug DECISION-6/INV-16 exist to prevent and DECISION-15's #4
was written to close the last gap of. After the fix, the same script shows "Searching inside 9,082
copies…" in exact mode too, while held, and resolves correctly once `qtext.json` is released. This
is the same lesson DECISION-9/DECISION-14/DECISION-15 keep re-teaching: a fix verified by
reproducing *one* path (here, one of two search modes) does not prove the sibling path is also
fixed, even when the code sits three lines away and looks like it should be symmetric.

**Rejected.**
- *Make `mode === 'exact'` fall through into the shared `else if (!acc.size)` branch instead of
  duplicating the check.* The two branches compute different things before reaching this point
  (`verified` vs raw `acc`) and merging them would need restructuring the whole `if/else if`, for a
  three-line duplication that is already commented as deliberately mirroring its sibling — not
  worth the churn for a bugfix commit.
- *Broaden the condition to `else if (!verified.size && !QTEXTLC)` for explicitness.* Logically
  identical (by the time this line runs, `!verified.size` already implies `!QTEXTLC` — the `if`
  right above it would have returned otherwise) but adds a redundant check a reader has to verify
  is actually redundant; the comment explains the invariant instead.

**Reverse if.** Never — direct fix for a reproduced bug, same class as DECISION-15's #4.

**Enforced by.** Not statically checkable — verified by direct reproduction (throwaway Playwright
script, not committed): exact-mode query with `data/qtext.json` held via `page.route`, before the
fix showed a confirmed "0 copies" string, after the fix shows "Searching inside N copies…" and
resolves correctly on release. Control run in "All words" mode (unaffected by this bug) confirmed
unchanged. `tools/perf/search-parity.mjs` (0/210 unexplained regressions) and
`tools/perf/history.mjs` (6/6) re-run clean after the fix; `npm run check:all` 24/24 enforced,
`BUDGET-app_js` 35.2 KB / ceiling 36 KB (no ceiling change needed).

---

## DECISION-17 — Two data shapes, one search engine: the copy URL is the key, question text is
plain per-paper shards, and search is `indexOf` over the loaded shards
*2026-09-15 · active · supersedes DECISION-5 (mechanism), DECISION-7, DECISION-10, DECISION-11,
DECISION-12, DECISION-13 (point 1), DECISION-14, DECISION-15, DECISION-16 · cites INTENT-1, INTENT-2,
INTENT-3, INTENT-6, INTENT-8*

**Decision.** The site serves two kinds of data file and nothing else:

1. `data/copies.json` — every copy (searchable GS/Essay, link-only, and optional-subject with the
   subject as its paper), grouped by topper, with AIR / year / marks resolved at build time. A copy
   row is `[paper, source, url, questions, linkOnly, note?]`. **The PDF URL is the copy's key.**
   There is no id: nothing to mint, hash, guard or reconcile.
2. `data/questions-<paper>.json`, one per paper (`gs1 gs2 gs3 gs4 essay other optional`) — deduped
   question text, each with the copies and pages that answer it as `[urlIndex, page]` into the
   shard's own URL table, plus syllabus node ids, marks and words. A second array, `fragments`,
   holds rows that are real parts of a copy but not questions in their own right (GS4 case-study
   sub-parts, orphan "(b)" rows) — searchable and shown on the copy's card, but no question page,
   Questions-view entry or Practice slot, exactly the rule `writeQuestions()` always applied.

Dedupe is a containment merge: bucket by paper + the first 60 normalised characters; inside a
bucket, longest text first, a text that is a substring of an already-kept text merges into it
and its refs move over — unless the longer text carries on with another numbered question right
after it (an essay test's topic list is not a longer version of one topic). Every ref survives:
28,257 in, 28,257 out. There is no variant table; a distinct wording is a distinct question.

The client boots from `copies.json` alone (browse + topper-name search work immediately), then
prefetches every shard on idle (later on a 2G / Save-Data connection, but never skipped) and at
once on search focus, first keystroke, card expand, Questions view or Practice. A text query is
`indexOf` per term over every question in every loaded shard the paper filter allows; "Exact
phrase" tests the joined query. A shard ref whose URL is not in `copies.json` is dropped when the
shard is indexed. While a needed shard is still downloading, `#resultmeta` says "Searching inside
N copies…" and never prints a zero — DECISION-6 is now one boolean, not three flags. "Best match"
scores a name hit as a large constant, otherwise the number of matched questions in the copy,
plus 0.5 when one of them contains the whole phrase. Rendering rebuilds the first `state.shown`
cards on every change and re-opens the ones that were open. `sw.js` is one stale-while-revalidate
strategy for every same-origin GET, with the shell and `copies.json` precached.

Deleted: `index.json`, `toppers.json`, `qmeta.json`, `qtext.json`, `qindex.bin`, the variant
table, `stableId()` and its collision guard, the five per-file load state machines, the
inverted-index reader and its prefix expansion, idf/BM25-lite scoring, the substring fallback and
its three pending flags, stubs, `CARDMAP`/`cardSig`/`getCard`/`tcTouched`/`reconcileBrowseList`,
`tools/perf/`, `tools/check/` and the `playwright-core` devDependency. `optionals.json` is no longer
served — the app reads copies.json.

**Why.** Hashin, 2026-09-15 (INTENT-8): "I genuinely suspect that we have overengineered many
stuff through the periodic audits… I want to be able to completely read and understand this
code." The audit had optimised the wrong number. It minimised *bytes before a count can be shown*
and shipped five independently-cached files — plus DECISION-13 through DECISION-16, all bug-fixes
to the machinery that kept those five files from lying to each other. The number a student feels
is *bytes before a complete result is on screen*, and there the old design was worse:

| | before (gzip) | after (gzip) |
|---|---:|---:|
| boot data | 89 KB, but only 1,063 of 9,117 copies; the rest arrived later as stubs | 184 KB, every copy, every topper name searchable |
| full result for a text query | 487 + 171 + 491 + 1,449 = 2,598 KB across four files | one shard: GS1 177 · GS2 162 · GS3 107 · GS4 601 · Essay 23 · Other 26 · Optional 7; all seven 1,102 KB |
| search engine | inverted index + prefix expansion + BM25-lite + substring fallback, ~400 lines | `indexOf` over ~9.3k strings, ~1 ms per keystroke (the audit's own measurement) |
| variants | 3,135 negative-id texts | 0 |
| `app.js` | 2,214 lines, 35.2 KB | 1,177 lines, 20.9 KB |
| `build.js` | 1,635 lines | 1,325 lines |

`qindex.bin` never made search faster — it made the count appear earlier while *increasing*
total bytes. Copy ids cost 68 KB gz of the boot file on their own: random 10-digit numbers do not
compress, URLs (which the file needs anyway) do, and a URL is already unique per copy.

**Rejected.**
- *Keep the inverted index.* It answered "how many" ~1 s sooner on 3G and cost 479 KB more to get
  to a result on screen, plus the reader, the fallback, and three pending flags. The 1 ms scan is
  not the bottleneck; the download is.
- *Keep the variant table.* It existed because dedupe keyed on the first 110 chars and then had to
  paper over the texts that key lumped together. Merging on full normalised text with containment
  needs no variants; a distinct wording becomes its own question (8,183 → 8,654 questions, 3,835 →
  3,847 indexable pages).
- *Keep content-hash copy ids (DECISION-5's mechanism).* Measured: −68 KB gz at boot for nothing —
  a ref keyed by URL cannot point at the wrong copy either, and needs no collision guard.
- *A search API.* Still DECISION-1: no backend.
- *Split the Browse tab from the Optionals tab at the data level.* One copies file, one card
  renderer; the Optionals tab is a subject picker over the same list. Optional-subject copies now
  also answer the main search box (an "Optionals" paper chip filters to them) — a product-visible
  change, made because the owner's stated goal is a completely searchable site.

**Reverse if.** The corpus grows past roughly 3× — a per-paper shard no longer fits a phone budget
(GS4 is already 601 KB gz; past ~1.5 MB split it by year or by syllabus node, still plain text,
still `indexOf`). Or the `indexOf` scan measurably exceeds ~10 ms per keystroke on a mid-range
phone. Neither is close.

**Enforced by.** `tools/check.mjs`: INV-3 (a URL appears in exactly one copy), INV-4 (every
shard ref resolves to a copy — 28,257 refs), the per-shard and boot gzip budgets, and the
README-honesty check that fails if the README ever names a deleted file or engine again.
Verified this session (throwaway scripts, not committed): search parity against
`dataset/questions.csv` for 210 real queries — 138 identical, 71 strict supersets (containment
recovered a fuller text), 1 exact-phrase query lost 5 copies where the phrase only ever matched a
missing ")" in one scrape of an otherwise identical question; static pages — the sampled topper
and question pages byte-identical to the `main` build apart from the timestamp.

---

## DECISION-18 — A query's terms are split between the topper's name and the question text
*2026-09-15 · active · cites INTENT-8, DECISION-17*

**Decision.** In `filteredCopies()`, the terms a copy's topper name already contains are removed
from the query and only the *rest* has to be found inside that copy's questions. So `shakti dubey`
is a plain name hit, `dubey ethics` is Shakti Dubey's copies whose questions mention ethics, and
`federalism` is every copy with such a question. Text hits are scanned once per distinct "rest"
(`hitsFor()`), which in practice is one or two scans per keystroke.

**Why.** Hashin's stated need is "questions answered by a specific topper". Before this, every
term had to match *either* the whole name *or* the text — `dubey ethics` returned **0 copies**
(verified live on the PR branch, and the same on `main`). The topper `<select>` covered the case,
but no student discovers a dropdown when the search box says no.

**Rejected.** Leaving it to the topper dropdown (invisible to the user who needs it). A separate
"topper:" query syntax (nobody would type it). Fuzzy name matching (a different, larger problem).

**Reverse if.** Common-word names cause visible false positives — e.g. a topper called "Ram" making
`ram temple` rank their copies first. If that happens, require a name-term to match a whole word of
the name, not a substring.

**Enforced by.** Not statically checkable; verified live: `federalism` 171 copies (unchanged),
`shakti dubey` 29 by name (unchanged), `dubey ethics` 1 copy · 2 questions, `nehara federalism`
1 copy · 2 questions, `aditya srivastava federalism` 0 (correct — none of his 25 copies has one).
