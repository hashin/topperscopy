# Project memory — read this first

This directory exists because of a specific failure mode: **a chat session ends, its context dies,
and the next session re-derives the code but not the reasoning.** It then "fixes" things that were
deliberate, re-litigates settled questions, and repeats mistakes the project already made and
learned from.

Two real examples from this repo, both caught in September 2026:

- `README.md` documented three performance optimisations — `content-visibility`, a `copies.json`
  prefetch, a Fraunces preload — that **do not exist in the code**. Anyone reading the README
  concluded the easy wins were taken and looked elsewhere.
- `CLAUDE.md` rejected a hosting change on a payoff of "~137 KB". The real figure, measured, was
  **1,078 KB**. A correct decision process reached the wrong answer because the input number was
  stale and nobody could tell.

So the rule here is: **anything a script can verify, a script must verify.** Prose goes stale
silently; a failing check does not.

---

## The four files

| File | Answers | Changes when |
|---|---|---|
| **`INTENT.md`** | *What is this for, and what has Hashin actually asked for?* | Hashin says what he wants. Append, with the date. |
| **`DECISIONS.md`** | *Why is the code like this, and what would change it?* | A non-obvious choice is made. Append an ADR. |
| **`INVARIANTS.md`** | *What must never break, and which check proves it?* | An intent or decision becomes machine-checkable. |
| **`SESSIONS.md`** | *What happened, and what did we learn?* | Every session, at the end. Append. |

`INVARIANTS.md` is the load-bearing one. It is the bridge between "what Hashin wants" and
"what CI enforces" — every entry cites an `INTENT-n` or `DECISION-n`, and every entry names the
check in `tools/check/invariants.mjs` that proves it. Intent that cannot be checked is still
written down, but it is marked as such so nobody mistakes it for a guarantee.

---

## Protocol for a new session

**At the start — before writing any code:**

1. Read `CLAUDE.md` (the project map) and this file.
2. Read `docs/INTENT.md` and `docs/DECISIONS.md`. These are short on purpose. Read them fully.
3. Read the last 2–3 entries of `docs/SESSIONS.md` to see where the previous session stopped.
4. Run `npm run check`. It tells you, in ~2 seconds, which invariants hold right now. If something
   is already failing before you touch anything, **say so** — do not silently absorb it into your diff.
5. If there is an open audit (`PERF-UX-AUDIT-2026-09-14.md`), read only the phase you are working on.

**While working:**

- If you are about to contradict a `DECISION-n`, stop. Either it is still right and you should not,
  or it is now wrong and you should supersede it properly (see `DECISIONS.md` for how). Never
  silently reverse one.
- If you find prose that disagrees with the code, the **code is the truth** — fix the prose in the
  same commit, and add a check if one is possible.

**At the end — this is the part that keeps the memory alive:**

1. Append an entry to `docs/SESSIONS.md`. Keep it to the template. Five lines is fine.
2. If Hashin expressed a new want, append it to `docs/INTENT.md` with the date, **in his words**.
3. If you made a non-obvious choice, append an ADR to `docs/DECISIONS.md` — including the
   alternatives you rejected and *what would make you reverse it*.
4. If any tracked invariant now passes, promote it to `enforced` and tighten the budget ceiling in
   `tools/check/budget.json`.
5. Run `npm run check` one last time. It must pass.

---

## Why "tracked" vs "enforced"

`tools/check/invariants.mjs` has two statuses, and the distinction is the whole point:

- **`enforced`** — must pass. Exits non-zero. This is a regression guard.
- **`tracked`** — a known-failing rule tied to an open audit item. Reported, does not fail the run.

A checker that is entirely red gets ignored within a week. A checker that only encodes what already
passes never drives anything forward. `tracked` lets the same file be both a regression guard *and*
a live to-do list: as each audit phase lands, its invariant flips from ⏳ to ✅, and the promotion to
`enforced` is what stops it regressing later.

The budget ratchet works the same way. `budget.json` carries a `ceiling` (today's number plus
headroom — enforced, so nothing gets worse) and a `target` (where the audit says we are going —
reported). **When a phase lands, lower the ceiling in the same commit.** A budget that is never
tightened is a budget that is never met.

---

## What does *not* belong here

- Anything generated. `docs/` is hand-written and small enough to read in full. Keep it that way.
- Restating what the code does. The code says that. These files say *why*, and *what was rejected*.
- Aspirations with no owner. If it is not intent, a decision, an invariant or a session record, it
  belongs in an audit document or an issue.
