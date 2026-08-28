# Toppers Copy

A free, static, community-maintained directory of **UPSC Civil Services Mains topper answer copies** — GS1–4, Essay, and optional subjects. Search across ~17,000 questions and open the exact page of each copy.

Live: **https://topperscopy.hashin.me**

## Credit

The question-level database — which topper answered which question, on which page of which PDF —
comes from **[upsckata.com — "Topper Copies"](https://toppercopies.upsckata.com/)**. This repo is an
independent, non-commercial mirror. It adds:

- an **Optionals** section (Sociology, Anthropology, History, PSIR, Geography, …), which the source
  database doesn't cover — filled entirely from community submissions;
- **per-topper tags** — AIR, exam year, subject-wise marks — auto-seeded from source PDF file names
  and topped up by submissions;
- a **Submit** workflow so students can add missing copies and correct topper data.

No answer copy is hosted here. Every "Open PDF" link points to the file on the site that published it
(ForumIAS, Vision IAS, NextIAS, Lukmaan IAS, GS SCORE, Rau's IAS, …).

## How it's built

Pure static — no runtime backend, no build step required to serve it.

```
data/questions.csv          raw mirror of upsckata.com's questions.csv
build.js                    csv  ->  data/copies.json + data/toppers.json
data/optionals.json         community optional-subject copies (hand-merged)
data/toppers.overrides.json maintainer-verified AIR/marks corrections
index.html, assets/, sw.js  the site
```

Regenerate the JSON after changing the CSV or overrides:

```bash
node build.js
```

The GitHub Action in `.github/workflows/build.yml` does this automatically on push.

## Contributing

- **Add a copy / fix marks:** use the [Submit form](https://topperscopy.hashin.me/#submit) or open an
  issue directly. A maintainer verifies each submission, then:
  - copies → append to `data/optionals.json` (optionals) or add the PDF row to `data/questions.csv` (GS/Essay);
  - topper data → add to `data/toppers.overrides.json` with `"verified": true`.
- Run `node build.js`, commit, done.

## Deploy (GitHub Pages + subdomain)

1. Push this repo to `github.com/hashin/topperscopy`.
2. Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/`.
3. `CNAME` in the repo already sets the custom domain to `topperscopy.hashin.me`.
4. DNS (Cloudflare, `hashin.me` zone): add `CNAME  topperscopy  ->  hashin.github.io` (DNS-only / grey cloud).
5. Wait for the cert, then enable "Enforce HTTPS".

## Licence

Code: MIT. Data: mirrored from upsckata.com — credit them. Rights holders wanting a link removed can
[open an issue](https://github.com/hashin/topperscopy/issues).
