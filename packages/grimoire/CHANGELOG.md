# Changelog — @warlock.js/grimoire

`@warlock.js/grimoire` is new in 5.55.0 and experimental: its file layout, `GR` codes and API may change in any release until it is marked stable.

## 5.55.0

### Added

- `parseGrimoire(root)` reads every agent-written file under `grimoire/`: features, changelogs, flows, version briefs, apps, layouts, pages, screens, blocks, tasks and releases. It keeps the file and line of each value, and reports a broken structure as a `GR1001`–`GR1028` finding instead of throwing. CRLF files, `*` bullets, tabs and tables without outer pipes are read too.
- `buildBook()` writes the book to `grimoire/book/`: one JSON entry per source file, an `index.md` summary per module, `app/routes.json`, the page list of each site and the screen list of each mobile app.
- `buildBook()` hashes a source file only when its size or modification time changed. A run with no changes calls no adapter and writes nothing.
- `buildBook()` caches route facts. It reads the routes again only when a routes file, something it imports, a config file or a mail, job, event or notification file changes, or when called with `routes: "fresh"`.
- `buildBook()` writes each file atomically, rewrites only the entries that changed and removes the entries of deleted files.
- `loadBook()` reads the book without an adapter.
- `features/<feature>/bookmap.json` lists the files a feature owns, the files it borrows, its routes, its pages per app and the files no flow reaches.
- `flows/<flow>.bookmap.json` lists the files behind each step, each criterion's tests with their last result, and the blocks that show the flow.
- `features/index.json` and `tasks/index.json` are rewritten only when their content changes.
- `openGrimoire()` loads the whole book in one call. Pass `write: false` to compute it in memory.
- `warlock grimoire check` reports names that point at nothing (routes, pages, mails, jobs, events, notifications, flows, apps and criteria), source files without a header or a feature, files no flow reaches, criteria without a test, `@proves` lines that name nothing, and README versions and dates that differ from the changelog.
- Findings on proposed work show as expected and never fail the check. Every `GR` code is listed in the docs.
- `warlock grimoire build` (with `--force`, and `--site [--out]` for a static site) writes the book.
- `warlock grimoire check` exits with 1 only on unexpected errors.
- `warlock grimoire release <version>` writes the changelog entries stamped with that version between the markers of `grimoire/releases/<version>.md`. It never changes a feature changelog or a version brief.
- `warlock scry` answers file, impact, route, feature, flow and search questions, with per-criterion test status for a flow. It prints compact text, or JSON with `--json`.
- The `grimoire_*` MCP tools answer the same questions as `warlock scry`.
- File questions never boot the app. `build` and `check` read the routes again only when they changed.
- `registerGrimoireCommands()` registers the commands. Add it to `cli: { commands: [...] }` in `warlock.config.ts`.
- `warlock explain GR2001` describes any Grimoire code.
- `createWarlockAdapter()` builds the book from the facts of `warlock inspect`.
- Task and release checks report the problems in `GR6001`–`GR6003` and `GR7001`–`GR7005`.
- The apps check (`GR5001`–`GR5009`) covers blocks, conditions, pages, layouts, screens, entry points, uncovered sites and mobile apps.
- Mobile screens are read from the Expo Router file names.
- `@warlock.js/grimoire/vitest` exports a Vitest reporter. It records the last result (pass, fail or skipped) of every test marked `// @proves <feature>/<flow> AC-n` in `grimoire/book/test-results.json`, and merges the results of partial runs.
- The reporter marks a result older than its test file as stale. `warlock grimoire check` reports failing (`GR4006`), stale (`GR4007`) and not-run (`GR4008`) criteria.
- A Grimoire tab for the devtools dashboard, registered with `panels: ["@warlock.js/grimoire/devtools"]`. It has one search box across flows, blocks, routes, files and tasks, and views for features, flows, pages, tasks, releases and the check report. It also shows small graphs of a file, a feature, a page and module coupling. It reads the cached book and never boots the app.
- `exportGrimoireSite()` writes the same tab as one static `index.html` for people without the app running.
- Six agent skills (`use-the-grimoire`, `write-a-feature`, `record-a-change`, `describe-an-app`, `document-a-file` and `backfill-a-grimoire`), a skills index, and a README that describes the install and which files Grimoire owns.
