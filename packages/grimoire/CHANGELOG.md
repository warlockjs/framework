# Changelog — @warlock.js/grimoire

`@warlock.js/grimoire` is new in 5.55.0 and experimental: its file layout, `GR` codes and API may change in any release until it is marked stable.

## 5.63.0

### Added

- `warlock scry --route "GET /chat"` finds pages and mobile screens. For `GET` and `HEAD` with no API route on the path, it looks the path up in the pages and screens and returns each one with its file, setup file, layouts and the import closure of those; a path several sites serve lists every site, and the new `--site <id>` (and an optional `site` on `grimoire_route`) keeps one. `ScryRouteResult.route` is `null` for such a page and `pages` lists the matches. A page URL is found even before the route facts were read, and the `GR9002` message names the pages on the path when the method is not `GET` or `HEAD`.
- `warlock scry --json` prints a failure as `{ "type": "error", "code", "message", "fix" }` on stdout and exits 1 (text mode still writes to stderr). The shape is the new `ScryError` type; the scry MCP tools (`grimoire_file`, `grimoire_impact`, `grimoire_route`, `grimoire_feature`, `grimoire_flow`, `grimoire_search`) return the same JSON as their error text.
- Page, screen, block and file search hits carry `app`; `--app <id>` and the `app` input of `grimoire_search` keep one app's hits.
- `GR9007` (error): the book was never built, or was built by another version. Run `warlock grimoire build`.
- `openStoredGrimoire(root, adapter)`, the read-only open behind `scry`, and `checkBook()`, the change check of `buildBook` with nothing rebuilt or written. The snapshot gains an optional `behind` field.
- `SCRY_STOP_WORDS`, the extendable list of words search leaves out.

### Changed

- `warlock scry` and the MCP read tools only read. They answer from the book the last `warlock grimoire build` left on disk and no longer rebuild it, boot the app or write a file. Each call used to run the whole pipeline (book maps, owners, proofs, a write comparison); it now runs one change check and reads the stored book. When code, test or written files differ from the book, the answer is still the stored one and ends with `note book is stale (12 files changed); run warlock grimoire build` (in `--json`, the `notes` list). `grimoire_check` reads the stored book the same way and adds a `note` when it is behind.
- `warlock grimoire build` and `warlock grimoire check` now also write `grimoire/book/.cache/derived.json` (owners, apps, proofs, test results, book maps, annotations). It is a git-ignored cache.
- `warlock scry --route` no longer boots the app to read missing route facts; it stops with `GR9002` and tells you to run `warlock grimoire build`.
- `warlock scry --search` takes a whole sentence (a commit title, a bug report). A hit no longer needs every word: hits whose name or title is the text, starts with it or holds every word come first, and everything else is ranked by a BM25F score over the id and path words (weight 3), export names (2), the header sentence (1) and written text (1), with whole-word matching and light stemming. Ids such as `AC-5` and `WL9003` stay one word. Matching by letters in order (`newarr`) is gone. Help text, the skill and the docs tell agents to pass the whole sentence.
- `--search` prints hits in score order with the score in front of each line (features and flows first only on an equal score, then page and screen files before helper files), no longer grouped by type. The search index is built once for each opened book.
- The dev Grimoire tab reads the route facts again from the running dev server after a routes file (or a file it imports) changes, so a route edit shows as `fresh` without `warlock grimoire build`.

### Fixed

- Search words match whole words only: `ui` no longer matches `build`. A block is found by `<app>/<page>` and its text, so a block whose long text shares a word with the query no longer matches through its id.
- A live read of the route facts that finds fewer than half of the routes the book already holds no longer replaces the stored list: the book keeps it, writes nothing for it, reports the facts `stale` and adds a note, which `warlock grimoire build` and `grimoire_build` print. `warlock grimoire build --force` trusts the read, so a real removal is still accepted. The manifest stores the route and page counts of the last read (`boot.counts`).
- Route facts where no route names its source file are reported as `route facts look incomplete; run warlock grimoire build` in `GR9002` and in `--impact` and other answers' notes.
- The dev Grimoire tab no longer reports route facts `fresh` for about a minute after a routes file changed: the files the route facts were read from are part of its change stamp, so the next view reopens at once.
- The dev Grimoire tab's route view shows the pages behind a page URL instead of failing on it.

## 5.61.0 - 2026-11-20

### Added

- A flow with no writes (only pages and GET, HEAD or OPTIONS routes) may leave out the `duplicate` and `double submit` case questions; the other six are still required (`GR1012`).
- New check `GR5010` (warning): a name written in backticks in a block table's "Changes with" that is not a condition declared in the app README. Plain text is never reported.
- The dev Grimoire tab reads route, event and job facts from the running dev server, so the first open shows fresh routes without `warlock grimoire build` and without booting the app a second time. New `createWarlockAdapter({ live: true })`, `liveInspect()` and snapshot source option `liveFacts`.

### Changed

- The dev Grimoire tab warms the book in the background when the dev server starts. On a 10,400-file app, the first open after the warm-up takes about 0.1 s instead of about 6.6 s; an open that comes before the warm-up ends still waits for it (about 6.7 s). Concurrent first requests share one build, as before. Streaming partial answers is not part of this release.

### Fixed

- Docs: items written `name: text` in "Changes with" are checked against the app's conditions (`GR5002`); this was always so, but the docs said otherwise.

## 5.59.0 - 2026-11-19

### Added

- The adapter has an optional `host()` that reports the framework name, version and logo and the app's name and version (its `package.json`). The devtools tab shows them in the header and footer, and the static export does too. The Warlock adapter implements it.
- The flow list shows flow cards with the counts that matter (steps, cases, criteria, proven criteria, unexpected findings), and `scry --feature` answers carry the same counts per flow.
- A "What changed" timeline lists releases, tasks and changes with reference chips that jump to the feature or flow they name.
- Feature and flow pages are tabbed. A feature map shows flows against apps, and the flow page's journey and health strip sit in their own tabs. A loading skeleton shows while the book opens.
- The Product map sorts its features and shows what changed since a release you pick.
- `warlock grimoire build --site --product` exports the share-safe Product map only: no file paths, test names or per-file answers, and the page opens on the map.
- Search indexes the written text of flows (summary, who, story, cases and criteria such as AC-5), and written content ranks above files and exports; hits are grouped by type.
- `openGrimoire`'s snapshot source takes an opt-in `collectRoutes` option that collects route, event and job facts once when the book has none. It boots the app for inspection, so it is meant for tooling processes only, never for a process that serves the app; the devtools panel does not use it.

### Changed

- The MCP server (and any long-running process that queries the book) keeps the opened book in memory between calls and opens it again only when a file or folder it lists changed; a one-off `warlock scry` call still opens the book once. `build --site` leaves the page alone when it was built from the same book; `--force` writes it again.
- Steps that could not be checked (no route facts yet) are counted as unchecked, apart from the missing ones, and never count against a flow's health.
- The shared Product map shows a grey "not measured" instead of a problem when no test results were recorded.

### Fixed

- GR3006 no longer reports files that are reached: route middleware is followed, files with a role that runs by being present (migration, seed, command, main, layout, root) are exempt, and test helpers (files under `tests/`, `__tests__/`, `fixtures/`, `support/` or named `*.test-utils.*`) that only specs import count as reached. A source file that only its own spec imports still warns.
- GR5008 is skipped for mail and notification entries when the book has no route facts, instead of reporting an entry the booted app would have confirmed.

## 5.58.0 - 2026-11-18

### Added

- Flows have a summary: the paragraph under the `# Title`. It shows on the flow page, in `scry --flow` and in the product map. A flow without one gets the warning GR1030.
- The devtools Grimoire tab has a flow page: summary, status and origin, previous and next flow, a health strip, a "Fix next" box with a ready `@proves` line, the journey as a stepper with file counts, one row per criterion with its tests, and edge cases with "does not apply" collapsed.
- A "Product map" view in the Grimoire tab for readers who do not read code: feature cards with a plain summary, audience, apps and a health light; feature pages with why, flows as short stories, where each appears in the apps with screenshots, release history and planned work; flow pages with the steps in the user's words and what proves them. Code detail sits behind "For developers". In the production monitor an admin can share it with a read-only link.
- Written format: feature `audience` and `## Why`, flow `## Story`, screenshots as image lines pointing into `grimoire/screenshots/` (pages, blocks and story steps), and `(AC-n)` at the end of a case line to link it to a criterion. New checks GR1029, GR2013 and GR2014.
- The panel option `testResultsFile` reads test results from another file; the reporter writes there with `grimoireReporter({ file })`. New warnings GR4009 (proofs but no recorded results) and GR4010 (a proving test the reporter could not match).
- The static export includes the product map and its screenshots.
- A new route pages through the files of one flow step.

### Changed

- Flow steps list the files that run: type-only imports are no longer followed, so a page that imports a type through a barrel no longer lists the server files behind it. Book maps add `entries`, `direct` and `typeOnlyFiles` per step, and book entries add `typeOnlyImports`. Ownership coverage (GR3006) still counts type-only reach.
- The devtools flow answer and the MCP `grimoire_flow` tool send counts and direct imports per step instead of every reachable file. Flow answers on large apps drop from megabytes to kilobytes.
- The Check tab groups findings by code with counts and the fix shown once, filters by severity, code, feature and flow, and shows "files no flow reaches" (GR3006) one row per feature. The Overview's top problems rank by severity, then by count.
- The devtools tab works on phones: cards instead of tables, scrolling sub-tabs, no overflowing tables or wrapped ids, and readable module graph labels. Code spans in criteria and task text render as code.
- The Test results view tells "no results recorded" apart from "did not run" and picks up new results without a restart.

## 5.57.0 - 2026-11-18

### Added

- The devtools Grimoire tab has a Features view: every feature with its status, version, summary and flows, with a status filter, a text filter, sorting and counts.
- New `/features` data route. `/apps` rows carry each page or screen's route, heading, layout, blocks and whether it is confirmed or inferred, and `/summary` gains app, page, screen and release counts. Existing fields are unchanged.

### Changed

- The Grimoire tab is rebuilt: a tab bar (Overview, Features, Apps, Tasks, Releases, Check, Modules) with counts and breadcrumbs, and a search box with the `/` shortcut, results grouped by type and arrow-key navigation.
- The Overview shows stat cards, recent releases and the top check problems. Apps groups pages and screens by route segment with a filter. Tasks, Releases, Check and Modules are filterable lists, and Check keeps what to fix apart from expected findings.
- The tab shows an "Opening the book…" state while a large book opens, and a failed view says what failed and what to do next.
- The tab uses the dashboard's colour tokens, so links and status text are readable in the light and the dark theme. The static export defines the same tokens for both themes.
- The tab keeps its snapshot until the book changes in production (no time limit) and starts opening the book when the panel is created, so the first view is fast on large apps. In development it serves the cached snapshot at once and refreshes it in the background; a failed refresh keeps the old snapshot. Set `ttlMs` through the panel options (`[specifier, options]` in devtools' `panels`) to choose a fixed reuse time.

## 5.56.0 - 2026-11-17

### Added

- The Grimoire tab works in the devtools production monitor. It is read-only there: it opens the book without writing any file. `GrimoireDevtoolsPanel` gains `production`, and `GrimoirePanelContext` gains `mode`.

## 5.55.0 - 2026-11-17

### Added

- `parseGrimoire(root)` reads every agent-written file under `grimoire/`: features, changelogs, flows, version briefs, apps, layouts, pages, screens, blocks, tasks and releases. It keeps the file and line of each value, and reports a broken structure as a `GR1001`–`GR1028` finding instead of throwing. CRLF files, `*` bullets, tabs, tables without outer pipes and lists a Markdown formatter has collapsed to one space are read too. Written files are read a few at a time, and a task `Brief:` outside `grimoire/` is reported and never looked up.
- `buildBook()` writes the book to `grimoire/book/`: one JSON entry per source file, an `index.md` summary per module, `app/routes.json`, the page list of each site and the screen list of each mobile app.
- `buildBook()` hashes a source file only when its size or modification time changed. A run with no changes calls no adapter and writes nothing.
- `buildBook()` caches route facts. It reads the routes again only when a routes file, something it imports, a config file or a mail, job, event or notification file changes, or when called with `routes: "fresh"`.
- `buildBook()` writes each file atomically (book maps and indexes too), rewrites only the entries that changed and removes the entries of deleted files.
- `loadBook()` reads the book without an adapter.
- `features/<feature>/bookmap.json` lists the files a feature owns, the files it borrows, its routes, its pages per app and the files no flow reaches.
- `flows/<flow>.bookmap.json` lists the files behind each step, each criterion's tests with their last result, and the blocks that show the flow.
- `features/index.json` and `tasks/index.json` are rewritten only when their content changes.
- `openGrimoire()` loads the whole book in one call. Pass `write: false` to compute it in memory.
- `warlock grimoire check` reports names that point at nothing (routes, pages, mails, jobs, events, notifications, flows, apps and criteria), source files without a header or a feature (a `@feature` tag may have text after the id, and a `folders` entry may start with `./`), files no flow reaches, criteria without a test, `@proves` lines that name nothing, and README versions and dates that differ from the changelog.
- Findings on proposed work show as expected and never fail the check. Every `GR` code is listed in the docs.
- `warlock grimoire build` (with `--force`, and `--site [--out]` for a static site) writes the book. `--out` must be a folder inside the project, not the project folder itself (`GR9006`). Route steps in the check match like `warlock scry --route`: `:id` and `[id]` are the same, a trailing `/` is ignored and the method may be in any case. The build summary counts open and waiting tasks separately.
- `warlock grimoire check` exits with 1 only on unexpected errors. The text shows every error, and for each code with more than five warnings the first five and a count; `--all` lists every finding and `--json` is always complete. `build` and `check` end with the book state and the time, after the app's own boot output.
- `warlock scry --impact` counts each list in its heading and stops a long list at 20 lines with "… and N more"; `--all` prints every line and `--json` stays complete.
- `warlock scry --search` ranks exact name or path, prefix, whole word, substring, header sentence and fuzzy matches in that order, then by type.
- The book and its freshness fingerprint cover code files only (plus `package.json` and config files for the route cache); images, fonts and certificates are not listed.
- `warlock grimoire release <version>` writes the changelog entries stamped with that version between the markers of `grimoire/releases/<version>.md`. It never changes a feature changelog or a version brief, and refuses a release file with two collected lists.
- `warlock scry` answers file, impact, route, feature, flow and search questions, with per-criterion test status for a flow. A file answer has the same `packages` as its book entry, and its JSON includes `bookEntry`. It prints compact text, or JSON with `--json`.
- The `grimoire_*` MCP tools answer the same questions as `warlock scry`.
- File questions never boot the app. `build` and `check` read the routes again only when they changed.
- `registerGrimoireCommands()` registers the commands. Add it to `cli: { commands: [...] }` in `warlock.config.ts`.
- `warlock explain GR2001` describes any Grimoire code.
- `createWarlockAdapter()` builds the book from the facts of `warlock inspect`. For a mobile app it reads only the source folders, not `android/`, `ios/` or build output, and the manifest records the installed `@warlock.js/core` version, so a core upgrade rebuilds the book. Mobile screens are listed in the same order on every machine.
- Task and release checks report the problems in `GR6001`–`GR6003` and `GR7001`–`GR7005`.
- The apps check (`GR5001`–`GR5009`) covers blocks, conditions, pages, layouts, screens, entry points, uncovered sites and mobile apps.
- Mobile screens are read from the Expo Router file names. When a mobile app defines its navigation in code, the agent declares its screens in `grimoire/apps/<app>/screens/`.
- `@warlock.js/grimoire/vitest` exports a Vitest reporter. It records the last result (pass, fail or skipped) of every test marked `// @proves <feature>/<flow> AC-n` in `grimoire/book/test-results.json`, and merges the results of partial runs, keeping the results of test files that had not started when a run stopped. Proof lines are read from a few test files at a time.
- The reporter marks a result older than its test file as stale. `warlock grimoire check` reports failing (`GR4006`), stale (`GR4007`) and not-run (`GR4008`) criteria.
- A Grimoire tab for the devtools dashboard, registered with `panels: ["@warlock.js/grimoire/devtools"]`. It has one search box across flows, blocks, routes, files and tasks, and views for features, flows, pages, tasks, releases and the check report. It also shows small graphs of a file, a feature, a page and module coupling. It keeps the generated book up to date from the cached routes, never boots the app and never changes an agent-written file; requests that arrive together share one load, and a slow open is reused for a while. A task waiting for approval is listed only under "Waiting for approval".
- `exportGrimoireSite()` writes the same tab as one static `index.html` for people without the app running. It accepts an absolute `outDir`, and the page does not contain the project's absolute path.
- Six agent skills (`use-the-grimoire`, `write-a-feature`, `record-a-change`, `describe-an-app`, `document-a-file` and `backfill-a-grimoire`), a skills index, and a README that describes the install and which files Grimoire owns.
- A flow can name a mail by any `*.mail.ts` or `*.email.ts` file, or a file in a `mails/` or `emails/` folder. A `job` step can name a queue job (`defineJob()`), a scheduled task or a `*.job.ts` file, and `warlock scry --search` finds mails and jobs by name.
- A page step can name its app, `page   /support [web-admin]`, for pages that share a path on two sites or a site and a mobile app. The step looks only in that app; an unknown app is `GR2008` and an app the feature does not list is `GR2009`.
- A feature `folders` entry with a code-file extension owns that one file. It wins over a folder of another feature, and a missing file is `GR3005`.
- `origin: inferred` or `confirmed` is allowed on an app README, a layout, a page and a screen, as on features and flows.
- `GR1004` lists the allowed task statuses, and the skills name `waiting for approval` as the status of a task that needs the owner's answer.
- The `backfill-a-grimoire` skill says where the changelog line goes, how to write a case the code answers by doing nothing, what starts a flow, and that "does not apply" lines in read-only flows are expected. `describe-an-app` says that "Who sees it" is checked and "Changes with" is free text.
