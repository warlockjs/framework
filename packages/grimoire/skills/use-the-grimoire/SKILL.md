---
name: use-the-grimoire
description: 'Find the right files before changing a Warlock.js project by asking the Grimoire (experimental): `warlock scry` for a file, a route, a feature, a flow or the impact of a change, and the `grimoire/` folder for what the product does. Use at the start of every task, before searching the code.'
---

# Use the Grimoire

The Grimoire is experimental: its file structure and commands may still change.

`grimoire/` is the map of this project. Read it before you search the code: it tells you where
things are, what a feature is meant to do, and what a change will touch.

| Folder | Holds | Written by |
| --- | --- | --- |
| `grimoire/book/` | One entry per source file, plus routes and pages | Warlock (never edit) |
| `grimoire/features/` | What the product does: features, flows, cases, criteria | You and other agents |
| `grimoire/apps/` | Where users meet it: sites, mobile apps, pages, blocks | You and other agents |
| `grimoire/tasks/` | Open and finished work | You and other agents |
| `grimoire/releases/` | What each release shipped | You, with a list Warlock collects |

Files named `index.json` or ending in `.bookmap.json` are Warlock's. Never edit them.

## Start of every task

```bash
npx warlock scry --search "new arrivals"
npx warlock scry --flow catalog/new-arrivals
npx warlock scry --impact src/app/catalog/models/product.model.ts
```

Read the feature's `README.md` and the flow file, then only the files the flow's book map lists.

## From code

The same answers are available as functions from `@warlock.js/grimoire`, for tools that build on
the Grimoire:

- `openGrimoire` loads everything once (it runs `parseGrimoire`, `buildBook`, `matchApps`,
  `resolveOwnership`, `scanProofs`, `readTestResults`, `buildCollectedFiles`, then `writeBook`
  and `writeCollectedFiles`), and returns a snapshot.
- `scry` answers a query from the snapshot; `formatScryResult` prints it; `parseScryQuery` reads
  CLI arguments into a query.
- `checkGrimoire` runs every rule; `formatCheckReport` prints the report. Each finding has a code
  from `GRIMOIRE_CODES` (also `GRIMOIRE_CODE_LIST`); `explainGrimoireCode`, `isGrimoireCode` and
  `grimoireCodeDocsUrl` (based on `GRIMOIRE_CODES_DOCS_URL`) describe it, and rules build
  findings with `createFinding`. Commands throw `GrimoireError` with a code.
- `collectRelease`, `renderCollectedList` and `writeRelease` gather the changelog entries of a
  release between `COLLECTED_START_MARKER` and `COLLECTED_END_MARKER`.
- `scanProofs` and `scanProofsInText` read `// @proves` lines; `criterionStatus` turns test
  results into a criterion's status; `CASE_QUESTIONS` lists the questions every flow answers.
- Helpers: `loadBook`, `readFrontMatter`, `fileGraph`, `importClosure`, `importerClosure`,
  `bookEntryPath`, `bookEntryPaths`, `toPosixPath`, `GRIMOIRE_DIR`, `GRIMOIRE_PATHS`,
  `GRIMOIRE_IGNORE_RULES` and `BOOK_SCHEMA_VERSION`.
