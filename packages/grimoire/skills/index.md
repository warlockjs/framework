---
description: "Grimoire (experimental), the project map for Warlock.js apps: `warlock scry` and `warlock grimoire build|check|release` over a `grimoire/` folder of generated book entries and agent-written features, flows, apps, tasks and releases. Topics: use the map before searching code, write a feature, record a change and release, describe sites and mobile screens, document a file, backfill an existing app. Use at the start of every task in a project that has `grimoire/`."
---

# @warlock.js/grimoire

The Grimoire is experimental: its file structure and commands may still change.

`grimoire/` is the map of a Warlock.js project. Warlock writes the **book** (one entry per source file, the routes, the pages and the mobile screens, in `grimoire/book/`, not in git). Agents write what the product does (`grimoire/features/`), where users meet it (`grimoire/apps/`), the work (`grimoire/tasks/`) and the releases (`grimoire/releases/`). Warlock never edits a file an agent wrote, apart from the changelog stamp you ask for with `warlock grimoire release --stamp`.

## The 80% path

1. Before searching the code, ask the map: `use-the-grimoire.md`.
2. A new behaviour starts as a task, a brief, a feature README and a flow, before code: `write-a-feature.md`.
3. After the change, tie tests to criteria (`@proves`, and `@shows` for what the user sees), reshape the README, add the changelog entry, close the task, run the check, and at release time stamp the changelogs and write the brief: `record-a-change.md`.
4. Pages, blocks, conditions and mobile screens: `describe-an-app.md`.
5. The header and export comments the book copies from a file: `document-a-file.md`.
6. A project with code but no `grimoire/` folder: `backfill-a-grimoire.md`.
7. Keep a change inside its task (features, `Files:`, locked tests, protected areas) and run `warlock grimoire guard` before you stop: `guard-a-change.md`.
8. Review a change from its task and its diff only, never from the author's summary: `review-a-change.md`.

## Conventions and pitfalls

- Never edit `grimoire/book/`, `index.json`, `bookmap.json` or `*.bookmap.json`.
- `warlock grimoire release <version> --stamp` moves every `## Unreleased` entry under the release and writes a missing release file; without `--stamp` it only writes the collected list.
- Every project has a `design-system` feature first; flows with a page step name it in `affects`.
- Only the owner approves a changed screenshot or a removed criterion (`warlock grimoire approve`); list every change that is not approved in your report.
- A finding marked `(expected)` belongs to `proposed` work and does not fail `warlock grimoire check`.
- Mobile screens are listed from file names only with file-based routing; declare them when navigation is in code.
- Do not invent intent: write `Unknown:` and ask the owner.
