# Session log

Append-only, newest at the bottom. One entry per working session. Keep it short — this is a trail
for the next session, not a report. Five lines is a good entry.

**Template:**

```
## YYYY-MM-DD — one-line title
**Asked.** What Hashin wanted, briefly.
**Did.** What actually changed. Commits if useful.
**Learned.** Anything surprising — especially anything that contradicted what we believed.
**Left.** What the next session should pick up, and anything deliberately not done.
```

The **Learned** line is the valuable one. "We measured X and it was actually Y" is exactly the kind
of fact that dies with a chat session and costs the next one a day.

---

## 2026-09-09 — Correctness audit (B1–B21)
**Asked.** A rigorous audit of the site for real bugs.
**Did.** Found and fixed 21 issues, `AUDIT-2026-09-09.md`. The serious one was B1: positional copy
ids meant a cache skew could show one copy's card with another copy's questions and wrong "Open PDF"
page links. Fixed with a build stamp plus a refuse-to-merge-across-builds check.
**Learned.** Appending a single submission row re-pointed 87 % of copy ids. The three data files are
cached independently, so mismatched sets are routine, not theoretical.
**Left.** The build stamp is a workaround, not a fix — the real answer is content-derived ids
(now `DECISION-5`, scheduled as audit Phase 4).

## 2026-09-14 — Performance and UX audit
**Asked.** Comprehensive performance and UI audit; speed and search usability called out as
critical; document it so a later Sonnet session can implement it in order.
**Did.** `PERF-UX-AUDIT-2026-09-14.md` — 22 items in 7 phases, each sized for one session. Built
`tools/perf/` so every number is reproducible. Corrected the stale Cloudflare estimate in `CLAUDE.md`.
**Learned.** Three things worth remembering:
1. First paint is already good (FCP 676 ms on 4G). The problem is *entirely* search — 1,994 KB gzip
   must land before the first query resolves, and during that wait the UI reads `0 copies`.
2. `README.md` documented three optimisations that **do not exist** (`content-visibility`, a
   prefetch, a Fraunces preload), and `CLAUDE.md` put the Brotli payoff at 137 KB when the measured
   figure is 1,078 KB. Both were only caught by measuring. This is why `INV-15` exists.
3. An unwarmed micro-benchmark told me to hoist an `Intl.Collator`. Warmed and interleaved, that
   change is **3× slower**. Recorded as audit P6 = NO ACTION so nobody re-discovers it wrongly.
**Left.** Nothing implemented — the audit is the deliverable. Phase 1 is ten small diffs and is most
of the felt improvement; start there, not with the search engine.

## 2026-09-14 — Project memory + invariant checks
**Asked.** "There should be a central source of truth inside the repository that learns from my
requests across various chat sessions. The testing must be aligned to the ideas shared there." Plus:
design the repo so context and reasoning survive a new chat session.
**Did.** Added `docs/` (this file, `MEMORY.md`, `INTENT.md`, `DECISIONS.md`, `INVARIANTS.md`) and
`tools/check/invariants.mjs` + `budget.json` — 20 checks, each citing the `INTENT-n`/`DECISION-n` it
protects, with an `enforced` / `tracked` split so the same file is both a regression guard and a
live to-do list. Rewrote `README.md` against measured numbers. Routed `CLAUDE.md` at `docs/MEMORY.md`.
**Learned.** Writing the checks immediately found two things the human audit had missed: `llms.txt`
carries **no upsckata credit** despite `CLAUDE.md` requiring it (now audit P11), and `llms.txt`
links to `data/questions.csv` — the 8.94 MB file audit item **D1** proposes to stop deploying, so
landing D1 alone would ship a 404 to every AI crawler. Writing an assertion is a better audit than
reading the code.
**Left.** All 23 audit items still to implement (P11 was added by this session). `npm run check`
shows **14/14 enforced passing, 0/8 tracked** — the correct starting state, with the tracked count as
the progress bar. `docs/IMPLEMENTATION-PROMPT.md` is the prompt to paste into the next session; one
phase per session, Phase 5 alone.


## 2026-09-14 — Phase 1 implemented (P1–P11)
**Asked.** Hashin started a Sonnet session on Phase 1; it came back with nothing. Cause: that
session was attached to **hashin/hashin.github.io** (the blog), not **hashin/topperscopy** — none of
the files it was told to read exist there. `docs/IMPLEMENTATION-PROMPT.md` has been fixed to make
the repo attachment explicit and to require a "prove you are in the right repo" step first.
**Did.** All of Phase 1 except P6 (which is NO ACTION by design). Measured results in
`PERF-UX-AUDIT-2026-09-14.md` under "Phase 1 landed". Highlights: CLS 0.193 → **0.0014**; the false
"0 copies" is gone; "Show more" moves the reader **0 px** (was up to 785 px); a query typed before
`app.js` boots is now adopted. `npm run check` went 14/14 enforced → **22/22**, with six tracked
invariants promoted and two new ones added (INV-18, INV-19).
**Learned.** The instruments were wrong more often than the code. Four separate false measurements,
three of them on the same item — the worst reported 4,635 px of drift on code whose real drift is
**0 px**, because `html { scroll-behavior: smooth }` means `scrollTo` animates and everything was
measured mid-animation. Two code changes were made on those false diagnoses; one was kept on its own
merits, the other (`overflow-anchor: none`) was A/B'd and **removed** once the instrument was fixed.
Also: you cannot test the pre-boot window by waiting for `#q` — deferred scripts run before
`DOMContentLoaded`, so the app has already booted; you have to hold `app.js` in flight with
`page.route`. All of this is now `DECISION-9`, with the traps written at the top of the two scripts
that fell into them.
**Left.** Phase 2 (D1–D3) next; D1 now has a second half, because `llms.txt` linked to the file it
removes. Phases 3–5 are where the payload actually shrinks. Two tracked invariants remain: INV-13
(D1) and INV-14 (R3).


## 2026-09-14 — Phase 1 merged to main; Phase 2 (D1, D3) implemented
**Asked.** Merge Phase 1 to `main`, then continue with Phase 2.
**Did.** Fast-forwarded `main` to the Phase 1 work (5 commits, `d60292c..20ac2a1`) — that is the
first production deploy of the audit fixes. Then D1 and D3. D2 is a hosting decision for Hashin,
not code, and is left open.
- **D1** — `data/questions.csv` (8.94 MB) no longer ships. It had *two* live links, not one: the
  `llms.txt` reference was removed with P11, and the **About tab in `index.html` also linked to it**
  and would have 404'd. Both now point at `/dataset/questions.csv`, the canonical download.
- **D3** — a build-skew refetch (`?b=<id>.<ts>`) is now stored under the clean url, so a visitor
  after a nightly OCR commit no longer pays 1.64 MB twice and keeps nothing. `sw.js` → `tc-v23`.
**Learned.** `INV-14b`, which I wrote last session specifically to catch exactly this class of
problem, **only scanned `llms.txt`** — it would have passed while D1 shipped a 404 in `index.html`.
A check that covers one of two surfaces is a check that gives false confidence. It now scans both,
and was verified to go red against the un-fixed link. Same discipline as DECISION-9: every check
added this session (INV-20, `tools/perf/sw-double.mjs`) was shown to FAIL against the old code
before being trusted.
**Left.** D2 (hosting) needs Hashin's call — see audit D2; nothing else blocks on it, because
Phases 3–5 are hosting-independent. Phase 3 (T1–T4) is next and is where the payload actually
starts shrinking. One tracked invariant remains: INV-14 (R3, Phase 6).

## 2026-09-14 — Phase 3 (T1–T3 landed, T4 deliberately skipped)
**Asked.** Implement exactly Phase 3 of the audit — no more, no less; T4 is optional and the audit
argues against doing it without Phase 6 profiling data, which doesn't exist yet.
**Did.** T1 (dropped `sl` from `questions.json`, −206 KB gz), T2 (`copies.json`/`questions.json`
fetch in parallel — extended in the same commit to cover the T3 split too), T3 (split
`questions.json` into `qmeta.json` (109 KB gz, meta-only) + `qtext.json` (1.26 MB gz, text +
variants), fetched together but resolved independently). Search-gating payload 1,998.8 → 1,728.2 KB
gz. `BUDGET-search` ceiling ratcheted 2050 → 1785 KB. `npm run check:all` 24/24 enforced (unchanged
count — no invariant was tied to Phase 3 specifically; the ratchet is the enforcement). See
"Phase 3 landed" in the audit doc for the full table, and `DECISION-10`.
**Learned.** This branch's local checkout was stale at session start — three individual git
commits (cc48ef2/eeef2bd/c423bc0) that origin had already squashed into "Phase 1 (P1–P11)" plus a
separate "Phase 2 (D1, D3)" commit, alongside an uncommitted local WIP diff that was an *earlier,
inferior draft* of the same P4 fix already properly landed upstream (with a `mark` param and
`LASTCOUNT`, which the local draft lacked). Stashed the draft, hard-reset to
`origin/claude/intelligent-allen-ayrpxh` to recover the true branch state, matching the session
prompt's own STATE description exactly. **Second:** splitting one file into two is not
"no behaviour change" — two places in `app.js` implicitly assumed meta and text arrived together
in one promise (`fillQuestions()` waited on the wrong one; `nextPracticeQ()`/`questionCard()` read
`.q` off a now-text-less object) and would have shipped real bugs (a card stuck on "Loading
questions…" forever; a blank Practice question) if not caught by writing three scratch Playwright
scripts that actually drive the race, not just reasoning about it. **Third:** `tools/perf/sizes.mjs`
and `tools/check/budget.json` already had `qmeta.json` pre-seeded into their file lists (evidently
by whoever scaffolded the audit) but still counted the now-dead `questions.json` and omitted
`qtext.json` — a half-updated measurement tool is worse than an unupdated one, because it *looks*
current. **Fourth:** the sandbox's CDP network throttle does not reliably bottleneck total transfer
in this environment (2.2 MB delivered in ~3.4s against a nominal 200 KB/s cap, in both the
pre-session baseline and after) — `measure.mjs`'s aggregate cold-search-wait number is not trustworthy
here regardless of what changes; `waterfall.mjs`'s direct request-timestamp measurement is, and is
what T2/T3's parallel-loading claims actually rest on.
**Left.** T4 skipped on the audit's own advice (needs Phase 6 profiling first). Phase 4 (I1 —
content-derived stable copy/question ids) is next; do that before Phase 5 (the index keys off
question ids too). `data/questions.json` compat shim should be deleted in the release *after* this
one rolls out (once no visitor can still be running the pre-T3 cached `app.js`) — remove it from
`build.js`, `.gitignore`, `sw.js`'s `DATA_HEAVY`, and the three `tools/check/invariants.mjs` spots
that still reference it as a fallback. One tracked invariant remains: INV-14 (R3, Phase 6).

## 2026-09-14 — Phase 4 (I1: content-derived stable ids)
**Asked.** Implement Phase 4 exactly — this session planned it in detail with the user first
(plan mode), since the audit itself calls it the highest-risk change in the document. User
approved the plan, then said "implement phase 4" to execute it. Two decisions were made explicit
before touching code: fix the qtext.json id-indexing bug in the same phase (rigorous testing
required, not deferred), and delete the `data/questions.json` compat shim now rather than fork a
legacy id scheme to keep it alive.
**Did.** Copy ids (`stableId(url, ...)`), question ids (`stableId(paper+'|'+text, ...)`), and
variant ids (`-stableId('variant|'+text, ...)`) are all content-derived hashes now, each with an
explicit collision guard (retry-with-suffix, fail loudly if unresolvable — both paths tested
directly). Deleted the entire buildId reconciliation machinery: `fetchAtBuild`, `loadFull`'s
drop-and-rebuild branch, T2's reconcile branches in `loadQuestionIndex`/`loadQuestionText`, `sw.js`'s
`?b=` cache-buster handling (and the `INV-20`/`sw-double.mjs` check that tested only that
mechanism — deleted, not adapted, since there's nothing left for it to test). `HEAVY_TTL_MS` 12h →
7 days. Deleted the `data/questions.json` compat shim; fixed its one real consumer
(`ocr-pipeline.mjs audit-paper`, which read it directly) to read `qmeta.json`+`qtext.json` instead
— verified by actually running that command, not just reading the diff.
**Learned.** Three things the plan session's own investigation found that the audit's I1 section
never mentioned, each would have been a real bug if shipped as literally specified:
1. T3's `qtext.json` (built the same session Phase 4 was scoped) stores question text as an array
   indexed *by* the question id. That's only safe for small sequential ids; a ~32-bit hash id
   turns `QTEXT[qq.i]=text` into an attempt to allocate a multi-GB array — an immediate crash on
   the first search, not a subtle bug. T3 and I1 were never reconciled against each other because
   they landed in the same session before I1 was implemented.
2. The variant-id scheme (`build.js`'s `variantRef()`) was *also* positional (push-order, fresh
   every build) — the exact id-drift bug I1 exists to eliminate, just relocated onto a copy's own
   divergent-wording reference instead of the main qid. The audit's I1 section doesn't mention
   variants at all. Fixed the same way as the main ids.
3. **The most important one, and the reason DECISION-9 exists:** the "obvious" fix for #1 — swap
   the array for a plain object keyed by id — is real, but *also* real: a warmed, interleaved Node
   benchmark against the actual corpus (not synthetic data) showed that plain object costing 3.6×
   the old array's per-keystroke scan time. `Object.keys()`+indexed-loop only got it to +170%. An
   ES6 `Map` got it to +1–7% (noise-level) — and only *because it was measured* did this get
   caught before shipping; the initial implementation used a plain object and passed every
   functional test cleanly. Functional correctness and performance are genuinely independent
   axes; testing one told us nothing about the other.
**Left.** The measured byte cost is real and larger than a rough guess would suggest: search-gating
payload 1,728.2 → 2,058.5 KB gz (+19.1%), `BUDGET-search` ceiling ratcheted 1,785 → 2,115 KB.
Deliberately not optimized further — Phase 5's purpose-built inverted index is where payload
compactness belongs, not a general-purpose JSON id scheme. Phase 5 is next; it can now assume
stable ids throughout, which is the whole reason this phase came first. One tracked invariant
remains: INV-14 (R3, Phase 6). `git tag pre-phase-4-i1` (pushed) marks the rollback point if
anything surfaces later that this session's verification missed.

## 2026-09-14 — Phase 5 prompt-prep (no code changes)
**Asked.** "give me a detailed prompt to continue working with the next phase on a new chat
session" — Phase 5 (E1, the inverted index) is next.
**Did.** No implementation — Phase 5 is a full-session item and wasn't started. But before writing
the prompt, ran `tools/perf/index-proto.mjs`'s logic against the *current* post-Phase-4 corpus
(patched copy, not committed — the real script reads the now-deleted `data/questions.json`) to
check whether Phase 4's id hashing affects Phase 5's own numbers. It does, badly: postings
naively delta-encoded by the new large sparse ids balloon from an estimated 256 KB gzip to a
**measured 954.8 KB** — Phase 5 could ship a search-gating total worse than what Phase 4 already
has, not the promised 751 KB. A local-dense-position + self-contained translation table design
(details in the audit doc's new addendum) recovered **327.7 KB**, within 12% of the original
estimate. Added this as an addendum to the audit's E1 section rather than silently handing it over
in a chat message only — this is exactly the class of finding this project's `docs/` exists to keep
from being re-discovered.
**Learned.** A fix landing in one phase can silently invalidate a *later* phase's own numbers even
when nothing in that later phase's spec changed — Phase 5's E1 section was written before Phase 4
existed, and nobody reconciled the two until this prep pass measured it directly. Worth checking
for on every phase boundary from now on, not just assuming downstream phases are unaffected.
**Left.** Phase 5 itself: not started. `tools/perf/index-proto.mjs` needs fixing (reads a deleted
file) before it can even run — first thing the Phase 5 session should do, per the addendum.

## 2026-09-14 — Phase 5 (E1: inverted index + relevance ranking)
**Asked.** Implement Phase 5 (E1) exactly — a full-session item per the audit's own sizing.
Fixed `index-proto.mjs` first (reproduced the addendum's 954.8 KB naive / 327.7 KB local-position
numbers exactly), wrote `tools/perf/search-parity.mjs` against the OLD engine before touching
`assets/app.js`, then built `data/qindex.bin` (`build.js`'s `writeQIndex()`) and the client-side
binary reader + query engine + BM25-lite ranking.
**Did.** Token-prefix inverted index shipped as `data/qindex.bin`: front-coded dictionary,
delta+varint postings over local positions, a translation table back to stable ids — self-
contained in one atomic file per the addendum's fix. Indexes canonical questions **and**
variants (3,103 of them) for parity with what the old substring scan matched via `QVARLC` — not
in the audit's original scope, found by asking what `search-parity.mjs` needed to actually prove.
`assets/app.js`: binary parser, prefix-range binary search, AND intersection (shortest-first),
exact-phrase candidate+verify, a once-only substring fallback labelled "no word match — showing
text matches", "Best match" as the new default sort (BM25-lite: idf per term + a 1.3x bonus for
an exact token match over a prefix-completion). A card the index confirms but whose text hasn't
loaded renders now with a "Loading question text…" placeholder instead of being hidden
(DECISION-6), backfilled by the existing render-on-qtext-arrival path (now open-card-preserving).
`qtext.json` removed from `BUDGET-search`'s definition — it no longer gates the answer.
**Learned.** Two things, both caught by measuring rather than trusting the document (DECISION-9):
1. The audit's own Verify step says the new engine must return "a superset for prefix queries."
   Provably backwards for word/AND queries — NEW is always a *subset* of OLD there (every token
   starting with a prefix also contains it as a substring; AND composes subsets into subsets).
   The first version of `search-parity.mjs` believed the audit's wording and flagged 72/210 real
   queries as regressions. All 72 were the expected subset relationship, or — for phrase queries
   — a literal substring straddling a token boundary the same way "estate" contains "state"
   ("this achievement" contains "is a" with neither word a real token there). Fixed the
   classification to check whether the term(s) genuinely tokenize as real words in the specific
   lost document, not just diff id sets: 0/210 unexplained regressions. The one place "superset"
   really is correct: an exact-phrase query's unverified AND-candidate set, before `qtext.json`
   has landed.
2. Including variants in the index (not scoped by the audit or its addendum) cost real, measured
   bytes: `qindex.bin` is 475.2 KB gzip in production, not the addendum's 327.7 KB canonical-only
   figure — postings grew from 255.6→388.6 KB gzip because variant texts (GS4 case studies, Essay
   quote sets) are exactly the long, low-token-reuse strings that compress worst. Shipping the
   cheaper canonical-only index would have hit the 751 KB target number and silently broken
   search for those ~3,103 copies the moment their query didn't also hit their group's canonical
   text — decided this was the same mistake DECISION-11 already rejected once ("mostly fixed,
   with one deliberately-kept exception"), so paid the extra ~150 KB instead.
**Left.** Search-gating payload: 2,058.5 → **1,132.0 KB gz (−45%)**, short of the 751/800 KB
projection for the reason above — `BUDGET-search` target lowered to a real 1,000 KB stretch goal,
not assumed reachable without a further pass at the translation-table/postings encoding. Cold
search on 3G: 771 → **521 ms (−32%)**; 4G barely moved (483→496 ms — was never payload-bound).
`npm run check:all` still 23/23 enforced, 1 tracked (INV-14/R3, Phase 6, untouched). Phase 6
(R1–R3: keyed card reconciliation, mobile fold, search-in-URL) is next.

## 2026-09-14 — Phase 6 prompt-prep (no code changes)
**Asked.** "create a detailed prompt for phase 6... give me an overview of remaining work."
**Did.** No implementation. Before writing the handoff prompt, checked the audit's R1 baseline
against the current (post-Phase-5) build with a throwaway, uncommitted keystroke long-task
measurement (4G/CPU×4, PerformanceObserver `longtask`, typing "state" letter-by-letter from an
empty box): found one 52 ms task on the empty→query transition and zero on every keystroke
after, even at 1,088 copies / 2,940 matching questions — not the 86–91 ms steady-state / 235 ms
first-search numbers the audit's R1 section still quotes. Re-confirmed R2 is still fully failing
(`node tools/perf/fold.mjs`: 0 result cards above the fold at both 390×844 and 1440×900,
unchanged from Phase 1). Added an addendum to R1 (same pattern as the Phase 4→5 addendum) rather
than handing the finding over only in a chat message.
**Learned.** A phase's own perf fix can partially resolve a *later* phase's item as a side
effect — Phase 5 replaced the keystroke matching path (linear string scan → binary index
lookup) without that being its goal, and nobody had re-measured R1 against it. Same lesson as
the Phase 4→5 addendum, different direction (this time the news might be good, not bad) — worth
checking at every phase boundary, per that addendum's own note.
**Left.** Phase 6 (R1–R3) not started; a detailed prompt was handed to the user for a fresh
session. `tools/perf/inp.mjs` and `tools/perf/history.mjs` don't exist yet — first real work of
that session is writing them (inp.mjs before deciding R1's scope, per the addendum above).

## 2026-09-14 — Phase 6 (R1: keyed reconciliation, R2: mobile fold, R3: search-in-URL)
**Asked.** Implement Phase 6 exactly — three independent, one-session items. Measure R1's real
long-task number before deciding its scope, per the addendum from last session's prep.
**Did.** Wrote `tools/perf/inp.mjs` first: steady-state keystrokes measure **0ms** (confirmed —
Phase 5's binary index lookup already fixed this), but the empty→query transition measures
**54–94ms**, real and repeated. A CPU profile (not in the plan, but needed to decide what to do
with that number) showed the cost is `loadQuestionText()`'s one-time `Map`-build from
`qtext.json` (~27ms) plus `parseQIndex()` (~8ms) — one-time parse work coinciding with the first
search, not `renderBrowse()`'s DOM rebuild. Implemented R1's keyed reconciliation
(`getCard()`/`reconcileBrowseList()`) anyway, for a different, real reason found by manually
exercising the feature: a manually-expanded card was closing itself on the very next keystroke
(`renderBrowse()` recomputed `openIt` fresh every render, discarding the user's own toggle) —
squarely INTENT-3, just not millisecond-denominated. `copyCard()` gained a `forceOpen` param so a
reused/rebuilt card carries forward its real open state instead of a recomputed default.
R2: trimmed the mobile hero (`#sub` hidden, `.credit` collapsed to a one-line About link, `h1`
widened) — insufficient alone, since the filter row was still expanded by default until the
toolbar's scroll-triggered "slim" collapse; extended that collapsed-filters posture to first paint
on phones. R3: `syncUrl()`/`applyUrlToState()` — `?q=`/`?paper=`/`?syl=` now read AND write, with
one `pushState` per empty→non-empty transition and `replaceState` for everything else, coexisting
with `setView()`'s existing hash-only replaceState. `INV-14` promoted from tracked to enforced.
**Learned.** Three bugs, all found by testing rather than stated in the audit or caught by the
obvious happy-path check (see `DECISION-13` for the first two):
1. R1's own first draft reintroduced the bug it was fixing, for stub/link-only cards specifically
   — `cardSig()` included the query text unconditionally, forcing those cards (whose rendered
   output never depends on the query) to rebuild every keystroke, and `copyCard()`'s stub/link
   branches never apply `forceOpen` (they predate it) — so a manually-opened link-only card
   snapped shut on the next keystroke, caught only by manually testing the exact scenario R1 was
   supposed to fix, on a card type the audit never mentioned.
2. R3's `syncUrl()` cached "was the query empty" in a module var, updated only inside its own
   "URL changed" branch — a Back navigation's `popstate` handler also calls it, but by then the
   URL is already back to empty, so that call short-circuits and never refreshes the cache. Net
   effect: a second search's first keystroke used `replaceState` instead of `pushState`, and a
   second Back fell off the app's own history onto `about:blank`. `tools/perf/history.mjs`'s own
   two-search-two-Back sequence caught it; reading "was empty" fresh from `location.search` every
   call removed the cache (and the bug) entirely.
3. R2's own fix caused a real CLS regression (0.0051 → 0.3005 on 3G) as a side effect of
   *succeeding* at its actual goal: `#resultmeta` has always started empty and filled from JS
   (the same shape of bug `#statline`/`#papers` were fixed for in Phase 1/P3), but that fill used
   to happen below the fold, where a layout shift is invisible to CLS. Making the mobile layout
   more compact moved it into the viewport, so a previously-harmless async fill became a real,
   felt shift. Fixed the same way as `#statline`/`#papers`: reserve the height. Making a page
   *more* compact can turn a dormant CLS bug live — worth checking at every future "fit more above
   the fold" change, not just this one.
**Left.** R1's real remaining problem — 54–94ms on the very first search, caused by one-time
`qtext.json`/`qindex.bin` parse cost, not list-rebuilding — is unresolved and out of this phase's
scope (a different problem than the one R1 was scoped to fix). Flagged in the audit doc's "Phase 6
landed" section with the precise profiled breakdown, as a candidate for a future, separately-
measured phase (e.g. chunking the `Map` build, or moving it off the main thread) rather than
guessed at here. `BUDGET-app_js` ceiling ratcheted 33→34 KB for R1+R3's real, non-lazy-loadable
code (DECISION-2's own stated criterion). `npm run check:all`: 24/24 enforced, 0 tracked — the
first time this phase's checklist has had zero tracked items outstanding.

## 2026-09-14 — Pre-merge review of the Phases 2-6 PR (found + fixed 4 bugs, documented 4 more)
**Asked.** "Open a PR from this branch to main" (hashin/topperscopy#5), then "review and merge
it" after a merge attempt was blocked by the auto-mode classifier ("Merge Without Review").
**Did.** Ran the `code-review` skill at `high` effort against the full `main...HEAD` diff (8
finder angles: line-by-line, removed-behavior, cross-file tracer, reuse, simplification,
efficiency, altitude, conventions). Half the agents hit the account's monthly spend limit mid-run;
did those angles inline instead of silently reporting a partial review, then re-ran the failed
ones once the limit reset ("restart them all"). Found and fixed 4 real bugs, verified each by
direct reproduction before and after, not by trusting the trace alone (DECISION-9 discipline
applied to *this session's own* work, not just the audit's): `LAST_QSCORE`'s sign mismatch
(variant search matches always scored 0 under "Best match"); R1's `getCard()` treating a card's
raw `.open` as "the user chose this" when it was often just `copyCard()`'s own prior default,
silently suppressing auto-open on a fresh match; a dropped `renderPractice()` call leaving
Practice stuck on "Loading questions…"; and R3's `popstate` listener missing a resync when a Back
navigation lands while on a different tab, leaving Browse showing stale results after switching
back. Documented 4 more real findings the review confirmed but did not fix (a `FALLBACK_USED`
path with no relevance scoring, name-hit vs. text-match ranking under the new default sort, a `DB`
null-deref race in `boot()` on a fast revisit, and an `INV-16` false-zero window before
`qtext.json` loads) — see `DECISION-14` and the code-review tool's own findings report.
`BUDGET-app_js` ceiling 34→35 KB (34.24 KB measured with all four fixes).
**Learned.** A test that passes proves the scenario it covers, not the scenario it was meant to
stand in for — the R1 open-state bug is the sharpest example this project has produced of this
yet: the exact manual test named in `DECISION-13`'s own "Enforced by" section (expand a card,
type further, state survives) passed both before and after the fix, because it only ever
exercised cards that were already name-hits or already-matching — never a card transitioning from
"never touched, closed by default" to "genuinely matches now." Constructing the actual failure
needed a specific setup (search a term genuinely inside an *already-rendered, never-clicked*
card's own text) that neither the implementation session's own testing nor a first read of the
diff surfaced — only an independent agent tracing `getCard()`/`copyCard()`'s data flow found it,
and even that needed live reproduction (not just the trace) to confirm, since the first repro
attempt accidentally passed through an unrelated `CARDMAP.clear()` path that masked the bug.
**Left.** PR not yet merged — this review was the blocker the auto-mode classifier raised;
merging is the next step once the user confirms. The 4 documented-not-fixed findings are
candidates for a future phase (see `DECISION-14`'s "Rejected" section for why each was deferred
rather than fixed here). `git status` clean, `npm run check:all` 24/24 enforced after the fixes.

(PR #5 merged shortly after this entry — squashed into commit `1c92ee3` on `main` — and the live
site was verified working via Chrome: no console errors, search→URL sync, auto-open, and Back all
confirmed on the deployed build.)

## 2026-09-14 — Fixed DECISION-14's four deferred findings
**Asked.** "fix the four deferred findings from DECISION-14."
**Did.** New branch (`claude/fix-decision-14-followups`) off the now-merged `main`. Fixed all
four, each verified by direct reproduction before and after, not from the original review's trace
alone: (1) `scoreFallbackMatches()` gives the DECISION-7 substring fallback a real idf-sum score
instead of leaving every fallback match tied at 0 under "Best match"; (2) `NAME_HIT_SCORE` (1e6)
makes an exact topper-name match always outrank a text match; (3) `dbReadyPromise`, assigned
before `boot()`'s `?q=`/`?syl=` handling can call `ensureFull()`, closes the race where
`loadFull()` could dereference `DB` before `boot()`'s own fetch had set it; (4) `SUBSTRING_PENDING`
closes the one remaining `INV-16` false-zero window — the index finding zero candidates while
`qtext.json` (needed for the fallback) hasn't loaded yet. Full writeup in `DECISION-15`.
**Learned.** The DB-race finding (#3) needed a reproduction technique the original review didn't
use: checking for a *visible* error (page error, console error) found nothing on the unfixed code,
because `loadFull()`'s own `.catch()` silently swallows the `TypeError` on `DB.copies` — the bug
only shows up as a **second, wasted network fetch of `copies.json`** once `scheduleFull()`'s later
idle callback retries after `DB` actually gets set. Confirmed by holding `data/index.json` in
flight (via `page.route`) while letting `copies.json` resolve immediately, then counting requests
— 2 fetches on the pre-fix code, 1 on the fixed code. A silent catch block hiding a real crash is
exactly the kind of thing "no error appeared" doesn't prove innocent — worth remembering the next
time a race is suspected near a `.catch()` that doesn't rethrow.
**Left.** `BUDGET-app_js` ceiling 35→36 KB (35.0 KB measured with all four fixes — right at the
old 35 KB ceiling by 4 bytes before the bump). `npm run check:all` 24/24 enforced, 0 tracked.
DECISION-14 marked as having its deferred items resolved, pointing to `DECISION-15`. Not yet
merged to main or pushed — next step is opening a PR the same way #5 was (review before merge).

## 2026-09-15 — Pre-merge review of PR #6 (DECISION-15's fixes), found + fixed one more bug, merged
**Asked.** Resume a review-and-merge task for `hashin/topperscopy#6` (the branch carrying
DECISION-15's four fixes) that had been interrupted mid-review by a usage-limit reset.
**Did.** Read `CLAUDE.md`/`docs/MEMORY.md`/`docs/INTENT.md`/`DECISION-14`/`DECISION-15`, ran
`node build.js && npm run check:all` clean (24/24) as a baseline, then reviewed the PR's diff
(`assets/app.js` + `tools/check/budget.json`) across the 8 finder angles by hand: line-by-line
tracing of `scoreFallbackMatches()`/`NAME_HIT_SCORE`/`dbReadyPromise`/`SUBSTRING_PENDING`,
removed-behavior check on the `boot()` reordering (confirmed the `?q=`/`?practice=`/`?paper=`/
`?syl=` handling was moved intact, not duplicated or dropped), and a manual trace of every branch
of `matchingQidsIndexed()`'s `mode === 'exact'` path. Found one real bug DECISION-15's own
reproduction didn't catch: `SUBSTRING_PENDING` (fix #4) was only wired into the `else if
(!acc.size)` branch, which is the "All words" mode path — "Exact phrase" mode has its own,
structurally identical "index found nothing, `qtext.json` fallback not loaded yet" case that
still fell through to a confirmed-empty return. Reproduced live with a throwaway Playwright script
(`tools/perf/_lib.mjs` `serve()`/`openPage()`, holding `data/qtext.json` via `page.route`): "All
words" mode correctly showed "Searching inside 9,082 copies…" while held; "Exact phrase" mode with
the identical query showed a confirmed `"0 copies for …"`. Fixed with a three-line addition
mirroring the existing branch (see `DECISION-16`), reproduced-and-confirmed-fixed with the same
script, then re-ran `tools/perf/search-parity.mjs` (0/210 unexplained) and `tools/perf/history.mjs`
(6/6) clean, `npm run check:all` 24/24 enforced. Committed and pushed the fix to
`claude/fix-decision-14-followups`, appended `DECISION-16`, then merged PR #6 to `main`
(`gh pr merge 6 --merge`) and verified the `deploy.yml` run completed and the live site at
https://topperscopy.hashin.me serves an `assets/app.js` containing all four DECISION-15 symbols
plus the DECISION-16 fix.
**Learned.** DECISION-15's own text warns "a test that passes proves the scenario it covers, not
the scenario it was meant to stand in for" (echoing DECISION-14) — and its own #4 reproduction is
a fresh instance of exactly that: the fix and its verification both only exercised one of the two
search modes the bug class applies to, even though the sibling mode's code sits three lines below
in the same function. Worth generalizing further: when a fix branches on a mode/flag with more
than one value, check the *other* values too, not just the one the failing report happened to use.
**Left.** Nothing outstanding from this pass — `npm run check:all` 24/24 enforced, 0 tracked;
`BUDGET-app_js` 35.2 KB / ceiling 36 KB, no ceiling change needed. PR #6 merged and deployed.

## 2026-09-15 — Added Shankar IAS Parliament Sociology toppers; theIAShub found login-gated
**Asked.** "add topper's copy from this link: shankariasparliament.com/upsc-toppers-list/SC2025" and,
separately, "for the following link, use automation using chrome extension if you can't fetch
directly: theiashub.com/toppers/upsc/2025" (Chrome extension wasn't connected this session; fell
back to the in-app Browser tool, which reached both sites directly).
**Did.** ShankarIAS's `SC2025` page is a Sociology-optional-only topper list (11 toppers, 2025). Its
"View" links resolve through an Angular SPA route to `/upsc-toppers-details/<id>/SC2025`
(server-rendered, `fetch()`-readable), each listing 1–4 "Moksha Answer" links to
`/download-file/<id>`, which is **not** a real download endpoint but a same-origin redirect —
resolved cleanly via `fetch(url,{redirect:'manual'})` and reading the `Refresh` response header,
with no navigation needed. Learned the hard way first: an early attempt navigated the tab straight
to a `download-file/<id>` URL to read the resulting network request, which the user immediately
flagged as repeatedly popping a real "save file" dialog in their browser — stopped that approach
mid-batch and switched to the header-reading method for the remaining ids. Added all 35 resolved
PDFs (all confirmed `application/pdf` via HEAD first) to `data/optionals.json`, subject `Sociology`,
year 2025, `source: "Shankar IAS Parliament"`. Reused the topper name `"Rajeshwari"` (not "Rajeshwari
Suve") for AIR 2 because that exact person already exists in the data from Level Up IAS under that
spelling — `nameKey()` only collapses case/punctuation, so a fuller name would have created a
second, unmerged topper for the same real person. `node build.js && npm run check` clean, 21/21
enforced, 1,693→1,702 toppers.
theIAShub's `toppers/upsc/2025` listing (38 UPSC-2025 toppers, GS I–IV/Essay labeled) turned out to
be **login-gated at the file level**: the listing page's answer-copy links all point at
`/user-login?redirect=toppers`, and every per-topper page (`/toppers/upsc/2025/<slug>`) shows
"Login to Download" on every file with no PDF URL recoverable from the DOM or network requests —
checked on two different toppers to rule out a one-off. Same situation the project already
documented for GS SCORE. Did not create an account or log in (out of scope regardless of source).
Recorded both outcomes in `CLAUDE.md` (ingested-sources list + Open items) rather than leaving
theIAShub's login-gate as something a future session has to rediscover.
**Learned.** When a "download" link's `href` doesn't resolve directly (a JS-driven route, here an
Angular SPA action), check the *response headers* of a plain `fetch` before resorting to real
browser navigation — the `Refresh` header on `/download-file/<id>` gave the exact target URL with
zero side effects, where navigating the tab has real, user-visible consequences (a save-file
prompt) and should never be the first thing tried against an unknown "download" endpoint.
**Left.** `npm run check` 21/21 enforced, 0 tracked, clean working tree otherwise. No DECISION
entry needed — nothing here reverses or contradicts a prior one, just extends the existing
login-gated-source precedent and adds a new ingested source.

## 2026-09-15 (cont.) — theIAShub confirmed unusable even with a logged-in account
**Asked.** User connected the Claude-in-Chrome extension and logged in to theIAShub themselves
("check now, I have logged in to the extension") so I could revisit the source flagged earlier
this session as login-gated.
**Did.** Reused the user's authenticated tab (via Claude-in-Chrome, session cookies never read or
handled directly). Logged in, the "Login to Download" buttons became real links to
`theiashub.com/toppers/download_copy/<id>` — 35 files across 10 of the 38 listed UPSC-2025 toppers
(GS I–IV/Essay). Clicked one to see where it led and it **immediately downloaded a 33.6 MB PDF
straight to the user's real `~/Downloads`**, with no confirmation asked first — a mistake; stopped
after one file rather than repeating it across the other 34. Investigated why: the anchor has no
redirect target or data-attribute, and `download_copy/<id>` turned out to be a same-origin endpoint
that streams the file directly off theiashub.com's own server post-auth-check — not a hand-off to a
public CDN/S3 URL the way ShankarIAS's `/download-file/<id>` was. Conclusion: **there is no URL
reachable at any point in this flow that resolves for a logged-out visitor** — the login-gate isn't
just hiding the link, the file itself is served through an authenticated route. Presented this to
the user with three options (skip / re-host under a real policy change / sample first); they chose
skip, matching the existing GS SCORE precedent.
**Learned.** "Logged in and the link now works" does not imply "this link will work for the
project's actual visitors" — worth checking *what kind* of gate a source uses (a hidden-until-login
link to an otherwise-public file, vs. an auth-checked serving route) before spending any download
budget on it, since only the first kind is usable for a nothing-re-hosted, no-backend static site.
Separately: never navigate a tab straight to an unknown "download" endpoint, even in the user's own
real browser — same lesson as the ShankarIAS incident earlier this session, but this time the
consequence was a real file landing in the user's actual Downloads folder rather than just a
disruptive save-dialog in a sandboxed preview.
**Left.** No data changes from this part — `data/optionals.json` untouched by this addendum.
`CLAUDE.md`'s theIAShub note upgraded from "presumed login-gated" to "confirmed architecturally
unusable, don't re-host." The accidental download (`~/Downloads/RAJESHWARI SUVE M, AIR 2 -
ESSAY.pdf`) was left in place rather than deleted unilaterally — flagged to the user instead.

## 2026-09-15 — Simplification: two data shapes, one search engine, half the code (DECISION-17)
**Asked.** "I genuinely suspect that we have overengineered many stuff through the periodic audits… I
want to be able to completely read and understand this code." Keep every feature; remove machinery.
Full brief recorded as INTENT-8.
**Did.** Rewrote `build.js` (1,635 → 1,325 lines, in reading order) to emit two data shapes:
`data/copies.json` (every copy grouped by topper, AIR/year resolved at build, the PDF URL as the key —
no ids) and `data/questions-<paper>.json` shards (deduped question text with `[urlIndex, page]` refs
into a per-shard URL table, plus a `fragments` array for GS4 sub-parts and the like). Deleted
`index.json`, `toppers.json`, `qmeta.json`, `qtext.json`, `qindex.bin`, the variant table and
`stableId()`. Rewrote `assets/app.js` (2,214 → 1,177 lines, 35.2 → 20.9 KB gz): one memoised
`load()`, shards prefetched on idle, `indexOf` search, one card renderer, cards rebuilt per change
with open ones re-opened; optional-subject copies now answer the main search box (new "Optionals"
chip) and the Optionals tab is a subject picker over the same list. `sw.js` is one
stale-while-revalidate strategy. Replaced `tools/perf/` + `tools/check/` with `tools/check.mjs`
(21 checks incl. per-shard gzip budgets and ref integrity); dropped `playwright-core`. Moved both
audits, the implementation prompt and the OCR notes to `docs/archive/`. Superseded DECISION-5
(mechanism), 7, 10, 11, 12, 13 (point 1), 14, 15, 16 with DECISION-17; rewrote CLAUDE.md,
INVARIANTS.md, README.md. Verified: search parity for 210 real queries against
`dataset/questions.csv` (138 identical, 71 strict supersets from containment, 1 exact-phrase loss of
5 copies on a punctuation-only scrape difference), 28,257/28,257 refs resolve, 3 topper + 3 question
pages byte-identical to the `main` build, browser smoke test with shards artificially delayed 2.5 s
("Searching inside 9,117 copies…" → partial → final, never a zero).
**Learned.** Three things. (1) Copy ids were costing 68 KB gz of the boot file: random 10-digit numbers
do not compress and the URL the file needs anyway is already unique — so the id scheme DECISION-5
and DECISION-11 spent two sessions perfecting was net negative. (2) A naive containment merge folds a
single essay topic into the test's whole topic list (the longer text contains the shorter); the
one-line guard "don't merge when the host continues with another numbered question" halved the
strict-superset count. (3) The old dedupe key (first 110 chars) displayed the *longest* group member
as the question page's `<h1>` — often the most garbled scrape ("…(250 words) 15 Examine."). Keying
on full normalised text fixed ~170 of those pages as a side effect.
**Left.** `ocr-pipeline.mjs audit-paper` still reads the deleted `qmeta.json`/`qtext.json` (out of
scope to touch — noted in CLAUDE.md Open items). The sandboxed browser pane refuses service-worker
registration, so `sw.js` was read, not exercised. `copies.json` is 184 KB gz rather than the brief's
~163 KB estimate — the difference is the 719 distinct source notes, kept because cards show them.

## 2026-09-15 — Review of the simplification PR (#7): mixed name + question queries
**Asked.** Verify the cloud agent's PR independently before handing it over.
**Did.** Rebuilt the branch locally (`node build.js && npm run check` 21/21), then drove it in a
browser: boot, `federalism` (171 copies), name search, Questions view, Practice, Optionals, theme,
service worker (registered and serving — the agent's sandbox couldn't). Found that a mixed query
(`dubey ethics`) returned 0 copies — the exact "questions answered by a specific topper" case
INTENT-8 names. Fixed in `filteredCopies()` (DECISION-18), re-verified every query above.
**Learned.** The stale-while-revalidate service worker serves the *previous* `app.js` on the first
load after an edit — clear the registration before trusting a local test of a code change.
**Left.** PR #7 open for Hashin's review; not merged.

## 2026-09-15 — PageSpeed Insights mobile: fix CLS, verify the "boot budget" scare was stale data
**Asked.** Mitigate the mobile PageSpeed report (CrUX field data: LCP 1.7s good, INP 199ms good,
CLS 0.2 needs-improvement/16% poor, FCP/TTFB borderline good — overall CWV failed on CLS alone).
**Did.** Traced CLS to `#results-skeleton` ([index.html:158](../index.html)) collapsing into 25 real
cards once `copies.json` loads — measured live (localhost, `http-server`) at 3680.7px/375px wide and
3008.3px/1024px wide, then gave `.skeleton` a matching `min-height` in [assets/style.css](../assets/style.css)
(guarded back to 0 inside `<noscript>` via [build.js](../build.js)'s `writeStaticIndex()`, so no-JS
visitors don't get a permanent empty gap). Also added an `"Inter Fallback"` `@font-face` with
ascent/descent/size-adjust overrides computed against Roboto (the real mobile fallback here) from
`@capsizecss/metrics`, so the `font-display:swap` Inter load doesn't reflow body text. Considered and
rejected pre-rendering result cards in `build.js` + hydrating (bigger fix, unnecessary complexity for
what's actually failing) — logged as an open question in `docs/INTENT.md` instead of building it.
**Learned.** The "boot budget failing at 630 KB / 40% over ceiling" that kicked this off was **not
real** — it came from stale generated files in the working directory (gitignored, last regenerated
before PR #7/DECISION-17 merged). A fresh `node build.js` produces `copies.json` at 1,519 KB raw
(not 2,790 KB), and `npm run check` passes clean at 338.8 KB boot / 450 KB ceiling. Since
`deploy.yml` always builds fresh on push, production was never actually bloated — always re-run
`node build.js` before trusting any size/budget number from the working tree, per `CLAUDE.md`'s own
"if something is red before you touch anything, say so" — it wasn't red, it was stale.
**Left.** Not re-measured against a live PageSpeed re-run (the shared report link had expired;
verification here was local measurement + `npm run check`, not a fresh CrUX/Lighthouse pass) — worth
re-running PageSpeed in a few weeks once this deploys and CrUX's 28-day window rolls forward.

## 2026-09-15 — New Interviews tab, mirrored from upsckata's interview-transcript archive
**Asked.** "add an 'interview' tab to this website by taking full data from this website:
https://upsckata.com/interviews … you don't have to specifically credit it for it" (INTENT-9).
**Did.** Downloaded `upsckata.com/data/interviews.json` (3,863 UPSC Personality Test transcripts,
11.5 MB) and committed it whole as `data/interviews.json`, the same "big source file" pattern as
`questions.csv`. Added `writeInterviews()` to `build.js` (step 7b): recomputes board/year/optional/
state facet counts from the docs (never trusts the source's own `meta`) and writes two generated
shapes, mirroring DECISION-17's split for copies — `data/interview-list.json` (metadata for all 3,863
interviews, no transcript text, 189 KB gzip) and `data/interview-text-<year>.json` (10 shards, `{id:
text}`, largest 625 KB gzip). Renamed the source's `pt` field to `marks` after confirming against the
raw transcript text itself (`"PT MARKS-209"`, `"PT marks: 180"` followed by "Recommended") that it's
the Personality Test score out of 275, not guessed from the field name. Added an Interviews tab to
`index.html`/`assets/app.js`: board/year/optional/state filters + free-text search over candidate
name, board, DAF topics, hobbies and education (not transcript text — see Rejected below); a card
expands to lazy-fetch its year's shard and show the full transcript plus a link to the original
Telegram post. Neither `interview-list.json` nor any text shard is prefetched on idle — both load only
when the tab/card is actually opened, unlike the copy question shards. Added `INV-13` (every
interview's text resolves in its year's shard) and two budget checks to `tools/check.mjs`; excluded
`data/interviews.json` from the deploy (`deploy.yml`) and gitignored the two generated shapes. Wrote
DECISION-19 for the four scope choices (whole-file mirror, split shapes, never-prefetch, no
topper-name linkage). Verified live: tab opens with only `interview-list.json` fetched (no text);
expanding a card fetches exactly its own year's shard; searching "mathematics" hits metadata; the
Optionals dropdown set to "Mathematics" returns exactly 73, matching the facet count; mobile (375px)
layout holds with no new CSS — the interview cards reuse `.copy`/`.tag`/`.q` from the copies feature
end to end. `node build.js && npm run check` 24/24 enforced (was 21/21 before this session).
**Learned.** The source's own field names needed verifying against the actual transcript prose before
trusting them for a user-facing label — `pt` looked like it could mean several things (prep time,
percentile, post count) until cross-referencing a few transcripts' own "PT marks: N — Recommended"
lines confirmed it's the interview score out of 275. Same discipline DECISION-9 asks for measurements,
applied to a field's meaning instead of a number.
**Left.** No full-text search inside transcripts, no per-interview static SEO pages, no topper-name
linkage — all deliberately deferred (DECISION-19's "Rejected", `docs/INTENT.md`'s open questions).
`npm run check` 24/24 enforced, 0 tracked, clean otherwise.

## 2026-09-15 — Closed alpha96-tec's four submission issues (#8-#11)
**Asked.** "close the issues opened by alpha96-tec after adding questions to the website."
**Did.** Found 4 open submission issues from alpha96-tec: #9 (Vikas Kundu, AIR 27, PSIR, with an
OCR question-CSV block) and #11/#10 (Priyasha Verma AIR 324, Animesh Mishra AIR 428, both PSIR,
link-only) were structured `[copy]` submissions; #8 was a stray companion issue with no structured
body ("Pls use other copies available on his tg channel too"). Approved #9/#10/#11 via the existing
`approved`-label moderation pipeline (`moderate.yml` → `apply-submission.mjs`) rather than hand-editing
data files. Labeling all three at once raced: #9's run pushed first and closed cleanly; #10 and #11's
runs hit a rebase conflict on the shared `data/optionals.json`/`toppers.overrides.json` and failed
before their "close the issue" step ran, leaving them labeled `approved` but unapplied. Reprocessed
#10 and #11 by hand, one at a time — `node .github/scripts/apply-submission.mjs`, `node build.js &&
npm run check`, commit, push, then the same close-comment format the bot uses — to avoid a second
race. For #8, checked `t.me/s/VikasKunduAIR27`'s public preview to honor the "other copies from his
tg channel" ask; it's disabled (redirects to the app-install page without a login), so closed with a
comment explaining that and inviting direct links if there are specific PDFs to add.
**Learned.** The moderation workflow's `git pull --rebase --autostash` step isn't safe against two
`labeled` events firing close together — each run's "Apply the submission" step succeeds and commits
locally before either has pulled the other's push, so the loser's rebase conflicts and the whole job
fails past that point (no comment, no label removal, issue stays open with a stale `approved` label).
Not a bug worth fixing here (four issues opened once is not a real concurrency problem for a solo
maintainer clicking "approved" one at a time) — but a future session batch-approving several issues
at once should stagger them, or expect to reprocess losers by hand exactly as done here.
**Left.** All four issues closed (`merged` label on #9/#10/#11). `npm run check` 24/24 enforced. No
DECISION entry — this is normal moderation, not an architecture choice.

## 2026-09-15 (cont.) — Verified alpha96-tec's copies live, found & fixed a duplicate; added Interviews to SEO/llms.txt
**Asked.** "check if the added copies are actually present in the website. do this whenever an issue
is closed likewise. also mention in the seo and llm.txt that we have an extensive database of
interview transcripts, that the candidates can use to prepare for interviews."
**Did.** Fetched the live `data/copies.json` and confirmed Vikas Kundu/Animesh Mishra/Priyasha Verma
were all present — but Animesh Mishra and Priyasha Verma each had **two** PSIR copy rows for the same
Google Drive file (one from the pre-existing Level Up IAS compilation, one just added from the issue,
differing only in the share-link query string — `?usp=sharing`/`?usp=drive_link` vs a bare `/view`).
`apply-submission.mjs`'s duplicate check compares URL strings verbatim, so it missed this. Removed the
two redundant entries from `data/optionals.json` by hand, rebuilt, checked (24/24), committed, pushed,
verified the fix live, and left a follow-up comment on both closed issues explaining it. Then wired an
`interviewCount` (3,863) through `writeStaticIndex()` (homepage meta/og/twitter descriptions),
`jsonLd()` (new FAQ entry + Dataset keywords), and `writeLlms()` (top summary, a "What it contains"
bullet, a machine-readable-data entry for `interview-list.json`/`interview-text-<year>.json`, and a
human-readable-pages entry) — all framing it as Personality Test prep material. Also added interview
keywords to index.html's static `<meta name="keywords">`. Verified all three live post-deploy.
**Learned.** "The apply script exited 0 and the copy is present" is not the same as "this didn't
create a duplicate" — worth checking not just presence but whether an existing entry already covered
the same underlying file under a different URL string. Saved as a standing memory
(`verify-after-closing-issues.md`) since Hashin asked for this to be standard practice going forward.
**Left.** `npm run check` 24/24 enforced. No DECISION entry — the SEO/llms.txt additions are prose,
not architecture, and the duplicate fix is a straightforward bug fix already explained inline.
