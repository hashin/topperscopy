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
