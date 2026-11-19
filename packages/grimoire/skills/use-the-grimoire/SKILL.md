---
name: use-the-grimoire
description: "Find the right files before changing a Warlock.js project by asking the Grimoire (experimental): `warlock scry` for a file, a route, a feature, a flow or the impact of a change, and the `grimoire/` folder for what the product does. Use at the start of every task, before searching the code."
---

# Use the Grimoire

The Grimoire is experimental: its file structure and commands may still change.

`grimoire/` is the map of this project. Read it before you search the code: it tells you where
things are, what a feature is meant to do, and what a change will touch.

| Folder               | Holds                                                   | Written by                                     |
| -------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `grimoire/book/`     | One entry per source file, plus routes and pages        | Warlock (never edit)                           |
| `grimoire/features/` | What the product does: features, flows, cases, criteria | You and other agents                           |
| `grimoire/apps/`     | Where users meet it: sites, mobile apps, pages, blocks  | You and other agents                           |
| `grimoire/tasks/`    | Open and finished work                                  | You and other agents                           |
| `grimoire/releases/` | What each release shipped                               | You write the brief, Warlock collects the list |

Files named `index.json`, `bookmap.json` or ending in `.bookmap.json` are Warlock's. A feature's
`bookmap.json` says what the feature owns and borrows, and each flow's `*.bookmap.json` says which
files sit behind each step and which tests prove each criterion. They are rebuilt on demand and are
not in git. Never edit them; change the code or the written files and they follow. Warlock never
edits a file you wrote either.

## Start of every task

1. Find the feature and flow the task is about.

   ```bash
   npx warlock scry --search "new arrivals"
   ```

   ```text
   flow     catalog/new-arrivals          New arrivals
   block    web-client/home/new-arrivals  catalog/new-arrivals
   route    GET /api/products/new-arrivals
   file     src/app/catalog/services/new-arrivals.service.ts  Lists the newest products sold in the customer's country.
   ```

2. Read the feature's `README.md`, then the flow file. They say what the behaviour should be.
3. Ask for the flow's book map. It lists the files behind each step, the tests that prove each
   criterion and the pages that show the flow.

   ```bash
   npx warlock scry --flow catalog/new-arrivals
   ```

4. Read only those files. Do not read a whole module to find one function.

## Questions the book answers

```bash
npx warlock scry src/app/catalog/services/new-arrivals.service.ts   # what is this file?
npx warlock scry --impact src/app/catalog/models/product.model.ts   # what breaks if I change it?
npx warlock scry --route "POST /api/orders"                         # what is behind this URL?
npx warlock scry --feature catalog                                  # the whole feature
npx warlock scry --flow catalog/new-arrivals                        # one flow, step by step
```

Add `--json` for machine-readable output. `--impact` lists API routes, pages, flows and features,
including features that only borrow the file; each list has a count and stops at 20 lines, and `--all`
prints every line. `--search` also reads a flow's summary, story, cases and criteria (`AC-5` works), ranks features and flows above files, and groups hits by type; a hit found by written text shows the part that matched in brackets. Read the flows it names and run their tests after
your change.

A file's entry is also at a fixed path: `src/app/auth/controllers/login.controller.ts` is described
in `grimoire/book/app/auth/controllers/login.controller.json`.

## Commands

| Command                                     | Does                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `warlock grimoire build`                    | Builds or refreshes the book. `scry` and `check` do it when it is stale                                                                |
| `warlock grimoire build --site [--out dir]` | Also writes the book as a static site (default `grimoire/book/site`); skipped when the folder is already current (`--force` writes it) |
| `warlock grimoire build --site --product`   | Writes the business export: the Product map only, no file paths, test names or per-file answers                                        |
| `warlock grimoire check`                    | Reports broken names, untested criteria, files with no owner. Exit 1 on an error; `--all` lists every warning                          |
| `warlock grimoire release <release>`        | Writes the collected list into `grimoire/releases/<release>.md`                                                                        |
| `warlock explain GR2001`                    | Explains a finding code                                                                                                                |

Every finding has a code (`GR2001`) and a fix hint. A finding marked `(expected)` belongs to work
that is still `proposed`; it does not fail the check.

## What to trust

- **Exports, imports, importers, routes, middleware, pages:** read from the code. Trust them.
- **Route middleware:** a route step also reaches the middleware files the matched route names (not the routes file's other imports). Roles that run by being present (migration, seed, command, main, layout, root) and spec-only helpers are not listed as unreached.
- **Dev tab route facts:** the dev tab reads routes, events and jobs from the running dev server (nothing is booted twice), so it shows `routes: fresh` on the first open; they are read once, so rebuild with `warlock grimoire build` after changing routes.
- **Without route facts** (`routes: missing`): route, mail, notification, job and event steps are `found: null` (not checked), not resolved and not failed; `GR5008` skips mail and notification entries.
- **Files behind a route:** every file the handler can reach through imports. It is not the exact
  call path; open the handler to see which ones it really uses.
- **Reached from:** only links and redirects written as plain values. `unknown` means look.
- **Written files:** they say what should happen. When the code disagrees with a flow, do not
  pick one silently. Say which is wrong, and fix it or ask the owner.

## When there is nothing to find

- No flow matches the task: the behaviour is undescribed. Describe it first with
  `write-a-feature`, then change the code.
- The command says the book is missing or stale: it rebuilds on its own. If it reports problems,
  read them; `npx warlock grimoire check` prints the same list.
- The project has code but no `grimoire/` folder: use `backfill-a-grimoire`.

## See also

`write-a-feature`, `record-a-change`, `describe-an-app`, `document-a-file`, `backfill-a-grimoire`.

## From code

The same answers are available as functions, for tools that build on the Grimoire.

From `@warlock.js/grimoire` (no dependency on core or web):

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
- Flow steps list `entries` (every file the step starts from), `direct` (their direct imports), `files` (what
  runs: type-only imports are not followed) and `typeOnlyFiles` (reached only through type-only imports).
  `importClosure(graph, start, { skipTypeOnly: true })` leaves type-only edges out. `warlock scry --flow --json`
  keeps every list; the MCP tool `grimoire_flow` and the devtools flow route send counts and the first 50 direct
  imports per step, and list one step's files on request (`files: "reachable"` or `"type-only"` with `step`).
- Helpers: `loadBook`, `readFrontMatter`, `fileGraph`, `importClosure`, `importerClosure`,
  `bookEntryPath`, `bookEntryPaths`, `toPosixPath`, `GRIMOIRE_DIR`, `GRIMOIRE_PATHS`,
  `GRIMOIRE_IGNORE_RULES` (the `.gitignore` lines) and `BOOK_SCHEMA_VERSION`.

From `@warlock.js/grimoire/warlock` (needs `@warlock.js/core`): `registerGrimoireCommands` returns
the `grimoire` and `scry` commands for `cli.commands` in `warlock.config.ts`;
`createWarlockAdapter` builds the adapter that feeds the book from the inspect report (it also supplies the
optional `host()` described below);
`collectMobileFacts` lists mobile screens from Expo Router file names.

A custom `BookAdapter` may add `host(root)`, returning `{ name, version, logo, app }` (the framework's name,
installed version and a small `data:` logo, and the app's own `{ name, version }`), or `null`. The tab shows the
framework logo and version in its header and the app name and version at the bottom, in the static export and
in the shared Product map too; an adapter without `host()` shows nothing. The summary and product answers carry it
as `host` (`null` when absent); the feature answer's `flows` also carry `steps`, `cases`, `criteria`, `tested` and
`findings` counts.

The devtools feature route (`/features/:feature`) adds three fields for the tabbed page: `map` (the feature map:
`columns` are each site and mobile app the flows touch, titled by the app's heading, then `api`, then `background`;
`rows` has one entry per flow with `cells` keyed by column id, each cell a list of chips `{ step, type, label, found,
app, page, method, path, file }` taken from the steps the book already resolved), `fileGroups` (the own files by module)
and `proofs` (each flow's criteria with their tests). Each product map feature card carries `strip`: `flows`
`{ total, shipped }`, `criteria` `{ total, proven, failing, measured }` (`measured` is `false` when tagged tests have no
recorded results), `screenshots` `{ places, present }` and `findings` `{ errors, warnings }`. The feature and flow pages
have tabs with their own hash routes: `feature/<id>[/flows|files|findings|tests]` and
`flow/<feature>/<flow>[/proof|files|findings]`.

From `@warlock.js/grimoire/vitest`: `grimoireReporter` records the last result of every test marked
`// @proves` into `grimoire/book/test-results.json`. Add it to the Vitest `reporters` list.
`grimoireReporter({ file })` writes to another path (for a deploy that ships CI results); `readTestResults(root, file?)`
reads it, and the panel option `testResultsFile` and `openGrimoire` option `testResultsFile` point the tab at it.
The check warns with `GR4009` when `@proves` lines exist and no results were found, and with `GR4010` when the
reporter could not match a proving test.

From `@warlock.js/grimoire/devtools`: `grimoireDevtoolsPanel` (the default export) is the Grimoire
tab for `@warlock.js/devtools`, listed in `panels` of `src/config/devtools.ts`;
`exportGrimoireSite` writes the same view as a static site.
The tab keeps its snapshot until the book changes in production and refreshes it in the background in
development; the results file's modified time is part of the change stamp, so new results show without a restart.
The tab also has a Product map: the features, flows, apps, releases and planned work in plain words, from the written
files (summaries, `audience`, `## Why`, `## Story`) and the images in `grimoire/screenshots/`. Its routes are
`/product`, `/product/features/:feature` and `/product/flows/:feature/:flow`; `/check/groups` and `/check?code=`
give the check by code and a page of one code's findings. Set `ttlMs` with `panels: [["@warlock.js/grimoire/devtools", { ttlMs: 60_000 }]]`.
