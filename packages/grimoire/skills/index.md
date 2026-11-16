---
description: 'Grimoire (experimental), the project map for Warlock.js apps: `warlock scry` and `warlock grimoire build|check|release` over a `grimoire/` folder of generated book entries and agent-written features, flows, apps, tasks and releases. Topics: use the map before searching code, write a feature, record a change and release, describe sites and mobile screens, document a file, backfill an existing app. Use at the start of every task in a project that has `grimoire/`.'
---

# @warlock.js/grimoire

The Grimoire is experimental: its file structure and commands may still change.

`grimoire/` is the map of a Warlock.js project. Warlock writes the **book** (one entry per source file, the routes, the pages and the mobile screens, in `grimoire/book/`, not in git). Agents write what the product does (`grimoire/features/`), where users meet it (`grimoire/apps/`), the work (`grimoire/tasks/`) and the releases (`grimoire/releases/`). Warlock never edits a file an agent wrote.

## The 80% path

1. Before searching the code, ask the map: `use-the-grimoire.md`.
2. A new behaviour starts as a task, a brief, a feature README and a flow, before code: `write-a-feature.md`.
3. After the change, tie tests to criteria, reshape the README, add the changelog entry, close the task, run the check, and at release time stamp the changelogs and write the brief: `record-a-change.md`.
4. Pages, blocks, conditions and mobile screens: `describe-an-app.md`.
5. The header and export comments the book copies from a file: `document-a-file.md`.
6. A project with code but no `grimoire/` folder: `backfill-a-grimoire.md`.

## Conventions and pitfalls

- Never edit `grimoire/book/`, `index.json`, `bookmap.json` or `*.bookmap.json`.
- You write release numbers and dates into changelogs and the release brief; `warlock grimoire release` only writes the collected list.
- A finding marked `(expected)` belongs to `proposed` work and does not fail `warlock grimoire check`.
- Mobile screens are listed from file names only with file-based routing; declare them when navigation is in code.
- Do not invent intent: write `Unknown:` and ask the owner.
