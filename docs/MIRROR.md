# The PDF mirror (R2) and the VisionIAS move — runbook and lessons

Read this before touching `tools/mirror-pdfs.mjs`, `tools/visionias-urls.mjs`, `data/pdf-mirror.json`, `data/visionias-urls.json`
or the `mirror-*.yml` workflows. It records what was built (2026-11-09/10), how to operate it, and what went wrong on the way.
The reasoning behind the design is in DECISION-31 and DECISION-32; what Hashin asked for is INTENT-12 and INTENT-13.

## 1. What exists

The site links every copy to **its publisher**. A copy of each PDF we could fetch is also kept in a Cloudflare R2 bucket
(`topperscopy-pdfs`), and the site links to *that* copy **only while the publisher's link is down** (two failed nightly checks in a row).

| Piece | Role |
|---|---|
| `data/visionias-urls.json` | old `cdn.visionias.in` URL → VisionIAS's new `visionias.in/_public/assets/<sha256>.pdf`. Applied by `build.js` at load. Written by `node tools/visionias-urls.mjs [--add-fresh]`. |
| `data/pdf-mirror.json` | the record: one line per copy URL — `status`, `key`, `sha256`, `bytes`, `topper`, `paper`, `source`, `was` (old VisionIAS URL, which OCR rows still carry), and for mirrored files `origin` (`up`/`down`), `miss`, `checked`. `_meta.base` = the public bucket URL. Never delete lines from it. |
| `tools/mirror-pdfs.mjs` | `plan` `status` `run` `check` `verify [--repair]` `usage` `selftest`. Own SigV4, zero dependencies. |
| `.github/workflows/mirror-pdfs.yml` | nightly 02:30 UTC (and manual): plan → **check originals** → verify/repair → mirror → commit manifest → trigger deploy. |
| `.github/workflows/mirror-usage.yml` | 1st of each month, read-only: bucket size, estimated cost, lost files; fails (GitHub emails) over the cap or on a lost file. |
| `build.js` | `data/visionias-urls.json` swap, then R2 swap **only** for `status:ok` + `origin:down` entries. `MIRROR=off node build.js` disables the R2 swap (the tool needs origin URLs in `copies.json`). |
| Checks | INV-19 (VisionIAS map well-formed) · INV-20 (manifest well-formed) · INV-21 (wording must not say "nothing is re-hosted" once serving) · INV-22 (≤ 100 GB recorded) · INV-23 (R2 only where origin is down). |

Manifest `status`: `pending` (to do) · `ok` (in R2) · `failed` (retried up to 3×) · `gone` (403/404/410/not a PDF at the source) ·
`skip` (Google Drive, Telegram, too big — no stable direct file) · `dead` (a VisionIAS link VisionIAS no longer lists — nothing to fetch).
On 2026-11-09 the 9,130 copies were: 5,601 mirrorable, 2,537 dead, 992 skip.

## 2. Operating it

**One-time setup (done 2026-11-09):** R2 bucket `topperscopy-pdfs` (Standard class); repo secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; repo variable `MIRROR_ENABLED=true`; bucket public via the `r2.dev` "Public Development URL"
(`_meta.base` = `https://pub-92c233dffeb04a2ebd71da6d405a33de.r2.dev`). The two key secrets are set by Hashin with `gh secret set NAME`
(it prompts; nothing in shell history). An assistant must never type or accept credentials — see §4.

- **Look:** `node tools/mirror-pdfs.mjs status` (local, no network) · Actions → "R2 monthly check" → Run workflow (reads the bucket).
- **First/extra pass:** Actions → "Mirror PDFs to R2" → Run workflow. `limit` and `host` inputs allow a small trial
  (`limit 5`, `host ims4maths.com`). A full pass is ~5,600 files / ~65 GB and spans several nights (each run stops at 270 min).
- **Repair after a lost object:** the nightly run's `verify --repair` re-queues anything the manifest calls `ok` that is not in the bucket.
- **Kill switch:** set `_meta.base` to `""` in `data/pdf-mirror.json` → every copy links to its publisher again; nothing else to undo.
  To stop uploads: set repo variable `MIRROR_ENABLED` to anything but `true`.
- **Take one file down (takedown request):** delete the object in the R2 dashboard, set its manifest entry to `"status":"gone"` and remove
  `key/sha256/bytes/origin/miss/checked`; the site then shows the publisher's link. Rights holders are told to open a GitHub issue.
- **Move to a custom domain:** make the bucket reachable on a domain whose DNS is on Cloudflare, put it in `_meta.base`. One line. (`hashin.me`
  is **not** on Cloudflare — DNS is at Spaceship, mail is iCloud — and INTENT-11 says do not migrate nameservers unless Hashin raises it; use a
  separate domain.) `r2.dev` is Cloudflare's development URL: rate-limited, uncached.
- **Cap:** 100 GB, enforced against the bucket's real size before every upload (`R2_MAX_GB` can only lower it). Raising it needs a code change and an ADR.
- **VisionIAS refresh:** `node tools/visionias-urls.mjs [--add-fresh] [--verbose]` (fetches the public `tac.json`, adds new pairs, keeps old ones).

## 3. Facts worth keeping

- VisionIAS's own page renders from one public file, `https://visionias.in/_public/resources/tac.json` — 4,027 rows, only **1,525 with a file**
  (the rest say "File unavailable" on their own site, logged in or not). We walked all 17 subject tabs / every page and they match the file exactly.
- The listing has **no old URL**, and its `resource_id` is a new id space. Pairing is by (name, rank, subject), then booklet order inside the group
  (old filename test number ↔ new `resource_id`, both ascending). Checked by eye on one group and by OCR on 25 groups: 69 decisive matches, 0 swapped,
  77 too faint to judge — an inference, not a proof. If someone reports a question on the wrong booklet, fix that pair in the map.
- Left unpaired on purpose: 30 groups whose old/new counts differ (`--verbose` lists them), 3 old copies whose CSV rows have no topper name.
- `cdn.visionias.in` links that remain (2,537 copies) are dead for good as far as VisionIAS's listing says; they keep their questions and the "no longer serves this copy" note.
- OCR clustering is by **test**, not by copy: one readable booklet per test covers every topper who sat it. `ocr-pipeline.mjs` now fetches the moved URL and prefers a member that has one.
- The R2 object name is `<sha256>.pdf`; two different URLs with identical bytes get a short suffix, because one URL = one copy (INV-3).
- Cost (estimates from memory — check Cloudflare's pricing page): Standard storage ≈ $0.015/GB-month after 10 GB free, no egress fee, reads cheap
  beyond 10 M/month. ~65 GB ≈ $1/month. Cloudflare has no hard spending cap; use billing alerts and a limit on the card (virtual card).
- Making the bucket public means the project distributes publishers' PDFs from its own bucket. Hashin accepted that (INTENT-13). Linking to the
  publisher by default (this design) keeps the public footprint to dead links only.

## 4. Lessons (what cost time, and the rule that follows)

1. **Say what you actually did.** I claimed the Chrome extension had gone through every topper when I had used it only to find `tac.json`.
   Rule: when asked "did you check X", check X, then report the numbers (we then walked every page and compared card by card).
2. **A GitHub Actions run with no jobs and an "Internal server error" annotation is usually GitHub, not our YAML.** Check
   `https://www.githubstatus.com/api/v2/summary.json` (Actions component) before debugging; re-run once. We lost an hour to an Actions outage on 2026-11-09,
   and the unchanged `deploy.yml` failed the same way. (We also moved secrets from job-level `env` to step-level `env` and inputs through `env:` — harmless, matches
   `ocr-gemini.yml`, but not proven to have been the cause.)
3. **A workflow can only be dispatched once it exists on the default branch**; after that `gh workflow run "<name>" --ref <branch> -f k=v` runs the branch's
   copy — use it to test workflow changes before merging.
4. **Credentials:** never ask for, accept, or type them. Hashin once pasted the secret key into chat; the fix is to rotate it and have him run
   `gh secret set R2_SECRET_ACCESS_KEY` himself. Non-secret config (account id, bucket name, variables) was set by the assistant on request.
5. **The command safety classifier chokes on long inline heredoc scripts** ("could not be checked for dangerous rm operations"). Write the script to a file
   in the scratchpad with the Write tool, run it, and never reword a blocked command to get around the check.
6. **The auto-mode classifier blocks "merge without review"** unless the user has said "merge" for that change. Commit/push/merge only when asked; on `main`, branch first
   (every push to `main` deploys).
7. **Prove a pairing/rule on real data before trusting it** — the VisionIAS ordering rule was validated by OCR-ing page strips of the new PDFs and
   matching them to the old question text; the R2 uploader was tested against a mock S3 server and AWS's published SigV4 test vector before any real upload;
   the first real run was 5 files.
8. **Signing/formatting traps:** macOS `sed -i` needs `''`; zsh has `pipestatus`, not `PIPESTATUS`; `index.html` has build-written marker blocks, so after a local
   `node build.js` run `git checkout index.html` unless you meant to change its wording (INV-21 reads it).
9. **Public wording is part of the change.** "Nothing is re-hosted" appeared in ~12 places (index.html, README, build.js footers/FAQ/llms/JSON-LD, dataset README).
   INV-21 now fails if it returns while serving from R2.
10. **Guard the automatic flip.** The nightly check refuses to change anything if its control request fails (broken runner network), needs two failed nights to mark
    an origin down, and flips back on the first success. Residual risk: a publisher that blocks GitHub's IP ranges but not visitors would look "down" — if that is ever
    reported, look at the `why` counts in the check's log line.

## 5. Open items / ideas

- No in-app hint yet when a copy is being served from R2 (a small tooltip on the link would help; `app.js` budget is tight).
- `pin` override (force origin or R2 for one file) is not implemented.
- Google Drive links (991) cannot be mirrored by this tool; Drive's large-file download needs an interstitial — decide before attempting.
- The 30 unpaired VisionIAS groups and 3 blank-topper copies (see §3).
- A custom domain instead of `r2.dev` before real traffic grows.
- First full mirror pass has not completed yet; check `status` and the monthly report.
