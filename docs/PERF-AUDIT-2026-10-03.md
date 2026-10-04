# Topper's Copy — performance audit, 2026-10-03

Audited at `b7cd460` (HEAD of `main`; byte-identical `assets/app.js` to what
https://topperscopy.hashin.me serves). Question asked: *the number of questions has grown — is it
hurting load time?*

**Short answer.** Not the first paint, and not the CPU. It is hurting the **bytes**: every visitor
now downloads **~1.5 MB (gzip) of question text 100 ms after the page boots**, whether or not they
ever search, and that number is growing ~20 KB/day. The Interviews tab has a separate, much worse
problem (640 KB to read a 1 KB transcript).

## How this was measured

| Method | What it gave | Caveat |
|---|---|---|
| Local build (`node build.js`, 7 s) + gzip/brotli of every shipped file | exact byte sizes | gzip level 6; GitHub's edge gzip is ~5 % larger |
| `curl` against the live site | headers, compression, caching, 404s | — |
| Built-in browser pane on the **live site** (Resource Timing, `performance.memory`, iframe cold-load harness polling `#resultmeta`) | request waterfall, time-to-results, heap | desktop Mac, fast network, **no CPU/network throttling available** — so timings are a *floor*, not phone numbers |
| Node port of `indexShard` / `filteredCopies` (`scratchpad/bench.js`) | parse / index / search CPU | desktop CPU; multiply ×4–6 for a mid-range Android |
| 7 historic commits built in throwaway worktrees | growth curve | architecture changed on 09-14/09-19, so only the last 3 points are like-for-like |

The Claude-in-Chrome extension was not connected (3 attempts), so — at the user's choice — the
built-in browser was used instead.

## 1. Is growth the cause? The numbers

Data a visitor's browser fetches after the shell (everything generated in `data/`, excluding
Interviews), gzip:

| Build | Search-gating data | Note |
|---|---:|---|
| 2026-09-19 (`9022a57`) | 1,669 KB | after the shard rewrite |
| 2026-09-24 | 1,758 KB | |
| 2026-09-30 | 1,905 KB | |
| **2026-10-03 (HEAD)** | **1,975 KB** | +306 KB (+18 %) in 14 days ≈ **+22 KB/day** |

Corpus: 9,126 copies · 12,648 question rows · 52,294 question↔copy refs (the README still says
28,000+; OCR roughly doubled refs since the 09-14 audit's 26,621). `data/ocr-questions.csv` is
34,456 rows and the OCR bot commits ~3×/day.

`DECISION-17` said to revisit the plain-text-shard design "if the corpus grows past ~3×" or a shard
passes ~1.5 MB. The corpus is ~1.9× the 09-14 baseline and the shards total 1.53 MB gz — i.e. the
design is at roughly **60 %** of its own stated limit after three weeks.

### What is in the 1.53 MB of shards

| Part | Raw | gzip | Share |
|---|---:|---:|---:|
| Question **text** | 3,735 KB | 1,189 KB | **78 %** |
| URL tables (copy URL per shard, duplicated from `copies.json`) | 541 KB | 109 KB | 7 % |
| refs / syllabus ids / marks / words | 739 KB | 164 KB | 11 % |

Text length: median 180 chars, p90 554, max 4,495. **965 questions (7.6 %) are > 800 chars and hold
40 % of all text** — the GS4 case studies.

## 2. What a visitor actually experiences (live site, measured)

Boot (cold, desktop, fast link): `copies.json` 193 KB + app.js 24 KB + css 10 KB + Inter 48 KB are
all in flight by 0.78 s; app is interactive ≈ 1.7 s (DCL 1.75 s, load 2.10 s).
**At 1.81 s — 100 ms later — 21 fetches fire at once**: 15 shards + syllabus, 1,631 KB gz, all
`initiator: fetch`, all finishing 1.86–2.32 s on this connection.

Search (iframe cold-load of `/?q=…`, desktop):

| Query | first cards | complete result | main-thread gap |
|---|---:|---:|---:|
| federalism | 94 ms | 307 ms (progressive: 1 → 16 → 316 copies) | 40 ms |
| corruption in administration | 116 ms | ~270 ms | 31 ms |

Browser JS heap after the shards are indexed: **67 MB**.

### Modelled phone timeline (arithmetic from bytes, not measured)

| | 4G (9 Mbps) | slow-3G (1.6 Mbps) |
|---|---:|---:|
| Critical path to first cards (≈ 300 KB) | ~0.3 s + RTTs | ~1.5 s + RTTs |
| Background prefetch (1.5 MB) | ~1.4 s | **~7.7 s**, sharing the pipe with fonts/GA/any click |
| Fully search-ready | ~2 s | **~9–10 s** |

The 09-14 audit measured 4.5 s cold search on slow-3G with 1.97 MB; payload is now lower per
query but the *unconditional prefetch* is the same size class.

### CPU is not the problem (yet)

Node, full corpus: `copies.json` parse 7 ms + 15 shards parse 17 ms + index 50 ms = **~75 ms**
(≈ 300–450 ms on a mid-range phone, spread across 15 separate tasks, worst single shard 8 ms ≈
35–50 ms on phone). One search: **4–13 ms** (≈ 25–80 ms on phone); typing "corruption"
letter-by-letter totals 58 ms. Fine. This will matter only if the corpus ~3×.

## 3. Findings, ranked

### F1 — Unconditional 1.5 MB prefetch on every visit — **high**
`assets/app.js:131-139` (`scheduleShards`) calls `ensureShards()` on idle for everyone. Anyone who
lands from Google on `/question/…`/`/topper/…`, taps "Open PDF", or just browses pays 1.5 MB on a
metered phone connection. `Save-Data`/2G only delays it 6 s ("search is the product"), it doesn't
skip it.

**Fix (small).**
1. Skip the idle prefetch when `saveData` or `effectiveType` is not `4g`; keep the existing
   `focus`/`input` triggers (`app.js:368-371`) so the first keystroke still starts it.
2. Otherwise prefetch with `fetch(url, {priority:'low'})` and **sequentially** (2 at a time, biggest
   papers first) so it never competes with the user's own taps, fonts or GA.
3. Show "Search is warming up…" instead of fetching 15 files in parallel (each file in a long
   parallel burst also has its own TLS/H2 stream overhead on high-RTT links).

### F2 — Interviews: 640 KB to read one transcript — **high (for that tab)**
`ensureInterviewList` = 205 KB gz on tab open (1.08 MB raw, 3,863 rows, ~16 fields each, mostly
`null`). `interviewText` fetches the **whole year shard**: `interview-text-2025.json` = **639 KB gz /
1.6 MB raw** (live) to show a transcript averaging 2,447 chars (~1 KB gz). 2023 is 651 KB; every
opened year costs this once. ~600× over-fetch.

**Fix (small, build.js only).** Emit transcripts in ~40–60 chunks keyed by a stable bucket
(`id` hash or sequential 64 per chunk) → ~20–40 KB gz per open; or one file per interview
(`data/iv/<id>.json`, ~1 KB — the repo already deploys 12k small HTML pages, so file count is not a
constraint). In the list, drop null fields / use columnar arrays: 205 KB → likely ~120 KB.

### F3 — Cache invalidation: every OCR commit re-downloads most shards — **high for returning users**
GitHub Pages serves `cache-control: max-age=600`, `etag`, **gzip only (no brotli)**. `deploy.yml`
rebuilds + redeploys on every push; OCR commits land ~3×/day, and `writeShards()` re-splits papers
each build, so part boundaries move and most `questions-*-N.json` change on every deploy. A returning
visitor (even with the service worker) re-downloads whatever changed — typically ~all 1.5 MB —
with no way for unchanged data to stay cached.

**Fix.**
- Content-hash filenames for shards (`questions-gs4-2.<hash8>.json`) and list them in `copies.json`
  (or a tiny `manifest.json` that is the only mutable data file). Unchanged shards then stay in the
  HTTP/SW cache forever.
- Stable split points: bucket questions by hash of their text (or by year) rather than by running
  size, so adding questions only touches 1–2 parts.
- Put Cloudflare (free) in front of the custom domain: **brotli** (shards 1,530 → 1,118 KB; copies
  187 → 136 KB; interviews ~ −25 %), `immutable` + 1-year cache for hashed files, HTTP/3.

### F4 — Question text is 78 % of payload; long case-study bodies are 40 % of the text — **medium, biggest structural lever**
**Fix options, cheapest first:**
1. *Search the first ~300 chars; lazy-load the rest.* 965 questions hold 40 % of text
   (≈ 480 KB gz). Ship `{lead, id}` in the search shards and fetch the full body when a card is
   expanded (or ship bodies in a separate "detail" shard prefetched only on demand). Trade-off:
   matches deep inside a long case study no longer hit — decide whether that's acceptable
   (a keyword index over the full text, F4.3, avoids the trade-off).
2. *Drop the per-shard URL tables* (109 KB gz, 7 %): refs can index into `copies.json`'s order
   directly (copy index = array position) instead of repeating URLs. Also removes the
   `url → copy` object lookup during indexing.
3. *Move to a prebuilt token index* (what `DECISION-17` measured: ~475 KB gz for all text tokens
   incl. variants) + text fetched for only the ~25 displayed results via small chunks. This is the
   only option that makes payload ~flat as the corpus grows. Biggest change; the right call once
   total passes ~2.5 MB gz or ~3× corpus.
4. *Dedupe near-identical OCR rows* — 54 % of rows are single-copy; `variants` handling exists
   for exact dupes but OCR noise creates many near-dupes. Worth a measurement before building.

### F5 — Deep links / early typing request shards that don't exist (404) — **low-medium, easy**
`boot()` calls `ensureShards()` for `?q=`, `?syl=`, or text typed before `app.js` boots *before*
`copies.json` has loaded, so `SHARD_PARTS` is empty and the app requests `questions-gs1.json`,
`-gs2.json`, `-gs4.json` — **all 404** (9.4 KB GitHub 404 page each, 28 KB wasted, verified live).
It self-heals only because the real part URLs get requested afterwards, but:
- `ensureShard` sets `SHARD_ERR[name]=true` and fires a `data_error` GA event on each (noisy analytics);
- a transient state shows **"16 copies for “federalism”" with no "still scanning" label** before the
  real 316 arrives (~50 ms) — a wrong-looking count.

**Fix.** Move those `ensureShards()` calls into the `copies.json` `.then()` (after `SHARD_PARTS`
is set), or inline `shardParts` in `index.html` via a build marker so it's known at parse time.

### F6 — Fonts — **low-medium**
Inter is preloaded (48 KB). **Fraunces (66 KB) is not preloaded**, is discovered via CSS, fetched at
~1.7 s, and is `font-display: optional` — on a slow link the swap window is missed and headings
stay on the fallback for that visit (inconsistent look *and* 66 KB downloaded anyway). Fix: subset
Fraunces to the weights/glyphs actually used (likely ≤ 20 KB), preload it, or drop it for a system
serif.

### F7 — Third parties / hygiene — **low**
- GA4 (`gtag/js`) loaded `async` in `<head>` + 2 preconnects; real transfer ~90 KB and not visible in
  Resource Timing (no TAO). Load it after `load`/first interaction.
- `index.html` is 43 KB raw / 12 KB gz because the SEO `<noscript>` block (lines 161-329) and JSON-LD are
  inlined. It's fine, but it is parsed by every visitor; could be emitted only into `toppers.html`/static
  pages.
- JS heap 67 MB with all shards indexed — acceptable, but a 2 GB phone with other tabs may evict the page;
  F4.2/F4.3 shrink it.
- Deploy artifact: `question/` 100 MB (10,969 pages), `topper/` 16 MB, `dataset/` **46 MB** (backup not
  loaded by the site) on every deploy ×3/day. Not a user-visible latency issue; costs deploy time and
  headroom against the 1 GB Pages cap. Consider publishing `dataset/` as a release asset instead.
- `tools/perf/` and `tools/check/` referenced by `CLAUDE.md` and `docs/DECISIONS.md` no longer exist
  (only `tools/check.mjs` does), so the committed perf harness is gone — re-adding a trimmed
  `measure.mjs` would let the budget ratchet work again.

## 4. Suggested order of work

| # | Change | Effort | Saves | Risk |
|---|---|---|---|---|
| 1 | F5: init shards after `copies.json` | 15 min | 28 KB + analytics noise + wrong transient count | none |
| 2 | F1: gate/serialize prefetch, `priority:'low'` | 1 h | 1.5 MB for non-searchers | low — search warms on focus |
| 3 | F2: chunk interview transcripts | 2 h | ~600 KB per transcript opened | low |
| 4 | F3a: Cloudflare in front (brotli + long cache) | 1 h (DNS) | ~27 % of every byte | needs Pages custom-domain DNS change |
| 5 | F3b/c: hashed + stable-split shards | half day | repeat-visit re-downloads → ~0 | medium (SW + manifest) |
| 6 | F4.2: drop URL tables | 2 h | 109 KB gz | low |
| 7 | F6: subset/preload Fraunces | 1 h | ≤ 45 KB + consistent headings | low |
| 8 | F4.1 / F4.3: lazy case-study bodies or token index | 1–3 days | 480 KB → ~1 MB gz, flat growth | medium-high; changes search semantics |

Items 1–3 + 6 are code-only inside this repo and together cut a casual visit from ~1.7 MB to ~0.3 MB
and an interview read from ~845 KB to ~240 KB (list + one chunk).

## 5. Re-measure checklist
- `node build.js && npm run check` then re-run the byte table in §1.
- Throttled run: `Chrome DevTools → Performance → 4× CPU, Slow 4G` on `/`, then type "ethics";
  record LCP, time-to-"680 copies", longest task. (Not possible from this audit's tooling.)
- Lighthouse mobile on `/`, `/question/<slug>/`, `/topper/<slug>/`.

## 6. Status of every finding (updated 2026-10-04)

| Finding | Status | Where |
|---|---|---|
| F1 unconditional prefetch | **done** | DECISION-25 |
| F2 interview transcripts | **done** | DECISION-25 |
| F3 cache invalidation | **done for service-worker visitors**; CDN step left for Hashin | DECISION-27 |
| F4 question text | URL tables cut (DECISION-25); lazy bodies / token index **not done — needs a decision** | DECISION-27 "Rejected" |
| F5 shard 404s on deep links | **done** | DECISION-25/26 |
| F6 Fraunces | **done** (66 → 45 KB, not preloaded — see DECISION-27) | DECISION-27 |
| F7 GA, harness | **done** (GA lazy, `tools/perf/sizes.mjs`, `prefetch total` budget); `dataset/` 46 MB and the `<noscript>` block deliberately left | DECISION-27 |

### Getting brotli and long caching for visitors without a service worker — **parked** (INTENT-11: no Netlify; Hashin hasn't asked for the others)

GitHub Pages cannot set headers or serve brotli. Read `CLAUDE.md` → "Open items" first: **`hashin.me` DNS is at Spaceship, not
Cloudflare, and the domain runs iCloud custom-domain mail** (`MX mx01/mx02.mail.icloud.com`, the SPF TXT, `apple-domain=` TXT).
Putting Cloudflare in front means moving the *whole domain's* nameservers; if those mail records don't carry over exactly, mail
breaks silently. So there are two real options:

| Option | What changes | Risk |
|---|---|---|
| **A. Netlify or Vercel free tier** | One CNAME for `topperscopy` at Spaceship; the zone and all mail records stay put. They serve brotli and let you set `Cache-Control: immutable` on `/data/questions-*.json?v=*` via a `_headers` / `vercel.json` file in the repo. | Check their ~100 GB/month free bandwidth cap against real traffic. Deploy workflow changes. |
| **B. Cloudflare, full setup** | Move nameservers to Cloudflare; proxied CNAME for `topperscopy`; Cache Rule on `/data/questions-` + `v=` (edge + browser TTL 1 year); brotli/HTTP3 on. | Mail. Snapshot every Spaceship record first and diff after import. Only worth it if you want the whole domain on Cloudflare anyway. |

Either way the repo side is already done: `?v=<hash>` URLs are content-addressed (DECISION-27), so a year-long cache on them is safe.
Expected effect (measured with `node tools/perf/sizes.mjs`): idle prefetch 1,498 → 1,085 KB, `copies.json` 188 → 136 KB, and a visitor
*without* a service worker stops re-downloading unchanged parts after each deploy. Visitors **with** the service worker already get that
from DECISION-27; the CDN only adds brotli for them on first visit. Verify with
`curl -sI -H 'Accept-Encoding: br' https://topperscopy.hashin.me/data/copies.json` → `content-encoding: br`.
