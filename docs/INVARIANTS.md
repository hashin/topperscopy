# Invariants — the rules, and the check that proves each one

This is the bridge between `INTENT.md` ("what Hashin wants") and `tools/check.mjs` ("what actually
gets enforced"). Every row below is a check in that file; every check cites the intent or decision
it protects. Nothing here is aspirational: if it is listed, `npm run check` fails when it breaks.

```bash
node build.js        # the checks measure real output, so build first
npm run check        # ~2 seconds, plain Node, no browser
```

## Data integrity

| ID | Rule | Cites |
|---|---|---|
| `INV-1` | No answer copy URL points at our own domain — nothing is re-hosted | INTENT-4 |
| `INV-2` | Every copy link is `http(s):` — no `javascript:`/`data:` from a submission | INTENT-5 |
| `INV-3` | A PDF URL appears in exactly one copy (the URL is the copy's key) | DECISION-17 |
| `INV-4` | Every `[idIndex, page]` ref in every question shard resolves (via `cid(url)` from `assets/app.js`) to a copy in `copies.json` | DECISION-17, DECISION-25 |
| `INV-14` | `cid(url)` — the browser's copy id — is collision-free over every copy | DECISION-25 |
| `INV-19` | Every VisionIAS URL move (`data/visionias-urls.json`) is old `cdn.visionias.in` → a distinct `visionias.in/_public/assets/<sha256>.pdf`, and no moved old URL survives in `copies.json` | DECISION-31 |
| `INV-20` | The R2 manifest (`data/pdf-mirror.json`) is well-formed: every `ok` file has a sha256-named key and no two origin URLs share one | DECISION-32 |
| `INV-21` | Once copies are served from R2, no public page (`index.html`, `README.md`, `build.js`) still says nothing is re-hosted | DECISION-32, INTENT-13 |
| `INV-22` | The manifest never records more than 100 GB in R2 (the tool enforces the same cap against the bucket) | DECISION-32 |
| `INV-23` | A copy is served from R2 only when its original link is recorded `down` (two failed nightly checks in a row); otherwise it links to its publisher | DECISION-32 |

## Credit and honesty

| ID | Rule | Cites |
|---|---|---|
| `INV-5` | upsckata.com is credited in `README.md` (repo-level provenance record only — not surfaced on the live site) | DECISION-20 |
| `INV-6` | `README.md` does not claim an optimisation, data file or engine the code does not have | INTENT-6 |
| `INV-7` | Every `data/` or `dataset/` path `llms.txt` or `index.html` links to is written by the build and not excluded by `deploy.yml` (a dead `questions-gs1.json` link shipped for two weeks before this covered "written") | INTENT-6, DECISION-26 |

## Architecture

| ID | Rule | Cites |
|---|---|---|
| `INV-8` | No framework, module or bundler syntax reaches `assets/app.js` | DECISION-2 |
| `INV-9` | No external `<script>` in `<head>`; `gtag.js` is injected after `load` + idle | DECISION-3, DECISION-27 |
| `INV-10` | Every path `build.js` writes is gitignored and untracked | DECISION-4 |
| `INV-11` | `tools/` and the source-only data files are excluded from the deployed site | DECISION-8 |
| `INV-12` | `#resultmeta` is an `aria-live` region — screen readers hear result counts | INTENT-3 |
| `INV-13` | Every interview in `interview-list.json` has its own `data/iv/<id>.json` transcript | DECISION-19, DECISION-25 |
| `INV-15` | `copies.json`'s `shardV` / `shardDV` list every shard part and `-deep` file and each hash matches the file's bytes (the `?v=` the service worker caches by) | DECISION-27, DECISION-28 |
| `INV-16` | A shard part carries no build date — its bytes change only when one of its questions does | DECISION-27 |
| `INV-17` | Every cut long question has exactly one rest in its `-deep` file, keyed by app.js's own `fnv(paper\|full text)` — its practice id | DECISION-28 |
| `INV-24` | The search index holds exactly the words of every question (rebuilt from the shard text and compared bucket by bucket), every file carries one build stamp, and each question number's copies match its row in its part | DECISION-33 |
| `INV-18` | Merging questions never loses an answer: refs across all shards = question rows counted per copy in `copies.json` | DECISION-28 |

## Gzip budgets — INTENT-2, speed is the product

The table at the top of `tools/check.mjs` is the source of truth. Each ceiling is the value measured
on 2026-09-15 plus ~10 % headroom, so nothing regresses quietly. When the corpus grows past one
(the OCR pass adds questions), raise the ceiling deliberately in the same commit and say why. Last re-baselined 2026-10-23
(gs3, essay, other) after the OCR pass — see `PERF-AUDIT-2026-10-23.md`. The whole-corpus totals were removed 2026-11-05: no visitor pays them per search any more (DECISION-33).

| Budget | Covers | Ceiling |
|---|---|---:|
| `boot` | `index.html` + CSS + `app.js` + both fonts + `data/copies.json` — everything before the first 25 cards paint, with every topper name searchable | 450 KB |
| `app.js` | `assets/app.js` alone (DECISION-2) | 29 KB |
| `search index` | `data/ix-refs.json` — fetched once when someone starts to search (DECISION-33) | 150 KB |
| `index bucket` | the largest `data/ix/<two letters>.json` — one per query term (DECISION-33) | 60 KB |
| `deep part` | the largest single `questions-*-deep.json` | 160 KB |
| `shard gs1 … optional` | each `data/questions-<paper>.json` (or, once a paper outgrows one file, each `data/questions-<paper>-<n>.json` part — DECISION-23) — the largest single download a text query in that paper waits on | 200 · 180 · 150 · 690 · 150 · 150 · 150 KB |

## Not checkable, still true

- When the service worker takes control, the shard files the page already loaded end up in its cache without being
  downloaded again (DECISION-29). Verified in Chrome with a counting server and the HTTP cache cleared between visits.

- Search never prints "0 copies" while a needed shard is still downloading (DECISION-6). One boolean
  in `renderBrowse()`; verify by serving with the shards delayed (see `docs/SESSIONS.md` 2026-09-15).
- Search semantics (DECISION-33): "All words" = every term starts a word in one question, or in the topper's name; a lone letter or digit
  is a whole word. "Exact phrase" = the terms side by side in order. Case-insensitive, punctuation ignored. Compared with the previous
  build for 22 queries in real Chrome when the index landed; the differences are listed in DECISION-33.
