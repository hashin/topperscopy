# Moderators

Moderators review submitted answer copies, confirm they're genuine, and approve
them. Approval is a one-click action — a GitHub Action does the rest.

## Current moderators

| GitHub | Added |
| --- | --- |
| [@hashin](https://github.com/hashin) | owner |

<!-- add a row when you add a collaborator -->

## Appointing a moderator

1. Repo **Settings → Collaborators → Add people** → invite their GitHub username.
2. Give them the **Triage** role (they can label/close issues but can't push code — that's enough).
   Use **Write** only if you also want them editing files directly.
3. Add them to the table above and commit.

Remove one by removing the collaborator; they immediately lose the ability to approve.

## Approving a submission

1. Open the [submission queue](https://github.com/hashin/topperscopy/issues?q=is%3Aissue+is%3Aopen+label%3Asubmission).
2. Open the copy link in the issue. **Check it's a real topper copy** — right person, right
   paper, not a fake or a re-upload of paid material, link works.
3. If it's good, add the **`approved`** label.

That's it. The `Moderate submissions` workflow then:

- checks you're a collaborator (a non-collaborator physically can't add the label, but it double-checks),
- applies the submission:
  - **optional subject** → new entry in `data/optionals.json` (with question text if the issue has it),
  - **GS / Essay** → question rows appended to `data/submissions.csv`,
  - AIR / year / marks → `data/toppers.overrides.json`,
- runs `node build.js`, commits, pushes — the site redeploys in ~1–2 min,
- comments a summary on the issue, labels it `merged`, and closes it.

If it can't apply automatically (e.g. a GS copy with no extracted questions), it comments the
reason and removes the `approved` label so you can fix the issue body or handle it by hand
(`node extract.js …`) and re-approve.

## Rejecting

Close the issue with a short comment. No label needed.
