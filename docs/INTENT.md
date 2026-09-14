# Intent — what this is for, and what Hashin has asked for

Append-only. Newest at the bottom of each section. Quote Hashin where possible — his words carry
nuance that a paraphrase loses. Date every entry. Never delete an entry; if intent changes, add a
new one that supersedes the old and mark the old `SUPERSEDED by INTENT-n`.

Each `INTENT-n` is citable from `docs/INVARIANTS.md` and from the checks in
`tools/check/invariants.mjs`.

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

**Enforced by:** `BUDGET-boot`, `BUDGET-search`, `BUDGET-app_js` in `tools/check/invariants.mjs`,
with ceilings that ratchet down in `tools/check/budget.json`.

---

## INTENT-3 — It must feel smooth, on a phone as much as a laptop

*Stated 2026-09-14.*

> "The end user should feel absolute smoothness while using the website, both on laptop as well as
> on mobile."

"Smooth" is not a vibe; it decomposes into things that can be measured: no layout shift, no long
main-thread blocks, no lost keystrokes, no scroll jumps, no false "no results", and screen readers
that are actually told what happened.

**Enforced by:** `INV-10` through `INV-17`. Measured by `tools/perf/`.

---

## INTENT-4 — Free, static, and nothing is re-hosted

*Standing, from the project's origin.*

Every "Open PDF" link points at the site that published the file. Toppers Copy hosts no answer copy
and never will — that is both the ethical position and the reason publishers have not objected. The
question-level database itself is mirrored from
[upsckata.com "Topper Copies"](https://toppercopies.upsckata.com/), which must be credited
prominently (README, About, footer, JSON-LD, `llms.txt`).

No backend, no accounts, no paid service in the request path. This is what makes the project cost
nothing to run and impossible to enshittify.

**Enforced by:** `INV-1` (no self-hosted copy URLs), `INV-2` / `INV-2b` (credit present),
`DECISION-1`.

---

## INTENT-5 — Community submissions, but never unmoderated

*Standing.*

Students submit missing copies and topper corrections through a GitHub issue; a collaborator adds
the `approved` label and a workflow merges it. Submitted content reaches the live site, so it is
treated as hostile input until a human has looked at it.

**Enforced by:** `INV-4` (no script-capable URL schemes reach the data), plus the validation added
in `AUDIT-2026-09-09.md` B4–B6.

---

## INTENT-6 — Documentation that lies is worse than no documentation

*Stated 2026-09-14, in the request that created `docs/`.*

> "the repo should be designed in such a manner that such information is not lost, and when you are
> working on a later time with a new context, you can pick it up from there and understand the logic
> behind it."

The failure this guards against is specific and has already happened twice here: the README claimed
three optimisations that did not exist, and `CLAUDE.md` carried a stale number that led a correct
decision process to the wrong conclusion. Both were only caught by measuring.

**Enforced by:** `INV-15` (README cannot claim absent optimisations), `INV-14b` (docs cannot link to
files we do not deploy), and the session protocol in `docs/MEMORY.md`.

---

## INTENT-7 — The repo must carry its own memory across sessions

*Stated 2026-09-14. This is why `docs/` exists.*

> "when we start a repo, we work on it based on the ideas we get as we go forward in the project and
> you make the code. But over the time the context is lost when a new chat is being launched"

And, specifically, that testing must follow from intent rather than float free of it:

> "There should be a central source of truth inside the repository that learns from my requests
> across various chat sessions. The testing must be aligned to the ideas shared there."

**Enforced by:** the structure of `docs/` itself; every check in `tools/check/invariants.mjs` cites
the `INTENT-n` or `DECISION-n` it exists to protect, so a future session can always ask "why is this
rule here" and get an answer.

---

## Open questions Hashin has not settled

Record them here rather than guessing. Move them into an `INTENT-n` once he decides.

- **Hosting.** Whether to leave GitHub Pages (gzip only) or move to a Brotli-serving host for a
  measured 1,078 KB saving. Three options with different risk profiles are laid out in
  `PERF-UX-AUDIT-2026-09-14.md` D2. *Not urgent — the format work in Phases 3–5 is
  hosting-independent and delivers most of the win.*
- **Question-first as the default view.** The per-question pages are probably the strongest SEO
  surface, and a student's real query is "how did toppers answer this", not "show me X's GS2 copy".
  Needs Search Console data before deciding (`PERF-UX-AUDIT-2026-09-14.md` Phase 7).
- **How far to push Gemini.** Asking for structured JSON (including the syllabus node) in the same
  OCR pass would close the 44 % syllabus-mapping gap at no extra API cost. Not yet green-lit.
