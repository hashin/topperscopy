# Intent — what this is for, and what Hashin has asked for

Append-only. Newest at the bottom of each section. Quote Hashin where possible — his words carry
nuance that a paraphrase loses. Date every entry. Never delete an entry; if intent changes, add a
new one that supersedes the old and mark the old `SUPERSEDED by INTENT-n`.

Each `INTENT-n` is citable from `docs/INVARIANTS.md` and from the checks in `tools/check.mjs`.

---

## The premise

Hashin Jithu cleared the UPSC Civil Services Examination in 2021 (AIR 553). Toppers Copy is a
non-commercial way of giving back: the answer copies that rank-holders wrote in coaching mock tests
are published as PDFs scattered across ForumIAS, Vision IAS, NextIAS, Lukmaan IAS, GS SCORE, Rau's
and others. A student who wants to see how a topper actually answered a specific question has no way
to find it. This site is that way.

> "The website is designed to give students an opportunity to improve their performance in the UPSC
> Mains examination by going through the answer sheets of toppers." — 2026-09-14

---

## INTENT-1 — The unit of value is the question, not the PDF

*Stated 2026-09-14, and implicit in the whole build.*

Anyone can host a list of PDF links. What this project has that nothing else does is
**26,621 questions mapped to the exact page of the exact copy that answered them**, across 1,694
toppers — built by reading every PDF with Gemini and extracting the questions.

> "I have basically created a repository of all those PDFs with a database of searchable questions.
> So, this is being done by using Gemini. I am reading all the PDFs and extracting questions."

**Consequence for every future decision:** the PDFs are commodity, the mapping is the moat. Ask of
any proposed feature whether it deepens the question-level mapping or dilutes it.

*Not machine-checkable. Guides prioritisation.*

---

## INTENT-2 — Loading speed is not a nice-to-have, it is the product

*Stated 2026-09-14, emphatically and more than once.*

> "Speed of loading is very crucial, so suggest excellent ways to reduce it and also make sure that
> the search option is fast and usable to the students."

The audience is UPSC aspirants in India, many on mid-range Android phones on patchy mobile data.
A site that is fast on a MacBook and slow on a ₹8,000 phone has failed the actual user.

**Enforced by:** the gzip budgets at the top of `tools/check.mjs` (boot, `app.js`, each question shard).

---

## INTENT-3 — It must feel smooth, on a phone as much as a laptop

*Stated 2026-09-14.*

> "The end user should feel absolute smoothness while using the website, both on laptop as well as
> on mobile."

"Smooth" is not a vibe; it decomposes into things that can be measured: no layout shift, no long
main-thread blocks, no lost keystrokes, no scroll jumps, no false "no results", and screen readers
that are actually told what happened.

**Enforced by:** `INV-12` (`#resultmeta` is a live region) in `tools/check.mjs`; the never-a-false-zero rule is
DECISION-6, kept as one boolean in `renderBrowse()`.

---

## INTENT-4 — Free, static, and nothing is re-hosted
*Credit clause (crediting upsckata.com on the live site) SUPERSEDED by INTENT-10, 2026-09-17 — the
rest of this entry (no backend, no re-hosting) is still active.*

*Standing, from the project's origin.*

Every "Open PDF" link points at the site that published the file. Toppers Copy hosts no answer copy
and never will — that is both the ethical position and the reason publishers have not objected. The
question-level database itself is mirrored from
[upsckata.com "Topper Copies"](https://toppercopies.upsckata.com/), which must be credited
prominently (README, About, footer, JSON-LD, `llms.txt`).

No backend, no accounts, no paid service in the request path. This is what makes the project cost
nothing to run and impossible to enshittify.

**Enforced by:** `INV-1` (no self-hosted copy URLs), `INV-5` (credit present), `DECISION-1`.

---

## INTENT-5 — Community submissions, but never unmoderated

*Standing.*

Students submit missing copies and topper corrections through a GitHub issue; a collaborator adds
the `approved` label and a workflow merges it. Submitted content reaches the live site, so it is
treated as hostile input until a human has looked at it.

**Enforced by:** `INV-2` (no script-capable URL schemes reach the data), plus the validation in
`.github/scripts/apply-submission.mjs`.

---

## INTENT-6 — Documentation that lies is worse than no documentation

*Stated 2026-09-14, in the request that created `docs/`.*

> "the repo should be designed in such a manner that such information is not lost, and when you are
> working on a later time with a new context, you can pick it up from there and understand the logic
> behind it."

The failure this guards against is specific and has already happened twice here: the README claimed
three optimisations that did not exist, and `CLAUDE.md` carried a stale number that led a correct
decision process to the wrong conclusion. Both were only caught by measuring.

**Enforced by:** `INV-6` (README cannot claim absent optimisations or deleted files), `INV-7` (docs cannot
link to files we do not deploy), and the session protocol in `docs/MEMORY.md`.

---

## INTENT-7 — The repo must carry its own memory across sessions

*Stated 2026-09-14. This is why `docs/` exists.*

> "when we start a repo, we work on it based on the ideas we get as we go forward in the project and
> you make the code. But over the time the context is lost when a new chat is being launched"

And, specifically, that testing must follow from intent rather than float free of it:

> "There should be a central source of truth inside the repository that learns from my requests
> across various chat sessions. The testing must be aligned to the ideas shared there."

**Enforced by:** the structure of `docs/` itself; every check in `tools/check.mjs` cites the
`INTENT-n` or `DECISION-n` it exists to protect, so a future session can always ask "why is this
rule here" and get an answer.

---

## INTENT-8 — Only the machinery the goals need, and code the owner can read end to end

*Stated 2026-09-15.*

> "I genuinely suspect that we have overengineered many stuff through the periodic audits that we
> did. I want you to go through them and see that we are only doing the absolutely necessary stuff
> to meet the goals of the website — which is an easy to load (fastest) website that is completely
> searchable. Also the searching must support both question plus name of toppers (some students
> want questions answered by a specific topper). Refactor code if required. I want to be able to
> completely read and understand this code."

Every product feature stays. What goes is machinery whose only job was to keep other machinery
honest. The test for any future change: can it be explained in two sentences, and does it make the
complete result reach the screen sooner — not merely a count?

**Enforced by:** `DECISION-17`; the `app.js` gzip budget in `tools/check.mjs` (growth there means
machinery crept back); the README-honesty check.

---

## INTENT-9 — An Interviews tab, from upsckata's own interview-transcript archive

*Stated 2026-09-15.*

> "add an 'interview' tab to this website by taking full data from this website:
> https://upsckata.com/interviews … you don't have to specifically credit it for it"

A separate corpus from the GS/Essay `questions.csv` core (INTENT-1's "credit upsckata everywhere"
does not apply here — Hashin was explicit this source needs no credit). 3,863 UPSC Personality Test
transcripts: board, candidate, DAF topics, hobbies, education, mock coachings, and the full
question-by-question transcript.

**Consequence for every future decision touching Interviews:** this is "add," not "integrate" — do
not fuzzy-match candidates to existing toppers, do not assume it should be as tightly woven into
search/SEO as the copies feature, unless Hashin asks for that explicitly. See DECISION-19.

*Not machine-checkable. Guides scope for anything touching the Interviews tab.*

---

## INTENT-10 — Rebrand to "Topper's Copy by Hashin"; stop crediting upsckata on the live site

*Stated 2026-09-17. Supersedes the credit-prominence clause of INTENT-4.*

> "rename the website to 'Topper's Copy by Hashin' and update it in the seo docs and llm.txt and
> everywhere else. remove links to upsc kata from the website, and don't explicitly mention them in
> the about section."

Two changes, both scoped to what a site visitor sees — asked and confirmed in the same session:

1. **Brand.** Every user-facing name string — `<title>`, meta/OG/Twitter tags, JSON-LD `name`
   fields, the manifest, generated static pages (`topper/`, `question/`, `paper/`, `optional/`,
   `toppers*.html`), `llms.txt`, and the About/footer copy — reads "Topper's Copy by Hashin" (the
   manifest's `short_name`, which Android truncates on the home screen, stays the shorter
   "Topper's Copy"). Source comments and `package.json` also updated for consistency, though those
   are not user-facing.
2. **Credit.** Hashin confirmed (asked directly, since this contradicts INTENT-4's own "must be
   credited prominently" and the `INV-5` check as it stood) that the *live site* — `index.html`
   (About section, Interviews tab, footer), `llms.txt`, and the generated JSON-LD — should no longer
   name or link upsckata.com, and the About section should describe the question database's origin
   in generic terms ("earlier open community compilations of these same public answer copies")
   rather than naming a specific source. He explicitly scoped this to the live site: `README.md`,
   `CLAUDE.md`, `docs/` and `dataset/README.md` (maintainer-facing, not shown to a visitor) keep the
   factual upsckata provenance note, so the repo's own history of where the data came from is not
   lost — consistent with `docs/MEMORY.md`'s rule against documentation that lies about the past.

**Consequence for every future decision:** do not re-add an upsckata name or link to `index.html`,
`llms.txt`, or any `build.js`-generated page without asking Hashin again first — this was a
deliberate, confirmed reversal of a standing ethical position (INTENT-4), not an oversight to "fix."
See DECISION-20 for the mechanics and what was rejected.

*Enforced by the (updated) `INV-5` — now checks `README.md` only.*

---

## Open questions Hashin has not settled

Record them here rather than guessing. Move them into an `INTENT-n` once he decides.

- **Hosting.** Whether to leave GitHub Pages (gzip only) or move to a Brotli-serving host. The
  1,078 KB saving measured in `docs/archive/PERF-UX-AUDIT-2026-09-14.md` D2 was against the old
  five-file search payload; re-measure against today's one-shard-per-query model first.
- **Question-first as the default view.** The per-question pages are probably the strongest SEO
  surface, and a student's real query is "how did toppers answer this", not "show me X's GS2 copy".
  Needs Search Console data before deciding (`docs/archive/PERF-UX-AUDIT-2026-09-14.md` Phase 7).
- **How far to push Gemini.** Asking for structured JSON (including the syllabus node) in the same
  OCR pass would close the 44 % syllabus-mapping gap at no extra API cost. Not yet green-lit.
- **Pre-rendering the first page of result cards.** PageSpeed's mobile CrUX field data (2026-09-15)
  showed CLS failing (0.2) but LCP/INP already "Good" — traced to the `#results-skeleton` collapsing
  into 25 real cards once `copies.json` loads. Fixed for now with a reserved `min-height` on the
  skeleton (measured live: ~3000px desktop / ~3680px at 375px). Considered instead: have `build.js`
  render the first page of cards as real HTML (it already computes default sort order and writes a
  similar block for the `<noscript>` fallback) and have `app.js` hydrate rather than rebuild —
  would fix LCP/CLS/INP together but needs a second card-summary renderer kept in sync with
  `copyCard()` in `assets/app.js`. Rejected for this pass: not necessary to fix what's actually
  failing, and adds ongoing complexity the day after DECISION-17/PR #7 deliberately removed some.
  Revisit only if CLS is still bad after the skeleton fix, or if Search Console ever shows Core Web
  Vitals costing rankings.
- **Full-text search inside interview transcripts, and per-interview static SEO pages.** Both deferred
  in DECISION-19's v1 (metadata-only search; no `interview/<slug>/` pages) — real future value, but
  each is a second data-loading path or a second static-page generator, more than "add a tab" asked
  for. Revisit if Hashin wants the Interviews tab to be as searchable/crawlable as the copies feature.
- **`fromFilename()`'s AIR/year regexes silently fail on a very common filename shape.** Both
  `build.js`'s AIR and year patterns end in a trailing `\b`, which requires a non-word character
  after the digits — but fails whenever the number is immediately followed by another underscore
  (`AIR_377_Sample`, `2025_Toppers`), which is common. It even breaks the function's own doc-comment
  example, `Shakti_Dubey_AIR-1_2024_GS1.pdf`. Found 2026-09-19 while fixing the "Gaurav Kumar"
  collision (DECISION-22). Likely fix: replace `\b` with `(?!\d)` in both regexes (verified to work
  ad-hoc, not yet applied). Deferred because it's dataset-wide — fixing it will very likely surface
  previously-null AIR/year on other existing copies, a bigger and more visible change than the
  one-name fix it was found alongside, and deserves its own deliberate look rather than a drive-by.
- **Multiple `GEMINI_API_KEY`s / Google Cloud projects for `ocr-gemini.yml`.** The free daily quota
  is per (project × model), so a second key from a separate project would get its own independent
  500/day-per-model bucket — a real multiplier on top of DECISION-21's concurrency fix. Hashin asked
  to hold off until the concurrency fix's real-world effect on a single key is known (2026-09-18).
  If he gets extra keys, `ocr-pipeline.mjs gemini` needs to accept a pool of keys, not just one.
