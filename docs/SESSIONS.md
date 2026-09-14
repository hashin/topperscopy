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
