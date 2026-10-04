# tools/perf — measuring what a visitor actually waits for

Repo-only (excluded from the deploy, DECISION-8). None of these are part of `npm run check`; they answer the questions a
budget cannot: *how long does it take*, and *does the service worker do what we think*. Full results and method:
`docs/PERF-AUDIT-2026-10-04.md`.

| Script | Answers | Needs |
|---|---|---|
| `sizes.mjs` | Bytes per stage (boot / idle prefetch / on first search / later), raw · gzip · brotli. `--json` for one line. | `node build.js` first. Nothing else. |
| `browser.cjs` | Timings in real Chrome under phone throttling: first cards, search complete, bytes, long tasks, TBT, input delay — cold, deep-link, type-at-load and repeat visits. | `npm i --no-save playwright-core`, Google Chrome installed. |
| `shaped-server.cjs` | A local static server that behaves like GitHub Pages (gzip, ETag/304, `max-age=600`) **and** throttles the link itself, so service-worker fetches are slowed like page fetches. `GET /__stats` = files/bytes sent since the last call; `GET /__swbump` = serve `sw.js` with a new `VERSION`. | Node only. |
| `repeat.cjs` | DECISION-28 amendment: repeat visits with the worker live — return-then-search, return via a `?q=` link, third visit, Save-Data — time to a complete result and question files sent. | `shaped-server.cjs` running; playwright-core. |
| `claim.cjs` | DECISION-29: does the worker end up holding every shard file, with nothing sent twice — first visit via `/` and via `?q=`, return visits with the HTTP cache cleared, and a worker upgrade. | `shaped-server.cjs` running; playwright-core. |

```bash
node build.js && node tools/perf/sizes.mjs
npm i --no-save playwright-core
node tools/perf/browser.cjs https://topperscopy.hashin.me/ 2
ROOT=$PWD PORT=8772 BPS=200000 RTT=150 node tools/perf/shaped-server.cjs &
node tools/perf/claim.cjs http://localhost:8772/ slow4g
```

## Measurement traps (each one cost a wrong number before it was found)

- **CDP network throttling does not apply to service-worker fetches.** Once the worker controls the page, slow-4G looked ~3×
  faster than reality. `browser.cjs` blocks the worker on cold runs; anything that needs the worker live must throttle at the
  server (`shaped-server.cjs`).
- **Playwright's `page.route()` disables Chrome's HTTP cache.** Any test of caching behaviour must not route requests (block
  third parties some other way, or not at all).
- **CDP throttling leaves `navigator.connection.effectiveType` at `4g`.** The Save-Data / 2G / 3G gate cannot be reached by
  throttling; fake it with an init script (`Object.defineProperty(navigator, 'connection', …)`, as `repeat.cjs` does).
- **A warm HTTP cache hides service-worker gaps.** Clear it between visits (`Network.clearBrowserCache` — leaves Cache Storage
  alone) to model a return after 10 minutes or after a deploy (GitHub Pages' ETag changes on every deploy).
- **Headless paint timings (FCP/LCP) are noisy**; the "first cards" DOM poll is the reliable boot number.
- **Log request order, not just counts.** The reversed download queue (DECISION-28) produced correct counts and was only visible
  in the order files were requested.
- The Claude-in-Chrome extension was never connected during this work; all browser numbers come from the installed Chrome driven
  over CDP. The built-in browser pane cannot throttle or register a service worker on localhost.
