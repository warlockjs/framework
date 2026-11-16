# Changelog — @warlock.js/grimoire

`@warlock.js/grimoire` is new in 5.55.0 and experimental: its file layout, `GR` codes and API may change in any release until it is marked stable.

## 5.55.0

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
