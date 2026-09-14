# The implementation prompt

Paste this into a **new** Claude Code session to implement one phase of
`PERF-UX-AUDIT-2026-09-14.md`. Change only the `PHASE:` line each time.

**One phase per session.** The audit is ~1,400 lines; no session should read all of it. Each phase
is sized to fit comfortably with room left for the actual work. Phase 5 (the search engine) should
have a session entirely to itself.

**Order:** Phase 1 → 2 → 3 → 4 → 5 → 6. Phase 7 is product strategy, not implementation — discuss it,
do not code from it. Phases 1 and 2 are independent of each other and can be done in either order;
everything after that assumes its predecessors landed.

---

## Where things stand (2026-09-14)

| Phase | State |
|---|---|
| 1 — P1–P11 | **done, merged to `main`, deployed** (run #69) |
| 2 — D1, D3 | **done**, on `claude/intelligent-allen-ayrpxh`, not yet merged |
| 2 — D2 | **open — needs Hashin's decision**, not code. Nothing blocks on it. |
| 3 — T1–T4 | next |
| 4–6 | not started |

`npm run check`: **24/24 enforced passing**, 1 tracked (INV-14, belongs to Phase 6).

## The prompt

```text
REPOSITORY: hashin/topperscopy   (NOT hashin/hashin.github.io — that is a different project)
BRANCH:     claude/intelligent-allen-ayrpxh

PHASE: 1

FIRST, BEFORE ANYTHING ELSE — prove you are in the right repository:

  git remote -v && ls PERF-UX-AUDIT-2026-09-14.md docs/MEMORY.md tools/check/invariants.mjs

If the remote is not hashin/topperscopy, or those files are missing, you are in the wrong repo.
STOP, attach hashin/topperscopy (add_repo, then clone it), and work there. Do NOT create the
files yourself in whatever repo you happen to be in, and do NOT commit anything to
hashin/hashin.github.io. A session that skipped this check in September 2026 spent its entire
run in the blog repo and produced nothing.

Your job is to implement exactly that phase of PERF-UX-AUDIT-2026-09-14.md — no more,
no less. Do not start the next phase. Do not do "while I'm here" cleanups.

READ FIRST, IN THIS ORDER — and nothing else until you have:
  1. CLAUDE.md                     (project map + session protocol)
  2. docs/MEMORY.md                (how this repo carries context across sessions)
  3. docs/INTENT.md                (what I actually want, and why)
  4. docs/DECISIONS.md             (why the code is like this; what would reverse each choice)
  5. docs/SESSIONS.md              (last 2-3 entries only — where the previous session stopped)
  6. PERF-UX-AUDIT-2026-09-14.md   (ONLY your phase's section, plus "How to use this
                                    document" and "Measured baseline" at the top)

DO NOT READ, at all — they are large, generated, and will eat your context for nothing:
  data/*.json, data/*.csv, toppers.html, question/, topper/, paper/, optional/,
  dataset/, ocr-yield.json, ocr-pipeline.mjs, AUDIT-2026-09-09.md

BEFORE CHANGING ANYTHING:
  npm install && node build.js && npm run check
Save that output. It is your baseline. If something is already failing before you
touch anything, tell me — do not absorb it silently into your diff.

Then, for a phase with performance claims (2, 3, 5, 6), also run:
  node tools/perf/baseline.mjs > /tmp/before.txt

HOW TO WORK:
- One commit per lettered item (P1, P2, D1, T1, ...). Never batch them — a bad fix must
  be revertible on its own.
- The audit gives you a file, an anchor string to locate (line numbers drift), the fix,
  and how to verify. Follow it. Where it says NO ACTION (P6), take no action — that item
  exists specifically to stop a plausible-looking change that measurements show is wrong.
- Match the existing style: vanilla ES5-ish in assets/app.js. No frameworks, no bundler,
  no TypeScript, no new runtime dependencies. These are DECISION-2 and DECISION-3; if you
  think one should change, say so, do not just do it.
- If you are about to contradict any DECISION-n, stop and tell me why. Never reverse one
  silently.
- If you find prose (README, CLAUDE.md, a comment) that disagrees with the code, the code
  is the truth: fix the prose in the same commit, and add a check if one is possible.
- Some phases ask you to write a verification script into tools/perf/ (they are listed in
  tools/perf/README.md under "Scripts each phase must ADD"). Writing it is part of the
  work, not optional — it is how you prove the change did what it claims. For Phase 5,
  write tools/perf/search-parity.mjs BEFORE you touch the search engine.

AFTER EACH ITEM:
  node build.js        # must exit 0; counts must not move unexpectedly
  npm run check        # must pass

BEFORE YOU FINISH — this is what keeps the memory alive, do not skip it:
  1. npm run check:all — any invariant your phase fixed must flip from ⏳ to ✅.
     Promote it from 'tracked' to 'enforced' in tools/check/invariants.mjs.
  2. If you beat a budget in tools/check/budget.json, LOWER the ceiling to the new
     number plus a little headroom, in the same commit. A budget never tightened is a
     budget never met.
  3. Tick your items in the Progress table at the bottom of PERF-UX-AUDIT-2026-09-14.md.
  4. Append an entry to docs/SESSIONS.md using the template at the top of that file. The
     "Learned" line matters most — anything that surprised you or contradicted what the
     repo believed.
  5. If you made a non-obvious choice, append an ADR to docs/DECISIONS.md, including what
     you rejected and what would make you reverse it.
  6. node tools/perf/baseline.mjs > /tmp/after.txt and put the before/after deltas in your
     final message.
  7. Push to claude/intelligent-allen-ayrpxh. Do not open a pull request unless I ask.

REPORT BACK WITH:
- What you changed, item by item.
- The measured before/after for anything performance-related. Numbers, not adjectives.
- Which invariants flipped, and any that you expected to flip and did not.
- Anything in the audit you think is wrong. It was written by a different model against a
  build from 14 September 2026 — if a measurement no longer reproduces, or a fix does not
  work as described, say so and show me the measurement rather than forcing the change to
  fit the document.
```

---

## Why the repo check is first

The first Sonnet session given this prompt was started from a CLI whose default source is
`hashin/hashin.github.io` — Hashin's Jekyll blog. The prompt said "work in hashin/topperscopy", but
saying it is not the same as being there. The session sat on the blog's `master`, could not find a
single file it had been told to read, and pushed nothing. Naming the repository is not enough; the
prompt has to make the agent *verify* it before reading anything.

## Phase sizing

| Phase | Items | Session load | Notes |
|---|---|---|---|
| 1 | P1–P11 (11 items) | ~~Comfortable~~ | **DONE** — merged and deployed 2026-09-14. |
| 2 | D1–D3 (3 items) | ~~Light~~ | **D1, D3 DONE.** D2 is Hashin's call, still open. |
| 3 | T1–T4 (4 items) | Medium | T3 is the real work; T4 is explicitly optional and probably should not be done. |
| 4 | I1 (1 item) | Medium–heavy | Highest-risk change in the audit. Verify id churn is **0**. |
| 5 | E1 (1 item) | **Full session** | The search engine. Nothing else in this session. |
| 6 | R1–R3 (3 items) | Medium | Re-measure after R1 and stop if the long task is under 50 ms. |
| 7 | — | Discussion | Product strategy. Read it with Hashin; do not code from it. |

## If a session runs out of context mid-phase

Stop at the last completed item, push it, and append a `docs/SESSIONS.md` entry that names exactly
which lettered items are done and which are not. The next session picks up from that line. This is
why items are committed individually — a half-finished phase is still a clean, revertible state.
