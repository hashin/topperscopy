# tools/perf — the measurement harness

Everything in `PERF-UX-AUDIT-2026-09-14.md` was measured with these. Nothing here ships to the
browser; `playwright-core` is a **devDependency** and is not used by `build.js` or by CI.

## Setup

```bash
npm install            # installs playwright-core (dev only)
node build.js          # the harness measures a real build, so build first
```

Chromium is **not** downloaded. The harness looks for an existing binary, in order:
`$TC_CHROMIUM`, `$PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers`, `~/.cache/ms-playwright`.
If you have Chrome installed, point at it: `TC_CHROMIUM=/path/to/chrome node tools/perf/measure.mjs 4g`

## Run everything

```bash
node tools/perf/baseline.mjs > /tmp/before.txt
# ...make your changes...
node build.js && node tools/perf/baseline.mjs > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

## Individual scripts

| Script | Answers | Audit item |
|---|---|---|
| `sizes.mjs` | What does each file cost, gzip and brotli? What gates search? | baseline |
| `measure.mjs [4g\|3g\|desktop] [gzip\|br]` | FCP/LCP/CLS, transfer, cold-search latency | baseline, P1 |
| `cls.mjs [3g]` | Which DOM nodes cause the layout shift? | P3 |
| `showmore.mjs` | Does "Show more" keep the reader's place? | P4 |
| `lost-keystroke.mjs` | Is a query typed before boot adopted or dropped? | P2 |
| `a11y.mjs` | Live regions, dialog labels, tap targets | P7 |
| `fold.mjs` | Is anything useful visible without scrolling? | R2 |
| `sortbench.mjs` | Is the result sort worth optimising? (no) | P6 |
| `index-proto.mjs` | How big would a real inverted index be? | E1 |
| `copies-proto.mjs` | Would interning `copies.json` help? | T4 |
| `compare-encodings.mjs` | What does brotli actually save, end to end? | D2 |
| `baseline.mjs` | All of the above, in one block | — |

## Scripts each phase must ADD

The audit references a few verification scripts that do not exist yet. Writing the script is part
of the phase's work — it is how you prove the change did what it claims:

| Script | Phase | Must assert |
|---|---|---|
| `zoom.mjs` | P10 | at 280px wide and 200% zoom the toolbar does not overlap the header |
| `waterfall.mjs` | T2 | `copies.json`, `qmeta.json` and `qtext.json` start within ~50 ms of each other |
| `cardsize.mjs` | P9a | the median collapsed card height, for `contain-intrinsic-size` |
| `search-parity.mjs` | **E1** | 200 real queries: new engine ⊇ old for prefix, ≡ for whole-word |
| `inp.mjs` | R1 | longest long task per keystroke < 50 ms at 25 cards |
| `history.mjs` | R3 | typing sets `?q=`; Back clears it without leaving the site |

`search-parity.mjs` is the important one. **Write it before you change the engine**, capture the
old engine's answers for a fixed query list, and diff against the new engine. Any query where the
new engine returns fewer results must be listed and explained, not silently accepted.

## A warning about micro-benchmarks

`sortbench.mjs` exists because an unwarmed, non-interleaved benchmark of the result sort reported
the **opposite** of the truth and nearly produced a change that would have made every keystroke
~3× slower at that step. Warm every implementation before timing, interleave the rounds, and report
a median. See audit item P6.
