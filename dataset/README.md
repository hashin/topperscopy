# Toppers Copy — complete dataset

A consolidated, self-contained backup of everything the [Toppers Copy](https://topperscopy.hashin.me) project has
collected: every question from every UPSC Civil Services Mains topper answer copy, plus per-topper
All-India Rank, exam year and subject-wise marks. **Accepted community submissions are included.**

This directory is a reference archive — the website does not load it. Regenerate it with `node build.js`.

- **Snapshot:** 2026-08-30
- **16,947** questions · **1,512** answer copies · **457** toppers
- **449** copies came from community submissions (the rest from the upstream mirror)

## Files

| File | What it is |
| --- | --- |
| `questions.csv` | The complete flat table — one row per question. The main reusable artefact. |
| `copies.csv` | One row per answer copy (index / summary). |
| `toppers.csv` | One row per topper — AIR, year, subject-wise marks, copy & question counts. |
| `dataset.json` | The same data as a single nested JSON (`meta`, `toppers[]`, `copies[]` with `questions[]`). |
| `manifest.json` | Generation date, source commit, and SHA-256 + row counts for each file. |

### `questions.csv` columns

`copy_id`, `topper`, `air`, `year`, `paper`, `optional` (0/1), `source`, `provenance`
(`upsckata` \| `submission` \| `mixed`), `page`, `marks`, `word_limit`, `question`,
`pdf_url` (the copy), `pdf_page_url` (deep link to the page).

## Provenance & licence

- The question-level data collection is credited to **[upsckata.com — "Topper Copies"](https://toppercopies.upsckata.com/)**.
- Answer-copy PDFs are the property of the institutes that published them (ForumIAS, Vision IAS,
  NextIAS, Lukmaan IAS, GS SCORE, Rau's IAS and others). **No PDF files are in this dataset** —
  only links to them.
- Questions are extracted from PDFs heuristically and may contain misreads, duplicates or gaps.
  Always check `pdf_page_url` if something looks off.
- This **compilation** is released under **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**:
  reuse freely, credit "Toppers Copy (https://topperscopy.hashin.me)" and upsckata.com.
- A rights holder who wants a copy removed can [open an issue](https://github.com/hashin/topperscopy/issues).
