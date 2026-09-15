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
| `INV-4` | Every `[urlIndex, page]` ref in every question shard resolves to a copy in `copies.json` | DECISION-17 |

## Credit and honesty

| ID | Rule | Cites |
|---|---|---|
| `INV-5` | upsckata.com is credited in `index.html`, `README.md` and `llms.txt` | INTENT-4 |
| `INV-6` | `README.md` does not claim an optimisation, data file or engine the code does not have | INTENT-6 |
| `INV-7` | Nothing `llms.txt` or `index.html` links to is excluded by `deploy.yml` | INTENT-6 |

## Architecture

| ID | Rule | Cites |
|---|---|---|
| `INV-8` | No framework, module or bundler syntax reaches `assets/app.js` | DECISION-2 |
| `INV-9` | No blocking third-party `<script>` in `<head>` (GA may be `async`) | DECISION-3 |
| `INV-10` | Every path `build.js` writes is gitignored and untracked | DECISION-4 |
| `INV-11` | `tools/` and the source-only data files are excluded from the deployed site | DECISION-8 |
| `INV-12` | `#resultmeta` is an `aria-live` region — screen readers hear result counts | INTENT-3 |

## Gzip budgets — INTENT-2, speed is the product

The table at the top of `tools/check.mjs` is the source of truth. Each ceiling is the value measured
on 2026-09-15 plus ~10 % headroom, so nothing regresses quietly. When the corpus grows past one
(the OCR pass adds questions), raise the ceiling deliberately in the same commit and say why.

| Budget | Covers | Ceiling |
|---|---|---:|
| `boot` | `index.html` + CSS + `app.js` + both fonts + `data/copies.json` — everything before the first 25 cards paint, with every topper name searchable | 450 KB |
| `app.js` | `assets/app.js` alone (DECISION-2) | 23 KB |
| `shard gs1 … optional` | each `data/questions-<paper>.json` — the one download a text query in that paper waits on | 200 · 180 · 120 · 690 · 25 · 30 · 20 KB |

## Not checkable, still true

- Search never prints "0 copies" while a needed shard is still downloading (DECISION-6). One boolean
  in `renderBrowse()`; verify by serving with the shards delayed (see `docs/SESSIONS.md` 2026-09-15).
- Search semantics: "All words" = every term is a substring of the question text or topper name;
  "Exact phrase" = the joined query is a substring. Case-insensitive. Verified against
  `dataset/questions.csv` for 210 real queries when DECISION-17 landed.
