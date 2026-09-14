# Invariants — the rules, and the checks that prove them

This is the bridge between `INTENT.md` ("what Hashin wants") and CI ("what actually gets enforced").
Every row cites the intent or decision it protects and names the check that proves it. **Intent that
cannot be checked is still listed, marked "not checkable", so nobody mistakes prose for a guarantee.**

Run them:

```bash
node build.js        # the checks measure real output, so build first
npm run check        # static checks — ~2 seconds, no browser
npm run check:all    # adds the browser checks (needs Chromium)
```

## Statuses

- **enforced** — must pass. `npm run check` exits non-zero on failure. A regression guard.
- **tracked** — a known-failing rule tied to an open audit item. Reported with ⏳, does not fail the
  run. **When it starts passing, promote it to `enforced` in the same commit.**

The split is deliberate. An all-red checker gets ignored; a checker that only encodes what already
passes never drives anything. This way one file is both the regression guard and the live to-do list.

---

## Ethics and data integrity

| ID | Rule | Cites | Status |
|---|---|---|---|
| `INV-1` | No answer copy URL points at our own domain — nothing is re-hosted | INTENT-4 | enforced |
| `INV-2` | upsckata.com is credited in README and CLAUDE.md | INTENT-4 | enforced |
| `INV-2b` | upsckata.com is credited in `llms.txt` | INTENT-4 · AUDIT P11 | tracked |
| `INV-3` | Copy ids and question ids are unique within a build | DECISION-5 | enforced |
| `INV-4` | Every copy link is `http(s):` — no `javascript:`/`data:` from submissions | INTENT-5 | enforced |

## Architecture

| ID | Rule | Cites | Status |
|---|---|---|---|
| `INV-5` | No framework or bundler syntax reaches `app.js` | DECISION-2 | enforced |
| `INV-6` | No blocking third-party script in `<head>` (GA may be `async`) | DECISION-3 | enforced |
| `INV-7` | Every generated artefact is listed in `.gitignore` | DECISION-4 | enforced |
| `INV-8` | No generated artefact is tracked by git | DECISION-4 | enforced |
| `INV-9` | `tools/` is excluded from the deployed site | DECISION-8 | enforced |

## Performance budgets — INTENT-2

Defined in `tools/check/budget.json`. Each carries a **ceiling** (enforced, ratchets down) and a
**target** (reported). Lower the ceiling in the same commit that beats it.

| ID | Budget | Ceiling | Target | Today |
|---|---|---:|---:|---:|
| `BUDGET-boot` | Hero + first 25 cards | 260 KB | 240 KB | 205 KB ✅ |
| `BUDGET-search` | Everything gating a text query | 2050 KB | **800 KB** | 1994 KB |
| `BUDGET-app_js` | `assets/app.js` | 28 KB | 28 KB | 23.8 KB ✅ |

`BUDGET-search` is the one that matters. It is the single biggest lever on felt speed, and it is
where `PERF-UX-AUDIT-2026-09-14.md` Phases 3–5 are aimed.

## Feel — INTENT-3

All tracked until the audit phases land.

| ID | Rule | Cites | Status |
|---|---|---|---|
| `INV-10` | `#resultmeta` is an `aria-live` region | AUDIT P7 | tracked |
| `INV-11` | `#statline` and `#papers` reserve their height (CLS) | AUDIT P3 | tracked |
| `INV-12` | `extract.js` is not on the critical path | AUDIT P8 | tracked |
| `INV-13` | `data/questions.csv` (8.94 MB) is not deployed | AUDIT D1 | tracked |
| `INV-14` | A search reaches the URL (`?q=`) | AUDIT R3 | tracked |
| `INV-16` | Never renders "0 copies" while the index loads | DECISION-6 · AUDIT P1 | tracked (browser) |
| `INV-17` | CLS ≤ 0.1 on slow 3G | AUDIT P3 | tracked (browser) |

## Documentation honesty — INTENT-6

| ID | Rule | Cites | Status |
|---|---|---|---|
| `INV-14b` | `llms.txt` links only to files we actually deploy | AUDIT D1 | enforced |
| `INV-15` | README does not claim optimisations absent from the code | AUDIT P9 | enforced |

`INV-14b` exists because of a real cross-dependency found while writing these checks: `llms.txt`
links to `https://topperscopy.hashin.me/data/questions.csv`, and audit item **D1** proposes to stop
deploying that 8.94 MB file. Landing D1 without updating `build.js`'s `llms.txt` writer would ship a
404 to every AI crawler. The check catches exactly that.

---

## Not machine-checkable — judgement, recorded so it is not lost

These matter as much as the rows above; they simply cannot be asserted by a script. A session that
is about to violate one should say so out loud.

- **INTENT-1 — the question is the unit of value.** Ask of any feature whether it deepens the
  question-level mapping or dilutes it. A feature that makes the site a nicer PDF directory is a
  feature that erodes the only thing here that is hard to copy.
- **DECISION-7's trade-off.** Moving to a token-prefix index loses mid-word substring matching.
  Accepted deliberately. Write `tools/perf/search-parity.mjs` **before** changing the engine and
  list every query that loses results.
- **Sort micro-optimisation.** `localeCompare` is faster than a hoisted `Intl.Collator` on V8
  (4.46 ms vs 12.41 ms, measured). An unwarmed benchmark says the opposite and nearly shipped a 3×
  regression. See `PERF-UX-AUDIT-2026-09-14.md` P6 and `tools/perf/sortbench.mjs`. **Warm and
  interleave every micro-benchmark in this repo before acting on it.**
- **Moderation is a human gate.** Submissions reach the live site. Automation validates; a
  collaborator decides.

---

## Adding an invariant

1. It must trace to an `INTENT-n` or `DECISION-n`. If it traces to neither, you are inventing a
   rule — write the intent down first, or do not add the check.
2. Add the row here, then the check in `tools/check/invariants.mjs` with the same id and citation.
3. If it fails today, add it as `tracked` and point it at the audit item that will fix it. Do not
   weaken a rule to make it pass.
