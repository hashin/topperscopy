# Topper's Copy — performance audit, 2026-10-04 (real Chrome, throttled)

Audited at `78ace72` against https://topperscopy.hashin.me. Follows `PERF-AUDIT-2026-10-03.md`, whose fixes
(DECISION-25/26/27) are all live. Question asked again: *the number of questions has grown — is it affecting load time?*

**Short answer.** The **first paint is not affected** — it depends only on `copies.json`, which has been flat at 188 KB gzip
for two weeks. **Search on a first visit is affected, linearly**: a search needs every question shard (1.5 MB gzip), and
that is growing ~19 KB/day. On a mid-range phone on slow 4G a cold search takes **11 s** to complete today; each further
100 KB adds ~0.5 s. Repeat visits are fast (13 KB, ~1 s) thanks to the service worker. Three cheap fixes below take seconds
off the first visit without touching search semantics; the bytes themselves need the F4 decision from the last audit.

## How this was measured

The Claude-in-Chrome extension was not connected (`list_connected_browsers` empty, 3 tries), so the installed **Google
Chrome 154** was driven through the DevTools protocol by Playwright — the same browser, plus what neither the extension nor
the built-in pane can do: CPU and network throttling. Harness: `tools/perf/browser.cjs` (header says how to run it).

| Profile | CPU | Network |
|---|---|---|
| desktop | 1× | unthrottled |
| phone-4g | 4× slower | 9 Mbps / 60 ms RTT |
| phone-slow4g | 4× slower | 1.6 Mbps / 150 ms RTT (Lighthouse's mobile profile) |

Viewport 412×900, fresh profile per cold run, median of 2 runs. **Caveat found while measuring:** once the service worker
controls the page, its own fetches bypass the page's network throttle, so cold runs block the service worker (otherwise
slow-4G looked ~3× faster than reality). Repeat runs keep it. Paint timings from headless Chrome are noisy; "first cards"
(a DOM poll) is the reliable boot number.

## 1. Results

| Scenario | First cards | Search complete | Bytes | Max long task | TBT |
|---|---:|---:|---:|---:|---:|
| **desktop** — `/` | 0.45 s | — | 2,036 KB | 0 | 0 |
| desktop — `/?q=ethics` cold | 0.50 s | 0.77 s | 2,036 KB | 0 | 0 |
| **phone-4g** — `/` | 0.74 s | — | 2,036 KB | 104 ms | 210 ms |
| phone-4g — `/?q=ethics` cold | 1.27 s | **2.40 s** | 2,036 KB | 141 ms | 274 ms |
| phone-4g — land, type "judicial activism" | 0.71 s | 2.24 s after focus | 2,036 KB | 122 ms | 223 ms |
| phone-4g — `/?q=ethics` repeat visit | 0.59 s | 1.12 s | **13 KB** | 192 ms | 431 ms |
| **phone-slow4g** — `/` | 2.54 s | — | 2,036 KB | 101 ms | 218 ms |
| phone-slow4g — `/?q=ethics` cold | **4.95 s** | **11.0 s** | 2,036 KB | 109 ms | 251 ms |
| phone-slow4g — land, type "judicial activism" | 2.64 s | **9.3 s after focus** | 2,036 KB | 119 ms | 223 ms |
| phone-slow4g — `/?q=ethics` repeat visit | 0.55 s | 1.04 s | 13 KB | 140 ms | 397 ms |

Of the 2,036 KB on a cold visit: question shards + syllabus 1,526 KB, `copies.json` 194, gtag.js 174, Inter 47, Fraunces 46,
shell 48. Real first visits (service worker allowed) add **+289 KB** more — see G3. Results match production counts
(680 copies / 1,155 questions for "ethics").

Things that are **fine**: per-keystroke search is ~30 ms of script at 4× CPU for a whole query (no long tasks; key events
32 ms); worst input delay seen was 104 ms, while shards were still being indexed; JS heap 24–36 MB (was 67 MB before
DECISION-25).

## 2. Growth — what the questions are doing to the bytes

Today's `build.js` run over older OCR snapshots (same code, so like-for-like):

| OCR snapshot | `ocr-questions.csv` rows | Question shards, gzip | `copies.json`, gzip |
|---|---:|---:|---:|
| 2026-09-18 `e25f58d` | 15,603 | 1,176 KB | 189 KB |
| 2026-09-24 `95b83c0` | 23,341 | 1,312 KB | 189 KB |
| 2026-10-01 `234c115` | 31,290 | 1,446 KB | 188 KB |
| 2026-10-04 `HEAD` | 34,467 | 1,487 KB | 188 KB |

**+16.5 KB gzip per 1,000 OCR rows, ≈ +19 KB/day** (the bot lands ~1,000–1,600 rows in one run per day). Only **3,412 of
9,126 copies (37 %)** have questions yet; the 5,714 without are the remaining growth.

Slow-4G cold search ≈ 3.4 s + shard KB ÷ 200 KB/s (fits the measured 11.0 s); 4G ≈ 1.0 s + KB ÷ 1,100 KB/s (fits 2.4 s).

| When | Shards, gzip | Cold search, slow 4G | Cold search, 4G |
|---|---:|---:|---:|
| today | 1,487 KB | 11 s | 2.4 s |
| ~8 days — `BUDGET prefetch total` (1,650) goes red | 1,650 KB | ~12 s | ~2.5 s |
| ~30 days at today's pace | ~2,050 KB | ~14 s | ~2.9 s |
| every remaining copy OCR'd at today's yield (upper bound) | ~2,900 KB | ~18 s | ~3.6 s |

Text is **82 %** of shard gzip. The per-row cost cannot be fixed by code layout any more — only by shipping less text.

## 3. Findings, ranked

### G1 — Cold search scales with question bytes — **high, growing**
A text search with the default "all papers" filter needs all 15 parts before it is complete. Nothing in the page can make
1.5 MB arrive faster on 1.6 Mbps; only fewer bytes can. Options, best first:
1. **F4 option B from the last audit** (long case-study bodies in a companion file fetched only when someone searches):
   ~−480 KB off the idle prefetch and off every visit that does not search. *Correction after building it (§6): it does
   not shorten a cold all-papers search — that search still needs the bodies — so "~−2.4 s" was wrong.* Still blocked on the open question in `PERF-AUDIT-2026-10-03.md` §7 — practice-history
   ids (`q.id = fnv(paper|full text)`).
2. **Merge near-duplicate OCR rows.** Measured with word-set similarity (Jaccard ≥ 0.6 on the first 400 chars), not the
   prefix test the last audit used: **10,663 GS/Essay rows → 9,301 clusters (13 %)**; GS4 is 20 % (1,854 → 1,276 KB raw text).
   Removing them takes GS/Essay shard gzip **1,414 → 1,206 KB (upper bound, −208 KB ≈ −1 s on slow 4G)**. Typical pairs:
   "Aseismic structure… earthquack" vs the clean text; "Q.10) Do you think that a Uniform Civil Code (UCC)…" vs "a10 Do you
   think UCC…"; the same Tiruvalluvar quote with "Thiruvalluvar". It is also a visible quality fix — Questions view lists these
   twice. Cost: question identity changes for merged rows (same practice-id issue as option 1), and it needs a threshold
   check by eye before it ships. Do it in `build.js`'s dedupe step so refs move to the kept text.
3. Option C (token index) — still only at ~3× corpus.

### G2 — A cold search fetches all 15 parts at once, so the first result waits for nearly all of them — **high, cheap**
`ensureShards()` (app.js:150) starts every part in parallel when a search needs them (`?q=` deep link, typing before the
idle prefetch). In parallel each part gets 1/15 of the bandwidth, so even the 26 KB essay part finishes only after
~400 KB have arrived: on slow 4G the **first card appears at 4.95 s** versus 2.54 s for the plain home page. Only the idle
prefetch uses the 2-at-a-time pump (`scheduleShards`, app.js:170).
**Fix:** route user-triggered fan-out through the same pump (normal priority, 2–3 at a time, smallest parts first). Total time
is unchanged (bandwidth-bound), but progressive results — which `renderBrowse` already shows with "still scanning inside
the copies…" — should start at ~3 s instead of ~5 s (estimate, not measured).

### G3 — The service worker downloads the shell and `copies.json` a second time on every first visit — **medium, trivial, verified**
`sw.js` precaches with `cache:'reload'`, which bypasses the HTTP cache the page has just filled. On a first visit that is
`copies.json` 193 KB + Inter 49 + app.js 25 + index 13 + css 10 = **~289 KB extra**, competing with the first search (≈ +1.4 s
of slow-4G airtime). **Fix:** `cache:'no-cache'` — still asks the server (so the reason for `'reload'`, never precaching a
stale `max-age=600` copy, still holds) but a matching ETag gets a 304 from GitHub Pages. Verified on a local 304-capable server
with real Chrome: SW precache traffic 1,800 → 1,519 KB, each shell file ~210 bytes, the cached `copies.json` complete.
Bump `VERSION`.

### G4 — Every shard arrival re-runs the whole search and rebuilds the cards — **medium, grows faster than the corpus**
CPU profile of a repeat visit to `/?q=ethics` at 4× CPU: `onShardLoaded → rerender → renderBrowse → filteredCopies` is
**~260 ms**, against 134 ms for actually indexing the shards. A render runs once per paper as it arrives (7 times), and each
scans every shard loaded so far. Long tasks reach 140–190 ms on repeat visits (TBT ~400 ms) because the shards then arrive
from the cache in one burst. Smaller items in the same profile: `fmt()` calls `toLocaleString('en-IN')` each time (35 ms
self — a shared `Intl.NumberFormat` is ~10× cheaper); header `sync()` forces a layout on each render (61 ms).
**Fix:** coalesce `onShardLoaded` re-renders to one per animation frame (or ~100 ms) — one search instead of 7 when the cache
answers at once; cache the number formatter.

### G5 — gtag.js — **low**
174 KB transfer and a ~150 ms long task at 4× CPU at ~1.1 s on a repeat visit — about when a returning student starts typing.
It is already deferred to `load` + idle (DECISION-27). Optional: load it on first interaction or after a longer idle timeout.

## 4. Suggested order

| # | Change | Effort | Effect | Risk |
|---|---|---|---|---|
| 1 | G3 `cache:'no-cache'` + VERSION bump | 5 min | −289 KB every first visit | none (verified) |
| 2 | G2 pump user-triggered fetches, smallest first | 30 min | first search results ~5 s → ~3 s on slow 4G | low |
| 3 | G4 coalesce re-renders + cached `Intl.NumberFormat` | 30 min | ~−200 ms main thread per repeat visit at 4× | low |
| 4 | G1.2 near-dupe merge in `build.js` | half day | up to −208 KB, cleaner Questions view | changes question identity — decide with G1.1 |
| 5 | G1.1 = F4 option B | 1 day | −480 KB | needs the practice-id decision |

1–3 are code-only and change nothing about what search finds. 4–5 are the only things that bend the growth curve, and both
hinge on one question for Hashin: **may practice history (`tc-practice` "seen") reset for questions whose text changes?**

## 5. Reproduce
```
node build.js && node tools/perf/sizes.mjs          # bytes by stage
npm i --no-save playwright-core && node tools/perf/browser.cjs https://topperscopy.hashin.me/ 2
```
Growth table: `git worktree add` at HEAD, `git checkout <old> -- data/ocr-questions.csv data/optionals.json data/submissions.csv`,
`node build.js`, sum gzip of `data/questions-*.json`.

## 6. Status — everything above implemented (DECISION-28, same day)

Hashin: "Implement everything … it's okay if the question history is reset for once … do five also properly."
All five items are in; practice history was kept for long questions anyway (their key *is* the old practice id), so only the
~1,180 merged-away wordings reset.

**Bytes** (`node tools/perf/sizes.mjs`): idle prefetch 1,498 → **975 KB** gzip; a cold all-papers search 1,498 → **1,358 KB**
(near-duplicate merge, net of the split's ~2 %); the rest of the long questions (391 KB) only on search / card / Practice;
first-visit duplicate precache −~290 KB. Questions 11,983 → 10,800, refs 52,306 → 52,306.

**Browser A/B** — old (`78ace72`) vs new build, both served by the same local static server (gzip + ETag), Chrome 154 via
`tools/perf/browser.cjs`, median of 2 (3 for the concurrency rows), service worker blocked for cold runs:

| Phone, slow 4G (1.6 Mbps, 150 ms, 4× CPU) | old | new |
|---|---:|---:|
| `/?q=ethics` cold — first results | 5.1–5.5 s | **2.7–3.0 s** |
| `/?q=ethics` cold — complete | 10.2 s | **9.6 s** |
| `/` — bytes after idle | 2,006 KB | **1,483 KB** |
| total blocking time, cold `?q=` | 235–353 ms | **153–176 ms** |
| repeat `?q=ethics` — complete | 1.0 s | **0.76 s** |

| Phone, 4G (9 Mbps, 60 ms, 4× CPU) | old | new |
|---|---:|---:|
| `/?q=ethics` cold — first results | 1.12 s | **0.79 s** |
| `/?q=ethics` cold — complete | 2.29 s | 2.28 s |
| repeat `?q=ethics` — complete | 0.87 s | **0.74 s** |

Honest trade-offs measured:
- The *complete* time of a cold search barely moves — it is bandwidth-bound and the bodies are still needed. What moved is
  when the first results appear (the queue) and what non-searchers download (the split).
- A visitor who browses on 4G and searches later now downloads the long-question rests (~390 KB) at that moment: on slow 4G,
  typing a query after the page had settled went 2.2 → 2.7 s to *complete* (results start appearing at once, from the parts).
  The repeat visit right after a browse-only first visit likewise downloads them once (13 → 406 KB); after that they are cached.
- Visitor downloads run 4 at a time (measured: 2 → 10.0 s, 3 → ~9.8 s, 4 → 9.6 s complete); the idle prefetch stays at 2.

**Verified in Chrome** (local build): idle prefetch fetches 12 files and no `-deep`; a GS4 card shows 7 cut rows that fill in
when its `-deep` files land; search counts match production within a copy (ethics 680 = 680, federalism 316 → 317,
judicial activism 41 = 41); Questions view and Practice work; no page errors. Service-worker upgrade on one origin: a tc-v30
visitor's first view after the deploy is a consistent old version, the next is the new one, and a later query downloads no
shard or `-deep` file at all (cache-first).

**Not measured:** real devices, and the live site (this is not deployed yet).


### 6b. Live, after the deploy (`399f7d9`, same harness, same profiles, production vs production this morning)

| | slow 4G before → after | 4G before → after |
|---|---:|---:|
| cold `?q=ethics` — first results | 4.95 → **3.09 s** | 1.27 → **1.00 s** |
| cold `?q=ethics` — complete | 11.0 → **10.7 s** | 2.40 → 2.51 s (noise) |
| `/` — bytes after idle | 2,036 → **1,505 KB** | 2,036 → **1,504 KB** |
| total blocking time, cold `?q=` | 251 → **209 ms** | 274 → 259 ms |
| **repeat** `?q=ethics` after a browse-only first visit — complete | 1.04 → **0.83 s** | 1.12 → **1.80 s** ✗ |

The ✗ is the trade-off in §6, now measured on the real CDN: a 4G visitor who browsed first and searches on a later visit
downloads the long-question rests then (412 KB), so that one search completes ~0.7 s later than before (results start at
once). On slow 4G it is still faster, because the parts it did prefetch are smaller. Longest task went up ~30 ms (fewer,
larger parts: GS2 is now one 127 KB part). Functional checks on production: identical counts to the local build, 0 `-deep`
on idle, cut rows fill in, redirect pages resolve, no page errors.

**If the ✗ matters:** prefetch the `-deep` files on idle *on a repeat visit only* (the parts already cached ⇒ this visitor
has been here before), keeping the saving for first-time browse-only visitors. Not done — a product call.
