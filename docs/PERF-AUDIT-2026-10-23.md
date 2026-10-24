# Performance audit — 2026-10-23 (after the OCR pass)

Short follow-up to `PERF-AUDIT-2026-10-04.md`. Nothing in the code changed since then; the **data** did: today's Gemini OCR
pass took the searchable index from 53,982 to 76,296 questions (+41 %). This measures what that did and what is worth doing.

## How it was measured

- `node tools/perf/sizes.mjs` (bytes per stage) and `npm run check` (budgets) on a fresh `node build.js`.
- `tools/perf/browser.cjs` against production, installed Chrome over CDP, service worker blocked on cold runs.
  Profiles: phone-4g = 9 Mbps / 60 ms / 4× CPU; phone-slow4g = 1.6 Mbps / 150 ms / 4× CPU (Lighthouse mobile).
- Claude-in-Chrome on the live site (a returning visitor's real Chrome, unthrottled desktop): search timings, long tasks,
  CLS, heap, DOM size. Its FCP read 11.5 s only because the tab was opened in the background; ignore it.

## Results

| | Oct 4 (live, after fixes) | **Today** |
|---|---:|---:|
| `npm run check` | 32/32 | **27/32** (gs3, essay, other, prefetch total, search total over budget) |
| Boot bytes, gzip (blocks first cards) | ~277 KB | 282 KB |
| `/` bytes after idle prefetch | 1,505 KB | **1,926 KB** (+28 %) |
| Cold all-papers search, gzip | ~1,360 KB | **1,883 KB** |
| phone-4g: first cards / FCP | — | 0.66 s / 0.42 s |
| phone-slow4g: first cards / FCP | 2.54 s* | 2.24 s / 0.80 s |
| phone-4g `?q=ethics` cold: first results → complete | 1.00 → 2.51 s | 0.98 → **2.69 s** |
| phone-slow4g `?q=ethics` cold: first results → complete | 3.09 → 10.7 s | 3.30 → **13.4 s** |
| phone-slow4g: land, then type "judicial activism" (focus → complete) | 9.3 s* | **11.8 s** |
| phone-slow4g `?q=ethics` repeat visit (worker) | 0.76 s | 0.93 s |
| Total blocking time, phone | 150–250 ms | 170–430 ms |
| Worst input delay while loading, phone | — | 56–120 ms (good, < 200) |
| CLS | — | 0.000 |
| Desktop, live: search keystroke → painted | — | 11–75 ms; longest task 75 ms |
| Heap / DOM nodes after a search | — | 33–41 MB / ~2,500 |

\* from the Oct 4 *before-fix* table; the after-fix runs did not repeat that profile.

**Reading.** Everything that does not depend on question data is fine and unchanged: a fast first paint, no layout shift,
responsive input, a 0.9 s repeat visit. What got worse is exactly what scales with question count: idle bytes and the time
for a cold search to *complete*, which is bandwidth-bound (≈ shard KB ÷ link speed). The text itself is 72 % of shard
bytes (987 of 1,377 KB gzip), so trimming fields cannot fix it: dropping syllabus ids saves 24 KB, marks/words 15 KB,
stripping "Q.19"/"(10 Marks, 150 Words)" from the text 6 KB.

**Growth ahead.** OCR so far covers 1,968 GS1 copies but only 253 GS2 and 206 GS3; ~4,250 copies are still link-only. OCR'ing
the rest at today's yield roughly doubles the index again, which would mean ~2.5 MB idle on `/` and ~25 s for a cold slow-4G search
to complete. The current design downloads every question to answer any query, so its cost grows with the corpus.

## Plan, in order

### 1. Get the check green again: re-baseline the budgets — **done 2026-10-23, 32/32**
`update-hero.yml` runs `npm run check`, so the next scheduled run (Nov 1) will fail. The overages come from intended data
growth, not a regression, so raise the five ceilings to today's measured values plus ~10 % headroom (gs3 150, essay 36, other
48, prefetch total 1,550, search total 2,100 KB) in `tools/check.mjs` + `docs/INVARIANTS.md`, each with a one-line reason.
*Do not* re-split gs3 just to fit the old 120 KB number: it sits under the 150 KB part target by design (DECISION-23).

### 2. Search from a small index, not the full text (the one structural fix; do it before the next big OCR batch)
This is DECISION-17's option C, which the Oct 4 handoff named as the next step. At build time write a token index sharded by
two-letter prefix, `data/ix/<ab>.json` = `{token: [[copyId, nMatches], …]}` over GS/Essay/Other/Optional question text.
A query fetches one small file per term (expected 5–30 KB gzip each), intersects the posting lists, and gets **counts and
ranking for every copy with no question text at all**. It then fetches only the shard parts that hold the first 25 cards'
questions. Anchor-partitioning (DECISION-27) already puts a copy's questions in one part, so that is 1–4 parts, not 15.

- Expected: cold slow-4G `?q=` complete 13.4 s → ~3–4 s; 4G 2.7 s → ~1 s. Flat as the corpus grows.
- The idle prefetch can then be dropped or limited to the smallest papers: `/` falls from 1.9 MB to ~0.3 MB for a visitor who only browses.
- **The trade-off needs your call:** today `indexOf` also matches *inside* words ("federal" finds "cooperative-federalism",
  "ism" finds everything). An index matches a term only at the start of a word (prefix match). "Exact phrase" still works:
  narrow with the index, then check the phrase with `indexOf` on the parts fetched. This supersedes DECISION-25 (the idle
  prefetch) and needs a new ADR.
- Size: about a day. `build.js` +~60 lines, `app.js` +~2 KB (budget room: 26.0 / 28 KB), one new invariant: index hits ==
  `indexOf` hits for a sample of word-start queries.

### 3. Re-measure after each OCR batch (5 min, ongoing)
`node build.js && npm run check && node tools/perf/sizes.mjs`. The budgets from step 1 are the tripwire. If step 2 is not done,
re-baseline only with a measured reason, never by habit.

### Considered and not worth doing now
- **Fonts:** already right. Inter preloaded with `swap` and a metric-matched fallback; Fraunces `optional`; CLS is 0.
- **Boot (`copies.json`, 186 KB gzip):** first cards in 0.66 s on 4G / 2.2 s on slow 4G is acceptable; splitting it means a
  second request on the critical path for a small gain.
- **Long tasks (120–170 ms on a 4× slowed phone):** these come from parsing shards while the page loads; input stays under 120 ms.
  Step 2 removes most of the parsing anyway.
- **Brotli (−28 % bytes):** still parked per INTENT-11 (stay on GitHub Pages).
- **Shard field trimming:** ≤ 45 KB in total, measured above.
