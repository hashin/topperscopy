# Toppers Copy — performance & UX audit, 2026-09-14

Audited at `d60292c` ("ocr: gemini vision pass"). Every number below was **measured**, on a real
build, in real Chromium, under CPU and network throttling. Repro commands are included and the
harness is committed to `tools/perf/`.

The previous audit (`AUDIT-2026-09-09.md`, B1–B21) was about **correctness**. All 21 items are
fixed and verified fixed. This audit is about **speed and feel** — what a student on a ₹8,000
Android phone on a patchy 4G connection actually experiences.

---

## How to use this document

It is split into **7 phases**. Each phase is sized to fit comfortably in one Claude Sonnet session
and is **independently shippable and independently revertible**. Work them in order — later phases
assume earlier ones landed, and the dependency notes say exactly where that matters.

**Per-phase protocol:**

1. Read this document's phase section only (plus `CLAUDE.md`). Do not read `data/*.json`,
   `toppers.html`, `question/`, `topper/`, `dataset/` — they are large and generated.
2. Run `npm run check` and `node tools/perf/baseline.mjs` **before** touching anything, and save
   both. `npm run check` is the fast one (~2 s) — it tells you which invariants already hold.
3. Make the changes, one commit per lettered item.
4. Run `node build.js` — must exit 0, counts must not move unexpectedly.
5. Run `node tools/perf/baseline.mjs` again and paste the before/after into the commit message.
6. Run `npm run check` again. Any invariant your phase fixes must flip from ⏳ to ✅ — **promote it
   to `enforced` in `tools/check/invariants.mjs`** and, if it was a budget, lower the ceiling in
   `tools/check/budget.json`. That ratchet is the whole mechanism; skipping it means the win can
   silently regress later.
7. Tick the item's checkbox in the "Progress" table at the bottom of this file.
8. Append an entry to `docs/SESSIONS.md` (see `docs/MEMORY.md` for the protocol and template).

**The harness.** `tools/perf/` is committed and every number in this document is reproducible with
it. `npm install` (adds `playwright-core`, dev-only, not used by `build.js` or CI), `node build.js`,
then `npm run perf`. It does **not** download Chromium — it finds an existing one, or you point
`TC_CHROMIUM` at Chrome. Full details in `tools/perf/README.md`, including the seven verification
scripts that **each phase is expected to write as part of its own work**.

**Ground rules (from `CLAUDE.md`, still binding — none of this document overrides them):**

- Vanilla ES5-ish in `assets/app.js`. No frameworks, no bundler, no TypeScript, no npm runtime deps.
- Everything stays free and static. No paid services in the request path.
- Generated files stay gitignored. `index.html` **is** tracked and **is** rewritten by `build.js`;
  commit it only when a marker block genuinely changed.
- Nothing is re-hosted; credit to upsckata.com stays prominent.

---

## Measured baseline (what it is like today)

Build at `d60292c`: 8,075 copies · 8,102 distinct questions · 26,621 question instances · 1,520 toppers.

### Bytes on the wire (gzip, as GitHub Pages serves them)

| File | Raw | gzip | What gates on it |
|---|---:|---:|---|
| `index.html` | 40.3 KB | 11.3 KB | first paint |
| `assets/style.css` | 31.7 KB | 7.5 KB | first paint (render-blocking) |
| `assets/app.js` | 80.5 KB | 23.8 KB | interactivity |
| `assets/extract.js` | 5.3 KB | 2.3 KB | **nothing** — see P8 |
| fonts (Inter + Fraunces) | 115.8 KB | 115.8 KB | headings/body (woff2 is already compressed) |
| `data/index.json` | 204.6 KB | 25.3 KB | the first 25 cards |
| `data/toppers.json` | 228.2 KB | 24.5 KB | tags on cards |
| `data/optionals.json` | 398.9 KB | 32.1 KB | Optionals tab |
| `data/copies.json` | 2,553.7 KB | **329.8 KB** | searching inside copies |
| `data/questions.json` | 5,551.5 KB | **1,639.4 KB** | searching inside copies |
| `data/syllabus.json` | 34.1 KB | 10.9 KB | syllabus filter |
| **Total first-party** | | **2,220 KB** | |

> Reproduce: `node tools/perf/sizes.mjs`

### Real browser timings

Chromium, 390×844 mobile viewport, **CPU throttled 4×** (≈ a mid-range Android), network throttled.

| Metric | 4G (9 Mbps, 170 ms RTT) | Slow 3G (1.6 Mbps, 300 ms RTT) |
|---|---:|---:|
| FCP / LCP | **676 ms** | **1,044 ms** |
| First 25 cards painted | yes, at LCP | yes, at LCP |
| CLS | 0 | **0.193** ⚠️ |
| **Cold search — type "federalism", wait for real results** | **2,670 ms** | **4,455 ms** |
| ...of which showing the literal text "**0 copies**" | 1,108 ms → 2,670 ms | 739 ms → 4,455 ms |
| Keystroke cost once loaded (input → repaint) | ~250 ms (86–91 ms long task) | same |
| First-ever search (resolves all question rows) | 763 ms (**235 ms long task**) | same |
| Longest main-thread block during cold search | **845 ms** | **845 ms** |

> Reproduce: `node tools/perf/measure.mjs 4g` and `node tools/perf/measure.mjs 3g`

### The one-sentence summary

**First paint is genuinely good (676 ms). Search is not: the site downloads 1.97 MB before it can
answer the first query, and while it waits it tells the student "0 copies".**

### Phase 1 landed — 2026-09-14

The table above is the original baseline and is left as the historical record. After Phase 1
(P1–P11, measured the same way):

| Metric | Before | After Phase 1 |
|---|---:|---:|
| CLS, slow 3G mobile | **0.193** ❌ | **0.0014** ✅ |
| Shows "0 copies" mid-load | yes, for 2.7 s / 4.5 s | **never** ✅ |
| "Show more" moves the card you were reading | up to **785 px** | **0 px** ✅ |
| Query typed before `app.js` boots | silently dropped | **adopted** ✅ |
| FCP / LCP, 4G | 676 ms | **536 ms** |
| Requests on first load | 13 | 12 (`extract.js` no longer eager) |
| `npm run check` | 14/14 enforced, 0/8 tracked | **22/22 enforced**, 2 tracked left (D1, R3) |

Payload is unchanged, as expected — that is Phases 3–5. Phase 1 was about what the interface
*does* with the payload it has.

---

## The three structural problems

Everything in Phases 1–6 traces back to one of these.

### S1 — The search index ships the whole haystack to find the needle

`data/questions.json` is 5.42 MB raw / 1.64 MB gzip. Field-by-field:

```
q  (question text)   2.28 MB   needed only to DISPLAY the ~25 matches on screen
sl (slug)            0.56 MB   NEVER READ BY THE CLIENT — dead weight (verified: no `.sl` in app.js)
a  (answer refs)     0.23 MB   needed to search
s  (syllabus tags)   0.09 MB   needed to filter
i,p,m,w,yr           0.17 MB   needed
```

The client downloads 1.64 MB to run `indexOf()` over 8,102 strings. A conventional inverted index
over the same corpus is **292 KB gzip** — 5.6× smaller — and answers the same queries.

> Reproduce: `node tools/perf/index-proto.mjs`

### S2 — The two big files load in series, not in parallel

`assets/app.js`, `loadQuestionIndex()`:

```js
qiPromise = ensureFullPromise().then(function () {
  return Promise.all([ fetchAtBuild('data/questions.json', DB && DB.build), ... ]);
})
```

`questions.json` (1.64 MB) does not start downloading until `copies.json` (330 KB) has fully
downloaded **and parsed**. On slow 3G that is ~1.8 s of dead air before the big file even starts.

The serialisation exists for a real reason — the B1 fix — but it is the wrong fix for it. See S3.

### S3 — Copy ids are positional, so nothing can be cached for long

`build.js` line 233: `copies.push({ i: i++, ... })`. Insert one row upstream and ~87 % of ids shift
(this is exactly what AUDIT B1 documented). B1's remedy was a build stamp plus a "refuse to merge
across builds" check. That makes wrong data impossible, but it leaves three consequences:

1. The files must load in series (S2), because `questions.json`'s refs are only meaningful against
   the build `copies.json` came from.
2. On a build-id mismatch, `fetchAtBuild` re-fetches with a cache-buster — and `sw.js` passes any
   query string straight to the network. A returning visitor after a nightly OCR commit can
   **download `questions.json` twice: 3.3 MB**.
3. Nothing can carry `Cache-Control: immutable`, so every repeat visit revalidates.

The root fix is a **content-derived id** (hash of the copy URL). Phase 4.

---

# Phase 1 — Perception and correctness bugs

**No architecture change. Small diffs. Ship this first — it is most of the felt improvement.**

Dependencies: none. Estimated: one session, comfortably.

---

## P1 — CRITICAL (UX): the app says "0 copies" while the index is still downloading

**This is the single worst bug on the site.** For 2.7 s on 4G and 4.5 s on slow 3G, a student who
types `federalism` reads:

```
0 copies for "federalism" · still scanning inside the copies…
```

The eye lands on **"0 copies"**. The reasonable conclusion is *this site doesn't have it*, and the
student leaves — 2.7 seconds before the 162 real results arrive.

### Repro

```bash
node tools/perf/measure.mjs 4g      # look at the "showed '0 copies' at +NNNms" line
```

### Fix

`assets/app.js`, in `renderBrowse()`. Find:

```js
    $('#resultmeta').textContent = fmt(realN) + ' ' + (realN === 1 ? 'copy' : 'copies') +
```

While `loading` is true **and** the count is zero, never print a count. Replace the whole
`#resultmeta` assignment with:

```js
    var meta;
    if (state.q && loading && realN === 0) {
      // The index isn't down yet — a "0 copies" here reads as "no such question" and the
      // student leaves before the real results land. Say what is actually happening.
      meta = 'Searching inside ' + fmt((DB.stats && DB.stats.all && DB.stats.all.copies) || 0) + ' copies…';
    } else {
      meta = fmt(realN) + ' ' + (realN === 1 ? 'copy' : 'copies') +
        (state.q
          ? ' for “' + state.q + '”' +
            (nameHits ? ' · ' + fmt(nameHits) + ' by topper name' : '') +
            (totalQ ? ' · ' + fmt(totalQ) + ' matching questions' : '') +
            (stubHits ? ' · fetching copies for ' + fmt(stubHits) + (stubHits === 1 ? ' more topper…' : ' more toppers…')
              : (loading ? ' · still scanning inside the copies…' : ''))
          : (loading ? ' · more copies + full-text search loading…' : ''));
    }
    $('#resultmeta').textContent = meta;
```

Also fix the empty state just below it. Find `'Searching…'` in the `if (!list.length)` block — it
is already correct, but the `.big` line must not be reachable with a "No matches" while loading.
Verify by reading: `loading ? 'Searching…' : failed ? … : 'No matches'` — that is right, leave it.

### Verify

```bash
node tools/perf/measure.mjs 4g
# the "showed '0 copies' at" line must now read: never
```

---

## P2 — HIGH: a query typed before `app.js` boots is silently thrown away

`#q` is visible and focusable from first paint (676 ms). `assets/app.js` is `defer`, so on a slow
link the input listener is attached noticeably later. Anything typed in between stays in the box and
is **never searched** — `boot()` reads `?q=` from the URL but never reads the input's own value.
The box shows `federalism`, the results show all 8,075 copies, and nothing will fix it until the
student types one more character.

The same bug fires on **back-navigation**, where the browser restores the field's value.

### Repro

Throttle to slow 3G, load the page, type into the box the instant it appears, wait. Result count
stays at the unfiltered total. (This reproduced by accident in `tools/perf/measure.mjs` before it
was taught to wait for the app to wire up.)

### Fix

`assets/app.js`, in `boot()`. Find:

```js
    var qp = new URLSearchParams(location.search).get('q');
    if (qp) { qp = qp.trim().slice(0, 200); state.q = qp; state.shown = PAGE; var qi = $('#q'); if (qi) qi.value = qp; }
```

Replace with:

```js
    var qi = $('#q');
    var qp = new URLSearchParams(location.search).get('q');
    // Also adopt anything already sitting in the box: the field is live from first paint but
    // app.js is deferred, so a fast typist's query — and any value the browser restored on a
    // back-navigation — would otherwise be shown but never searched.
    if (!qp && qi && qi.value) qp = qi.value;
    if (qp) {
      qp = qp.trim().slice(0, 200);
      state.q = qp; state.shown = PAGE;
      if (qi && qi.value !== qp) qi.value = qp;
      if (qp) { ensureFull(); ensureQI(); }
    }
```

### Verify

```bash
node tools/perf/lost-keystroke.mjs
# must print: adopted = true
```

---

## P3 — HIGH: CLS 0.193 on slow connections (Core Web Vitals "needs improvement")

Measured 0.1928 on slow 3G mobile, in a single shift at t≈2,295 ms. Attributed to:

```
p.credit      moved y 327 -> 453   (+126px)
div.toolbar   moved y 561 -> 687, height 283 -> 157
div#papers    height 10 -> 0 -> 84
div#mode      height 45 -> 0
div.filters   height 28 -> 0
```

Two independent causes, both "empty div that JS fills later":

- `#statline` (`index.html:99`) is empty at first paint and grows to **74 px on mobile / 34 px on
  desktop** when `refreshFacets()` runs.
- `#papers` (`index.html:129`) is an empty `.seg` (10 px) that `buildPaperSeg()` clears with
  `innerHTML = ''` and refills to **84 px on mobile / 45 px on desktop**. The clear-then-refill is
  what produces the transient `height -> 0` in the trace.

Google's threshold for "good" is CLS ≤ 0.1. This is 0.193.

### Repro

```bash
node tools/perf/cls.mjs
```

### Fix — reserve the space, and stop the clear-then-refill flash

**1. `assets/style.css`** — reserve both boxes at both breakpoints. Add next to the existing
`.statline` rule:

```css
/* Both boxes are filled by JS after data lands. Without a reserved height the fill
   shifts the whole page (measured CLS 0.193 on slow 3G). Values are the measured
   filled heights — re-measure with tools/perf/cls.mjs if the contents change. */
.statline { min-height: 34px; }
#papers   { min-height: 45px; }
@media (max-width: 680px) {
  .statline { min-height: 74px; }
  #papers   { min-height: 84px; }
}
```

**2. `assets/app.js`, `buildPaperSeg()`** — build off-DOM and swap once, so the row never measures
zero. Find:

```js
    var row = $('#papers'); row.innerHTML = '';
```

and the loop that appends to `row`. Change it to append into a `DocumentFragment` and do a single
`row.replaceChildren(frag)` at the end (with an `innerHTML = ''` + `appendChild` fallback for old
browsers). Apply the same pattern in `fillSelect()` and `fillSyllabus()`.

### Verify

```bash
node tools/perf/cls.mjs
# total CLS must be < 0.05 (target: 0.00)
```

---

## P4 — HIGH: "Show more" throws the reading position 478–668 px down the page

`renderBrowse()` does `box.innerHTML = ''` and rebuilds **every** card from scratch. "Show more"
calls it, so clicking it destroys the 25 cards you were reading and rebuilds 50. The document
momentarily collapses, the browser clamps the scroll offset, and the card you were reading jumps.

Measured, mobile, CPU 4×:

```
click 1: cards 25->50  | scrollY 3147->3932  | the card you were reading moved 785px
click 2: cards 50->75  | scrollY 6274->6752  | the card you were reading moved 478px
click 3: cards 75->100 | scrollY 9714->10205 | the card you were reading moved 491px
worst drift: 785px
```

It also re-does the whole filter+sort pass and discards every expanded `<details>` outside the
`reopen` list.

### Repro

```bash
node tools/perf/showmore.mjs
```

### Fix — append instead of rebuild

`assets/app.js`. `renderBrowse()` currently takes `reopen`; give it an append path.

1. Cache the computed list on the module scope so "Show more" does not re-filter and re-sort:

```js
  var LASTLIST = null;   // result of the last filteredCopies(), reused by the Show-more append path
```

2. In `renderBrowse()`, after `var list = filteredCopies();` add `LASTLIST = list;`.

3. Extract the per-card append loop (the `list.slice(0, state.shown).forEach(...)` body plus the
   year-group header logic) into `appendCards(list, from, to, box)`.

4. Replace the "Show more" handler. Find:

```js
      more.addEventListener('click', function () { state.shown += PAGE; renderBrowse(); });
```

   with:

```js
      more.addEventListener('click', function () {
        // Append only. renderBrowse() would innerHTML='' the list, which collapses the
        // document and throws the reader's scroll position ~500-670px (measured).
        var from = state.shown;
        state.shown += PAGE;
        var list = LASTLIST || filteredCopies();
        more.remove();
        appendCards(list, from, state.shown, box);
        if (list.length > state.shown) box.appendChild(makeMoreButton(list, box));
      });
```

   Factor the button construction into `makeMoreButton(list, box)` so both paths share it.

Keep the year-group header state (`curY`) on the box as a data attribute, or recompute it from the
last rendered card, so appended groups do not repeat a header.

### Verify

```bash
node tools/perf/showmore.mjs
# drift must be < 8px on every click, and the card you were reading must stay put
```

---

## P5 — MEDIUM: every settled query runs the entire search twice

`assets/app.js`, `wireBrowse()`:

```js
    $('#q').addEventListener('input', debounce(function (e) {
      ...
        results: filteredCopies().length   // plain array — never had a .pending flag
      });
    }, 900));
```

The analytics handler calls `filteredCopies()` again — a full scan of 8,102 question texts plus a
filter and sort of 8,075 copies — purely to put a number in a GA event. Measured cost of one `filteredCopies()` on this corpus: **1.8–4.9 ms** on a fast desktop core, so
roughly **7–20 ms on a mid Android**, burnt for telemetry 900 ms after the user stopped typing.
It is not huge — but it is the entire search, run twice, for a number the render already knew.

### Fix

Record the count from the render that already happened. Add to the module scope:

```js
  var LASTCOUNT = 0;   // result count from the most recent render, for the search analytics event
```

Set `LASTCOUNT = list.length;` in `renderBrowse()` right after `LASTLIST = list;` (and the equivalent
in `renderQuestions()`). Then in the analytics handler replace `results: filteredCopies().length`
with `results: LASTCOUNT`.

### Verify

Add a temporary `console.count('filteredCopies')` at the top of `filteredCopies()`, type a query,
stop. It must log once per settled query, not twice.

---

## P6 — NO ACTION: the sort is already fast. Do not "optimise" it.

**This item is here to stop someone making the site slower.** It is the obvious micro-optimisation
in `filteredCopies()`, it is wrong, and I nearly recommended it.

`filteredCopies()` sorts up to 8,075 rows with `a.c.t.localeCompare(b.c.t)`. The textbook advice is
to hoist an `Intl.Collator`, because `String.prototype.localeCompare` supposedly re-resolves a
collator per call. On V8 that advice is **out of date** — `localeCompare` has a fast path, and a
custom `Intl.Collator` with `numeric`/`sensitivity` options forces a slower ICU collation.

Measured properly — warmed up, interleaved, median of 15 (`node tools/perf/sortbench.mjs`):

```
worst case (shuffled input):
  localeCompare (current)       4.46 ms      <- fastest
  Intl.Collator (hoisted)      12.41 ms      <- 2.8x SLOWER
  plain < > (no collation)      4.61 ms

as the app actually sees it (copies.json order, already mostly sorted):
  localeCompare (current)       0.41 ms      <- fastest
  Intl.Collator (hoisted)       1.23 ms
  plain < > (no collation)      1.20 ms
```

Two conclusions:

1. Swapping in a hoisted collator would have made every keystroke **~3× slower at this step**.
2. The sort costs **0.41 ms** on real input. It is not a bottleneck and never was. The
   per-keystroke cost lives in the question scan and the DOM rebuild (P4, R1), not here.

> **Methodology note, because it changed the answer.** An unwarmed, non-interleaved benchmark of
> this reported `localeCompare` at 3.84 ms and `Intl.Collator` at 1.51 ms — i.e. it recommended
> exactly the wrong change. JIT warm-up order dominated the result. `tools/perf/sortbench.mjs`
> now warms every implementation before timing and interleaves the rounds. **Apply the same
> discipline to any micro-benchmark in this codebase before acting on it.**

### Fix

None. Leave `localeCompare` as it is.

### Verify

```bash
node tools/perf/sortbench.mjs   # localeCompare must still be the fastest row
```

---

## P7 — MEDIUM: `#resultmeta` is not a live region, so screen readers announce nothing

`index.html:150` is `<p class="resultmeta" id="resultmeta"></p>`. Its text is the only feedback that
a search returned anything. With no `role="status"` / `aria-live`, a screen-reader user types a
query and hears silence — the result count changes with no announcement. WCAG 2.2 **4.1.3 Status
Messages (Level AA)**.

### Fix

`index.html` — edit the element directly (it is not inside a build marker):

```html
    <p class="resultmeta" id="resultmeta" role="status" aria-live="polite" aria-atomic="true"></p>
```

`aria-atomic="true"` makes the whole sentence re-read rather than just the changed fragment.

Because `renderBrowse()` writes this on every keystroke, the 160 ms debounce is doing double duty as
announcement throttling — that is fine and is why `polite` (not `assertive`) is correct.

### Verify

```bash
node tools/perf/a11y.mjs
# must report: resultmeta live region = polite
```

---

## P8 — LOW: `assets/extract.js` is downloaded and parsed on every visit, for nothing

`index.html:592` loads it eagerly:

```html
<script src="assets/extract.js" defer></script>
```

It is used in exactly two places — `assets/analyse.js:147` and `app.js:1620`, both inside the
**Submit** flow. `analyse.js` is already lazy-loaded by `loadAnalyser()`. `extract.js` is not, and it
is also in `sw.js`'s `SHELL` precache list. Every visitor pays 2.3 KB gz plus a parse and a request
for a file that only submitters need.

### Fix

1. **`index.html`** — delete the `<script src="assets/extract.js" defer></script>` line.
2. **`assets/app.js`, `loadAnalyser()`** — load `extract.js` first, then `analyse.js`. Chain the two
   existing script-injection promises so `TC.extract` is defined before `analyse.js` runs.
3. **`sw.js`** — remove `'./assets/extract.js'` from `SHELL` and bump `VERSION` to `tc-v22`.

### Verify

```bash
node tools/perf/measure.mjs 4g
# assets/extract.js must NOT appear in the transfer list
```
Then open Submit → "Estimate the questions" and confirm extraction still works.

---

## P9 — LOW: three documented optimisations do not exist in the code

`README.md` "Performance" claims all three of these. None is present. Verified:

```bash
grep -c content-visibility assets/style.css   # -> 0   (README: "content-visibility: auto on result cards")
grep -c prefetch index.html                   # -> 0   (README: "copies.json prefetched")
grep -c fraunces index.html                   # -> 0   (README: "Both are <link rel=preload>ed")
```

Two of them are worth actually implementing; one is worth deleting from the README.

### Fix

**(a) Implement `content-visibility`.** Real win: result cards below the fold skip layout and paint.
`assets/style.css`, on the card rule:

```css
.copy {
  /* Cards below the fold skip layout+paint until scrolled near. contain-intrinsic-size is
     the measured median collapsed card height — without it the scrollbar jumps. */
  content-visibility: auto;
  contain-intrinsic-size: auto 96px;
}
```

Measure the real median collapsed card height first (`tools/perf/cardsize.mjs`) and use that number;
a wrong `contain-intrinsic-size` trades paint cost for scrollbar jitter, which is worse.

**(b) Do NOT add the `copies.json` prefetch.** Phase 3 replaces the file-loading strategy entirely,
and a `prefetch` at `<head>` time would compete with `index.json` for the first-paint bandwidth on
exactly the connections that can least afford it. Delete the claim from the README instead.

**(c) Do NOT preload Fraunces.** It is `font-display: optional` (`style.css:20`), which means on a
cold load the browser will not use it anyway — it renders the fallback serif and keeps the download
for the *next* navigation. Preloading a font you have told the browser not to use costs 65.8 KB of
first-load bandwidth for zero first-load benefit. The current setup is correct. Delete the claim.

> Counter-argument considered: preloading Fraunces *would* let it win the `optional` race and show
> the brand serif on first paint. But it competes directly with `index.json` (25 KB) — the file that
> paints the first 25 cards — on a connection where that file is already the critical path. Headings
> in Georgia for one page load is a much smaller cost than cards arriving later. Keep `optional`,
> do not preload.

**(d) README** — rewrite the Performance section so it describes what the code does. Untrue
performance documentation is worse than none: it stops the next person from finding the real win.

### Verify

```bash
grep -c content-visibility assets/style.css   # -> 1
node tools/perf/measure.mjs 4g                # LCP must not regress
```

---

## P10 — LOW: the `--hdr` sync gives up above 240 px and the toolbar misaligns

`assets/app.js`, `wireToolbarCollapse()`:

```js
      if (!v || v > 240 || v === hdrPx) return;   // 0 = hidden tab; >240 = bogus reflow
```

At 390 px the header measures 108 px. But with the browser's minimum font size raised, or a 200 %
page zoom, or a 280 px-wide device, the nav tabs wrap to three rows and the header legitimately
exceeds 240 px. `--hdr` then keeps its stale value and the sticky toolbar overlaps the header.

This is a real accessibility path (zoom to 200 % is WCAG 1.4.4), not a hypothetical.

### Fix

Raise the sanity ceiling and make it relative to the viewport rather than absolute:

```js
      // A bogus reflow reads as a header taller than half the viewport; a legitimately tall
      // header (wrapped tabs at 200% zoom / 280px wide) can still be 250-300px.
      if (!v || v > Math.max(240, window.innerHeight * 0.5) || v === hdrPx) return;
```

### Verify

```bash
node tools/perf/zoom.mjs
# at 280px wide and at 200% zoom the toolbar must not overlap the header
```

---

---

## P11 — LOW: `llms.txt` carries no upsckata.com credit, which `CLAUDE.md` requires

Found by writing `INV-2b`, not by reading the code.

`CLAUDE.md`'s conventions say credit to upsckata.com must be prominent in "header, About, footer,
JSON-LD, **llms.txt**". It is in the first four. It is **absent from `llms.txt`**:

```bash
grep -c upsckata llms.txt     # -> 0
```

`llms.txt` is the file written specifically for AI crawlers — the readers most likely to restate the
provenance of this dataset, and the ones least able to infer it. It is the one place the credit
matters most and the one place it is missing.

### Fix

`build.js`, in the `llms.txt` writer (search for `Raw source table`). Add a credit line to the
header block, matching the wording used in the README and the About tab:

```
Question-level database mirrored from upsckata.com "Topper Copies"
(https://toppercopies.upsckata.com/) — an independent, non-commercial mirror. Credit them.
```

### Verify

```bash
node build.js && npm run check     # INV-2b must flip to pass
```

---

# Phase 2 — Delivery layer

Dependencies: none (can be done in parallel with Phase 1). One short session.

---

## D1 — Stop deploying `data/questions.csv` (8.94 MB, nothing fetches it)

`.github/workflows/deploy.yml`'s `rsync` excludes six files from `data/` but not `questions.csv`.
It is 8.94 MB, it is published to the live site, and **nothing on the site requests it** — the
canonical public download is `dataset/questions.csv`, which the JSON-LD `DataDownload` points at.

It costs artifact upload time on every push (which is every nightly OCR commit) and it is a second,
subtly different copy of the dataset for anyone who finds it.

### ⚠️ This has a dependency — do not land it alone

`llms.txt` line 25 links to exactly this file:

```
- Raw source table (CSV): https://topperscopy.hashin.me/data/questions.csv
```

It is generated by `build.js` (~line 1471). Excluding the file without changing that line ships a
**404 to every AI crawler** — the audience `llms.txt` exists for. `INV-14b` in
`tools/check/invariants.mjs` catches this; it will go red the moment you add the exclude.

### Fix — both halves, one commit

**1. `build.js` ~line 1471** — point the line at the canonical public download instead:

```
- Raw source table (CSV): https://topperscopy.hashin.me/dataset/questions.csv
```

Check the surrounding lines: `dataset/questions.csv` is already listed further down under the
dataset block, so consider dropping the duplicate line entirely rather than repointing it.

**2. `.github/workflows/deploy.yml`**, in the `Stage the servable site` step:

```
            --exclude='data/questions.csv' \
```

### Verify

```bash
node build.js && npm run check     # INV-13 flips to pass, INV-14b must stay green
```
Push, then check the Actions log line `staged NNNMB` — it must drop by ~9 MB, and
`dataset/questions.csv` must still be in the artifact.

---

## D2 — Decide the hosting question on the real numbers

`CLAUDE.md` ("Open items") already evaluated moving to Cloudflare and **rejected it**. That analysis
is sound on its own terms but rests on one number that is wrong by 8×:

> "Payoff for topperscopy alone is ~137 KB on first load (427 KB → ~290 KB)"

That counted only the **boot** payload. The payload that decides whether search feels instant is the
search-gating one, and measured with a real Brotli-serving origin:

| | gzip (GitHub Pages) | Brotli | Saved |
|---|---:|---:|---:|
| `data/questions.json` | 1,639 KB | **724 KB** | −56 % |
| `data/copies.json` | 330 KB | **191 KB** | −42 % |
| `data/index.json` | 25 KB | 20 KB | −21 % |
| **Total first-party transfer, measured end-to-end** | **2,220 KB** | **1,142 KB** | **−1,078 KB (−49 %)** |

> Reproduce: `node tools/perf/sizes.mjs` (per file) and `node tools/perf/compare-encodings.mjs`
> (end-to-end, real browser)

The real payoff is **1,078 KB**, not 137 KB. GitHub Pages serves gzip only and has done since at
least 2019 ([community discussion #21655](https://github.com/orgs/community/discussions/21655)); there is
no setting to change.

### The option `CLAUDE.md` did not consider

`CLAUDE.md` frames the choice as "move `hashin.me`'s nameservers to Cloudflare", and correctly
identifies the iCloud-mail records (`MX mx01/mx02.mail.icloud.com`, the SPF TXT, the
`apple-domain=` TXT) as a silent-breakage risk. That risk is real **for that path**.

But Brotli does not require moving the zone. Static hosts that serve Brotli on a free tier —
**Netlify** and **Vercel** among them — attach a custom domain via a **single CNAME record added at
the current DNS provider**. `hashin.me`'s nameservers stay at Spaceship, every MX and TXT record
stays untouched, and the mail risk is zero. Only `topperscopy.hashin.me`'s CNAME changes, from
`hashin.github.io` to the new host.

### Recommendation

**Do Phase 3–5 first, and treat hosting as optional.** The format work is hosting-independent and
delivers −62 % on the search payload by itself; Brotli then multiplies it. Do not block the
format work on a hosting decision.

If you do want the hosting win, the order of preference is:

1. **Netlify or Vercel via CNAME** — Brotli, free, no nameserver migration, no mail risk. The
   deploy workflow changes from `actions/deploy-pages` to the host's CLI/action; `build.js` is
   untouched. **Verify the free-tier bandwidth cap (both are ~100 GB/month) against your actual
   traffic before committing** — at ~1.1 MB per full search session that is ~90,000 sessions/month.
2. **Stay on GitHub Pages.** Entirely defensible. It is already served from Fastly's Mumbai PoP
   (`x-served-by: cache-bom-*`, per `CLAUDE.md`), so latency for the Indian audience is good, and
   after Phase 5 the payload is small enough that Brotli is a nice-to-have.
3. **Cloudflare nameserver migration** — the largest win (Brotli + HTTP/3 + cache rules across all
   five sites) but the only path that touches the mail records. `CLAUDE.md`'s caution stands: do it
   as a deliberate domain migration with the iCloud records checked, never as a perf tweak.

> **Caveat I could not verify from this environment:** whether Cloudflare's **Free** plan still
> applies Brotli by default, or whether it now requires Compression Rules (Pro+). Sources conflict
> and `developers.cloudflare.com` was unreachable from here. If you take path 3, confirm first with:
> `curl -sI -H 'Accept-Encoding: br' https://topperscopy.hashin.me/data/copies.json | grep -i content-encoding`
> — it must say `br`, not `gzip`.

### Verify (whichever path)

```bash
curl -sI -H 'Accept-Encoding: br, gzip' https://topperscopy.hashin.me/data/questions.json \
  | grep -iE 'content-encoding|content-length'
```

---

## D3 — `sw.js`: a build-id mismatch downloads `questions.json` twice

`sw.js` line ~36:

```js
    if (url.search) return;   // explicit cache-buster from app.js fetchAtBuild — straight to the network
```

When `fetchAtBuild` detects a build mismatch it refetches `data/questions.json?b=<id>.<ts>`. The
service worker passes that straight through **and does not cache the result**, so the visitor pays
1.64 MB for the first fetch plus 1.64 MB for the retry = **3.3 MB**, and pays it again on the next
visit because nothing was stored.

The nightly `ocr-gemini` pass commits most nights, so mismatches are routine, not rare.

### Fix

Cache the cache-buster's response under the **clean** URL, so the retry populates the cache the next
load will read:

```js
  if (DATA_HEAVY.test(url.pathname)) {
    if (url.search) {
      // Explicit cache-buster from app.js fetchAtBuild: go to the network, but store the
      // result under the clean URL so the next load does not have to bust again.
      e.respondWith(fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(url.origin + url.pathname, copy); });
        }
        return res;
      }));
      return;
    }
    ...
```

Bump `VERSION` to `tc-v22`.

> Phase 4 (stable ids) removes the mismatch itself. This fix is still worth landing now — it is
> three lines and it helps every visitor between now and then.

### Verify

```bash
node tools/perf/sw-double.mjs
# must report exactly one questions.json network fetch across a simulated build skew
```

---

# Phase 3 — Payload diet (no new search engine yet)

Dependencies: Phase 1 landed. One session.

This phase removes waste without changing how search works. It is the safest big win.

---

## T1 — Drop the `sl` field from `data/questions.json` (−206 KB gzip, one line)

`build.js:557` ships `sl: q.slug` to every visitor. **`assets/app.js` never reads it.** Verified:

```bash
grep -n '\.sl\b' assets/app.js    # -> no match (the only hit is q.slice(...) at line 826)
```

The slug's only consumer is `build.js` itself, minting `/question/<slug>/` pages — where it is
already baked into the URL.

Measured: `questions.json` 1,639 KB gzip → **1,433 KB gzip**. 206 KB off the critical search path
for deleting three characters.

### Fix

`build.js:557`. Find:

```js
    questions: list.map(q => ({ i: q.i, p: q.p, q: q.q, m: q.m, w: q.w, s: q.s, yr: q.yr, a: q.a, sl: q.slug }))
```

Remove `, sl: q.slug`. Keep `q.slug` on the in-memory object — the static-page generator below it
still uses it.

### Verify

```bash
node build.js
node tools/perf/sizes.mjs      # questions.json gzip must drop ~206 KB
grep -c '"sl"' data/questions.json   # -> 0
```
Then load the site and confirm search, the question-first view and Practice all still work.

---

## T2 — Load `copies.json` and `questions.json` in parallel (S2)

Today the 1.64 MB file does not start until the 330 KB file has finished **and parsed**.

### Fix

`assets/app.js`, `loadQuestionIndex()`. Find:

```js
    qiPromise = ensureFullPromise().then(function () {
      return Promise.all([
        fetchAtBuild('data/questions.json', DB && DB.build),
        fetch('data/syllabus.json').then(function (r) { return r.json(); }).catch(function () { return null; })
      ]);
    }).then(function (res) {
```

Start both downloads immediately and only *join* on `copies.json` before using the refs:

```js
    // Start the big download NOW rather than after copies.json has landed and parsed — on slow
    // 3G that serialisation costs ~1.8s of dead air. Correctness still requires the two files to
    // agree on a build, so we join below and reconcile before touching any refs.
    var qJson = fetchAtBuild('data/questions.json', DB && DB.build);
    var sJson = fetch('data/syllabus.json').then(function (r) { return r.json(); }).catch(function () { return null; });
    qiPromise = Promise.all([ensureFullPromise(), qJson, sJson]).then(function (parts) {
      var res = [parts[1], parts[2]];
      // copies.json may have reconciled DB.build to a different build while this was in flight.
      if (res[0] && res[0].build && DB && DB.build && res[0].build !== DB.build) {
        return fetchAtBuild('data/questions.json', DB.build).then(function (d) { return [d, res[1]]; });
      }
      return res;
    }).then(function (res) {
```

The rest of the handler is unchanged.

> The refetch branch is the price of positional ids. It fires only on a genuine skew, and Phase 4
> removes it entirely. Measure before and after: the common path must lose a full round trip.

### Verify

```bash
node tools/perf/waterfall.mjs
# copies.json and questions.json request start times must be within ~50ms of each other
node tools/perf/measure.mjs 3g
# cold-search time must improve by roughly the copies.json download time
```

---

## T3 — Split question **text** out of the search payload

After T1, `questions.json` is 1,433 KB gzip, of which **780 KB is `q` — the question text**. Text is
needed only to *render* the ~25 matches on screen and to verify exact-phrase queries. It is not
needed to *find* them.

Split into two files:

| New file | Contents | gzip | brotli |
|---|---|---:|---:|
| `data/qmeta.json` | `i, p, m, w, s, yr, a` for all 8,102 questions | **104 KB** | 69 KB |
| `data/qtext.json` | `[text, text, …]` indexed by question id | **780 KB** | 471 KB |

`qmeta.json` alone unlocks the syllabus filter, the paper filter, the question-first view's
counts, and Practice question selection. `qtext.json` streams in behind it.

### Fix

**1. `build.js`, `writeQuestions()`** — emit both files. Keep writing `questions.json` for one
release as a compatibility shim (a cached `app.js` from the previous deploy will still ask for it),
then delete it in the following release.

**2. `assets/app.js`** — `loadQuestionIndex()` fetches `qmeta.json`, sets `QI`, calls `fillSyllabus()`
and re-renders. A second, independent promise `loadQuestionText()` fetches `qtext.json`, populates
`QTEXT`/`QTEXTLC`, and re-renders. `matchingQids()` must return "not ready" until the text is in.

**3. `sw.js`** — add `qmeta.json` to the `DATA_HEAVY` regex; bump `VERSION`.

**4. `.gitignore`** — add `/data/qmeta.json` and `/data/qtext.json` (and `/data/qindex.bin` when
Phase 5 lands). They are generated; never commit them.

### Interim behaviour to get right

Between `qmeta` and `qtext` landing, a text query cannot be answered. **P1's rule still applies: do
not print a zero.** Show `Searching inside N copies…`. Topper-name search works throughout, because
that only needs `index.json`.

### Verify

```bash
node build.js
node tools/perf/sizes.mjs
node tools/perf/measure.mjs 3g
# time-to-syllabus-filter-usable must drop sharply; cold text search should be roughly unchanged
# (this phase sets up Phase 5 — it does not yet speed up text search by itself)
```

---

## T4 — OPTIONAL: intern the repeated strings in `copies.json`

`copies.json` is 2,494 KB raw / 330 KB gzip. The raw size is dominated by `u` (832 KB of URLs) and
`note` (229 KB), across only **17 distinct URL origins** and 1,521 distinct topper names.

Interning origins + names + sources and switching each copy to a positional tuple:

```
copies.json today   raw 2,494 KB  gzip 330 KB  brotli 191 KB
interned + tuples   raw 1,422 KB  gzip 291 KB  brotli 178 KB
```

**Be honest about this one: gzip only gains 39 KB** — gzip already exploits the repetition. The real
win is **raw size −43 %**, which is JSON parse time and peak memory on a low-end phone (measured
heap after full load today: 38.7 MB).

> Reproduce: `node tools/perf/copies-proto.mjs`

Do this **only if** Phase 6 profiling shows parse time or memory is actually hurting. It costs
readability in both `build.js` and `app.js` for a modest, non-obvious gain. It is listed here so the
number is on record, not because it is recommended.

---

# Phase 4 — Stable copy ids

Dependencies: Phase 3 landed. One session. **Do this before Phase 5** — Phase 5's index keys off
question ids and wants them stable too.

This removes the root cause of S3, and with it: the serialisation refetch branch (T2), the
double-download (D3), and the entire build-stamp reconciliation machinery from AUDIT B1.

---

## I1 — Derive copy ids from content, not from row order

### What is wrong

`build.js:233` and `:261`: `copies.push({ i: i++, ... })`. Ids are positions in an iteration over
`questions.csv` → `submissions.csv` → `ocr-questions.csv` → link-copies. One inserted row shifts
every id after it — AUDIT B1 measured 87 % churn from a single appended row.

### Fix

Key each copy by a stable hash of its identity. The copy's identity is its URL (`u`) — that is
already the merge key everywhere else in `build.js`.

```js
// Copy ids must be stable across builds: they are the join key between index.json,
// copies.json and qmeta.json, and those three are cached independently. A positional id
// meant a single inserted row re-pointed 87% of them (AUDIT B1). Hash the URL instead.
const copyId = u => parseInt(crypto.createHash('sha1').update(u).digest('hex').slice(0, 8), 16);
```

Collisions: 8,075 ids in a 2^32 space gives a ~0.75 % chance of at least one collision by the
birthday bound — low, but not zero, and it will grow with the corpus. **Handle it explicitly**:
after assigning, assert uniqueness and on collision append `'#2'` to the URL before rehashing, in a
deterministic loop. Fail the build loudly if it cannot resolve — never ship a silent collision.

Then:

- Replace `i: i++` at both call sites with `i: copyId(base)`.
- Question ids in `writeQuestions()` (`build.js:544`, `q.i = i`) are also positional. Make them a
  hash of the deduped question text + paper, with the same collision guard.
- Delete the `buildId` stamp and every consumer of it: `fetchAtBuild`'s retry, `loadFull()`'s
  "drop the lite rows and rebuild wholly" branch, T2's reconcile branch, and `sw.js`'s
  `if (url.search)` special case.
- `sw.js`: raise `HEAVY_TTL_MS` — with stable ids, a stale `copies.json` is merely *missing recent
  copies*, not *wrong*. 7 days is reasonable.

### Why this is worth a whole phase

It converts three separate correctness workarounds into "no problem to work around", and it is the
precondition for long-lived caching: with stable ids, a returning visitor can serve all three data
files straight from cache with no revalidation and no risk of splicing one copy's questions onto
another.

### Verify

This is the highest-risk change in the document. Verify it hard:

```bash
node build.js && cp data/copies.json /tmp/before.json
printf 'ZZZ Test,,GS1,1,"A test question.","Type: question, Word limit: 150, Marks: 10",https://example.com/z.pdf#page=1\n' >> data/submissions.csv
node build.js
node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync("/tmp/before.json")).copies,b=JSON.parse(fs.readFileSync("data/copies.json")).copies;const mb=new Map(b.map(c=>[c.i,c.u]));let d=0;for(const c of a)if(mb.get(c.i)!==c.u)d++;console.log("id churn:",d,"of",a.length)'
# MUST print: id churn: 0 of 8075
git checkout data/submissions.csv && node build.js
```

Also assert in `build.js` that `new Set(copies.map(c => c.i)).size === copies.length`, and the same
for question ids.

---

# Phase 5 — The search engine

Dependencies: Phases 3 and 4 landed. **This is the big one — budget a full session for it alone.**

---

## E1 — Replace the linear scan with an inverted index

### What is wrong

`matchingQids()` runs `indexOf()` across 8,102 lowercased question strings on every keystroke, which
means the client must first download and hold all 8,102 strings (780 KB gzip after T3) plus a
**second full lowercased copy in memory** (`QTEXTLC`). Search cannot answer anything until that
lands.

### The replacement

Build the index at build time and ship postings instead of prose.

**Measured on this exact corpus** (`node tools/perf/index-proto.mjs`):

```
distinct tokens: 14,522  |  (question, token) pairs: 271,342
tokens appearing in exactly one question: 4,703 (32%)

token dictionary (front-coded)   raw   70 KB   gzip   31 KB
postings (delta + varint)        raw  328 KB   gzip  256 KB
postings length table            raw   14 KB   gzip    5 KB
-------------------------------------------------------------
INVERTED INDEX TOTAL             raw  415 KB   gzip  292 KB   brotli 270 KB
```

### End-to-end effect

| | today | after Phase 5 (gzip) | after Phase 5 + Brotli |
|---|---:|---:|---:|
| `index.json` | 25 KB | 25 KB | 20 KB |
| `copies.json` | 330 KB | 330 KB | 191 KB |
| search index | `questions.json` **1,639 KB** | `qmeta` 104 + postings 292 = **396 KB** | **339 KB** |
| **search-ready total** | **1,994 KB** | **751 KB (−62 %)** | **550 KB (−72 %)** |
| question text | (included above) | `qtext.json` 780 KB, **after** results appear | 471 KB |

**The student sees results before the text arrives**, because the index alone gives the copy list,
the counts and the ranking. Text fills the snippets in behind it.

### Format (`data/qindex.bin`)

Ship binary, not JSON — JSON-encoding integer postings costs ~3× and gzip does not recover it.

```
magic    "TCIX" + uint8 version
uint32   tokenCount
uint32   dictBytes, uint32 lenTableBytes, uint32 postingsBytes
[dict]        front-coded, newline-separated, sorted ascending:
              one byte (0x30 + sharedPrefixLen, capped at 15) then the token's suffix
[lenTable]    varint per token: byte length of that token's postings run
[postings]    per token: delta-encoded, varint question ids, ascending
```

Read it with `fetch(...).then(r => r.arrayBuffer())` and a `DataView`. No dependency.

### Query algorithm (`assets/app.js`)

1. Tokenise the query the same way `build.js` does: `.toLowerCase().match(/[a-z0-9]+/g)`.
2. For each term, **binary-search the sorted dictionary for the prefix range** — `fed` matches
   `fed`, `federal`, `federalism`, `federation`. Union their postings.
3. Intersect across terms (AND). Intersect the shortest postings list first.
4. `mode === 'exact'` (phrase): take the AND result as a **candidate set**, then verify the phrase
   against `QTEXT` for those candidates only. If `qtext.json` has not landed, show the AND result
   and a note that the phrase filter is still loading — do not show zero.

### The behaviour change you must accept, and tell users about

Today's search is **substring**: `eral` matches `federalism`. An inverted index is **token-prefix**:
`fed` matches `federalism`, but `eral` no longer matches anything.

This is on balance an improvement — token-prefix is what every search box a student has ever used
does, and mid-word substring matching mostly produces noise (`ent` currently matches a few thousand
questions). But it **is** a change:

- Keep the placeholder honest: "Search a topper's name, or inside the copies — federalism, ethical
  dilemma…" already implies word search. Good as is.
- If a query returns nothing and `qtext.json` **has** landed, fall back to the old substring scan
  over `QTEXTLC` once, and label the results "no word match — showing text matches". That keeps the
  old capability without paying for it on the common path.

### Ranking — the thing an index makes possible and a scan does not

Today results are sorted by name/year/AIR and never by **relevance**. With postings you get document
frequency for free, so implement a simple, explainable BM25-lite:

- Rarer query terms weigh more (`idf = log(N / df)`).
- A question matching all terms outranks one matching some.
- Prefer exact token matches over prefix-extended ones.
- Break ties with the existing year/AIR sort.

Add "Best match" as the default `#sort` option and keep the existing options. For a student asking
"which topper answered a question about cooperative federalism", relevance ranking is worth more
than any millisecond in this document.

### Verify

```bash
node build.js
node tools/perf/sizes.mjs            # data/qindex.bin must be ~415 KB raw / ~292 KB gzip
node tools/perf/search-parity.mjs    # runs 200 real queries through old and new, reports differences
node tools/perf/measure.mjs 3g       # cold search must drop from ~4,455ms to under ~1,500ms
```

`tools/perf/search-parity.mjs` is the important one. It must be written **before** the engine
changes: capture old-engine results for a fixed query list, then assert the new engine returns a
superset for prefix queries and an identical set for whole-word queries. Any query where the new
engine returns fewer results must be listed and explained.

---

# Phase 6 — Rendering

Dependencies: Phase 5 landed. One session.

---

## R1 — Stop rebuilding the whole list on every keystroke

`renderBrowse()` does `box.innerHTML = ''` and rebuilds. P4 fixed the "Show more" path; this is the
keystroke path. Measured on mobile at CPU 4×: **~250 ms input → repaint, with an 86–91 ms long
task**, and **235 ms** on the first-ever search. Chrome's INP "good" threshold is 200 ms.

### Fix

Key the cards by copy id and reconcile instead of replacing:

- Keep a `Map<id, element>` of rendered cards.
- On re-render, walk the new top-25, reusing existing elements (`box.appendChild` on an existing
  node moves it — no rebuild), and only construct cards for ids not already present.
- Remove elements whose ids fell out.
- Only the highlight spans need updating when the query changed but the card is reused.

### Then re-measure before doing anything more

If R1 plus P6 (collator) plus `content-visibility` (P9a) brings the long task under 50 ms, **stop
here**. Do not add virtualisation — it costs real complexity in a vanilla codebase and breaks
in-page find, anchor links and the `<details>` semantics the cards rely on. Only if the long task
is still over ~80 ms at 25 cards should you consider windowing, and then only for the question-first
view, which renders the longest lists.

### Verify

```bash
node tools/perf/inp.mjs
# longest long task per keystroke must be < 50ms at 25 cards
```

---

## R2 — Trim the mobile first screen

Measured at 390×844: the first viewport is entirely hero, stats and a disclaimer paragraph. **The
search box is at the very bottom edge and not one result card is visible.** On a 1440×900 desktop,
likewise, zero results are above the fold.

Two concrete redundancies:

- The counts are printed **twice**: `#sub` says "26,721 searchable questions · 9,082 answer copies ·
  1,694 toppers · 1,007 optional-subject copies" and immediately below `#statline` repeats
  "26,721 questions / 9,082 copies / 1,694 toppers / 18 subjects". Same numbers, ~74 px of phone
  screen, no new information.
- The seven-line credit/disclaimer paragraph (`p.credit`) sits **above** the search box. It is
  important for rights holders, but it is not what a student came for and it is duplicated in About.

### Fix

On `max-width: 680px` only:

1. Drop `#sub` and keep `#statline` (the chips are more scannable), or vice versa — keep exactly one.
2. Move `p.credit` **below** `#results`, or collapse it to one line with a "Sources & credit" link
   to the About tab. Keep the full text on desktop and in About; nothing is being hidden, only
   reordered.
3. Reduce the `h1` to two lines at 390 px (it currently takes three).

Target: **the search box and at least one result card visible without scrolling at 390×844.**

### Verify

```bash
node tools/perf/fold.mjs
# must report: search box visible = true, result cards above the fold >= 1
```

---

## R3 — Put the search in the URL

Measured: typing a query does not change the URL. So a student cannot bookmark a search, cannot
share "look at this question", and **the back button does not undo a search** — on Android, back
leaves the site entirely.

`boot()` already *reads* `?q=`, and the JSON-LD advertises a `SearchAction` pointing at
`?q={search_term_string}` — so the read path exists and is promised to Google. Only the write path
is missing.

### Fix

In the debounced `#q` input handler, after `renderBrowse()`:

```js
      // Keep the query in the URL: makes searches shareable and bookmarkable, makes the
      // Android back button undo a search instead of leaving the site, and honours the
      // SearchAction the JSON-LD already advertises. replaceState while typing, so a
      // 12-character query does not push 12 history entries.
      try {
        var u = new URL(location.href);
        if (state.q) u.searchParams.set('q', state.q); else u.searchParams.delete('q');
        history.replaceState(null, '', u);
      } catch (e) {}
```

Use `pushState` **once** when a query goes from empty to non-empty (so back returns to the unfiltered
list), and `replaceState` for every subsequent keystroke. Add a `popstate` listener that re-reads
`?q=` into `state.q` and re-renders.

Include `paper` and `syl` in the URL too — the `/paper/<x>/` hub pages already deep-link with
`?paper=`, so the read path is there as well.

### Verify

```bash
node tools/perf/history.mjs
# type a query -> URL gains ?q=; press Back -> query clears, site not left
```

---

# Phase 7 — Where the project can go

Not implementation instructions. Judgements about the product, for you to accept or reject.

---

### The asset nobody else has

There are many places to download a topper's PDF. As far as I can tell there is nowhere else with
**26,621 questions mapped to the exact page of the exact copy that answered them, across 1,694
toppers**. The PDFs are commodity; the question-level mapping is the moat. Every product decision
should ask whether it deepens that mapping or dilutes it.

That reframes the site: it is not a PDF directory with a search box bolted on. It is **a question
bank whose answers happen to be handwritten by people who cleared the exam** — and the current UI
leads with the directory, not the question bank.

### 1. Make the question the primary object, not the copy

The question-first view already exists (`#qview`) but is the secondary toggle. Consider inverting
the default: a student's real query is "how did toppers answer *this*", not "show me Zinnia Aurora's
GS2 copy". The per-question pages (`/question/<slug>/`, 8,102 of them, 3,761 indexable) are already
built and are almost certainly the strongest SEO surface the site has — a student googling an actual
PYQ should land there. Check Search Console for which of the three page types (`/question/`,
`/topper/`, `/`) actually earns impressions, and lead with the winner.

### 2. Coverage is the product metric — publish it

`build.js` already prints the number that matters:

```
syllabus-mapped: Essay 130/370  GS1 598/2103  GS2 852/1623  GS3 618/1266  GS4 1187/2437  Other 0/303
```

**Only 3,585 of 8,102 questions (44 %) are mapped to a syllabus node**, and `Other` is 0/303. A
public "coverage" page — by paper, by syllabus node, by year — would (a) tell students honestly what
they will and will not find, (b) turn the gaps into a specific ask ("we have no GS3 copies for
disaster management — send one"), and (c) give you a single number to move.

### 3. Practice is the retention feature and it is one step from being a product

The Practice dialog draws a random question and shows who answered it. The obvious next step is
**spaced repetition over the syllabus**: the streak counter already exists (`pBumpStreak`), the
syllabus tree exists (`syllabus.json`), and the per-question topper list exists. A student who comes
back daily for a question is worth ten who bounce off a search. Keep it local-storage only — the
moment it needs accounts it stops being free and static.

### 4. The extraction pipeline is the bottleneck, and Gemini is being under-used

`ocr-yield.json` and the redo queue show you already track low-yield booklets. Two upgrades worth
considering:

- **Ask Gemini for structure, not just text.** The current pass OCRs the top ~42 % strip and runs a
  regex heuristic (`extract.js`). Asking for structured JSON directly — question text, marks, word
  limit, *and the syllabus node* — would fix the 44 % syllabus-mapping gap in the same pass that
  costs you the OCR anyway.
- **Extract the answer, not only the question.** The handwriting is the thing students actually want
  to study. Even coarse structure — "this answer uses a flowchart", "this one has a map", "3
  subheadings, 2 diagrams" — would make copies filterable in a way no competitor can match, and it
  needs no re-hosting: it is metadata about a PDF you link to.

### 5. Quality signals over raw count

"9,082 copies" is impressive but undifferentiated. Students care about *whose* copy. `toppers.json`
already carries AIR, year and marks, with `verified` and 1,377/1,520 auto-parsed AIRs. Surfacing
**marks for that specific paper** on the card — "GS2, 121 marks" — is a far stronger signal than
"AIR 6", and you already have the field. Filling and verifying it is a data job, not a code job.

### 6. Things I would not do

- **Do not add accounts, sync or a backend.** Free and static is the reason this exists and the
  reason it costs nothing to run. Every feature above works in local storage.
- **Do not mirror the PDFs.** The current position — link only, credit the publisher, remove on
  request — is both the legally sound one and the reason publishers have not objected.
- **Do not add a framework.** The measured problems in this document are payload and data-structure
  problems. React would not have prevented one of them and would add ~40 KB gz to the critical path.

---

# Progress

Tick as you land each item. One commit per item.

| Phase | Item | Done |
|---|---|:--:|
| 1 | P1 — never print "0 copies" while loading | ☑ |
| 1 | P2 — adopt a query typed before boot | ☑ |
| 1 | P3 — reserve `#statline` / `#papers` height (CLS) | ☑ |
| 1 | P4 — "Show more" appends instead of rebuilding | ☑ |
| 1 | P5 — analytics stops re-running the search | ☑ |
| 1 | P6 — NO ACTION (verified: leave the sort alone) | ☑ |
| 1 | P7 — `#resultmeta` live region | ☑ |
| 1 | P8 — lazy-load `extract.js` | ☑ |
| 1 | P9 — `content-visibility`; fix the README claims | ☑ |
| 1 | P10 — `--hdr` ceiling is viewport-relative | ☑ |
| 1 | P11 — upsckata credit in `llms.txt` | ☑ |
| 2 | D1 — stop deploying `data/questions.csv` | ☐ |
| 2 | D2 — hosting decision (see recommendation) | ☐ |
| 2 | D3 — `sw.js` caches the cache-buster response | ☐ |
| 3 | T1 — drop `sl` from `questions.json` | ☐ |
| 3 | T2 — parallel `copies.json` + `questions.json` | ☐ |
| 3 | T3 — split `qmeta.json` / `qtext.json` | ☐ |
| 3 | T4 — OPTIONAL: intern `copies.json` strings | ☐ |
| 4 | I1 — content-derived stable ids | ☐ |
| 5 | E1 — inverted index + prefix search + relevance ranking | ☐ |
| 6 | R1 — keyed card reconciliation | ☐ |
| 6 | R2 — trim the mobile first screen | ☐ |
| 6 | R3 — search state in the URL | ☐ |

## Target, measured

| | today | after Phase 5 | after Phase 5 + Brotli |
|---|---:|---:|---:|
| Search-ready bytes | 1,994 KB | **751 KB** | **550 KB** |
| Cold search, 4G | 2,670 ms | ~1,000 ms | ~800 ms |
| Cold search, slow 3G | 4,455 ms | ~1,500 ms | ~1,200 ms |
| CLS (3G mobile) | 0.193 | **0.00** | 0.00 |
| Longest keystroke task | 235 ms | < 50 ms | < 50 ms |

The Phase 5 timing figures are projections from the measured payload reduction; everything else in
this document is measured. Re-run `tools/perf/measure.mjs` after each phase and replace the
projections with real numbers.
