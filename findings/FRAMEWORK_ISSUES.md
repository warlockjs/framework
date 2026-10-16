# Warlock.js framework issues found while building Kazlak Care

Reported: 2026-10-14

App: Kazlak Care (a Warlock.js web app: API plus server-rendered React pages), built from `create-warlock@5.29.0`.

This file is written for the framework's maintainers and for AI coding agents that will fix the issues upstream. Each entry is self-contained: it names the package, the file and the function, and says how to reproduce the problem in a fresh `create-warlock` app. File paths inside packages are given relative to the package root as installed (`node_modules/@warlock.js/<pkg>/...`); the `esm/` files are the built output, so search the package source for the function name.

How the diagnoses were made: every root cause below was read in the installed package code. Where an entry says "root cause not confirmed", the cause was not found and what was checked is listed. Nothing was run to reproduce the problems in this pass except where an entry says so; "Found" tells where the app hit it.

## Environment

- OS: Windows 11 Pro (10.0.26300)
- Node: v24.15.0 (the app's test runner can use Node 22 through `KAZLAK_TEST_NODE`, see `scripts/test.mjs`; that only concerns Vitest workers, the app itself runs on 24.15)
- pnpm: 10.14.0
- `create-warlock`: 5.29.0 (the scaffold the app started from)

Installed framework packages:

| Package | Version |
| --- | --- |
| `@warlock.js/access` | 5.29.0 |
| `@warlock.js/auth` | 5.29.0 |
| `@warlock.js/cache` | 5.29.0 |
| `@warlock.js/cascade` | 5.29.0 |
| `@warlock.js/core` | 5.29.0 |
| `@warlock.js/devtools` | 5.29.0 |
| `@warlock.js/fs` | 5.29.0 |
| `@warlock.js/logger` | 5.29.0 |
| `@warlock.js/notifications` | 5.29.0 |
| `@warlock.js/scheduler` | 5.29.0 |
| `@warlock.js/seal` | 5.29.0 |
| `@warlock.js/web` | 5.29.0 |
| `@mongez/agent-kit` | 1.3.1 |
| `@mongez/http` | 3.5.1 |
| `@mongez/localization` | 3.5.1 |
| `@mongez/react-form` | 4.0.0 |
| `@mongez/react-localization` | 3.5.1 |
| `@mongez/reinforcements` | 4.0.2 |
| `@mongez/supportive-is` | 3.0.0 |
| `@mongez/vite` | 2.2.2 |

## Summary

Severity: high = wrong behaviour a user sees or a security gap; medium = developer-facing breakage with a workaround; low = noise or a papercut.

| Id | Title | Package | Severity | Found |
| --- | --- | --- | --- | --- |
| FW-01 | A 4xx error page (403, 400) renders but never hydrates | `@warlock.js/web` | high | 2026-10-10 |
| FW-02 | Dev and test servers never discover module `locales.json` files at boot | `@warlock.js/core` | medium | 2026-10-09 |
| FW-03 | Scaffolded root emits no viewport meta tag, so phones lay pages out at desktop width | `create-warlock` / `@warlock.js/web` | medium | 2026-10-09 |
| FW-04 | Framework log lines and cache keys carry recipient email addresses | `@warlock.js/core`, `@warlock.js/auth`, `@warlock.js/cache` | medium | 2026-10-09 |
| FW-05 | The HTTP test server never closes its loader `MessagePort`, so the Vitest main process cannot exit | `@warlock.js/core` | medium | 2026-10-09 |
| FW-06 | A quoted config key (for example an image variant named `machine-thumb`) breaks the generated `config.d.ts` | `@warlock.js/core` | medium | 2026-10-10 |
| FW-07 | After editing `.tsx` under `pnpm dev`, pages can answer 500 "useLocale() was called outside Warlock's LocaleProvider" until restart | `@warlock.js/web` | medium | 2026-10-10 |
| FW-08 | SSR renders a page component with no loader data (`data` undefined) | `@warlock.js/web` | medium | 2026-10-10 |
| FW-09 | The scaffolded `src/app/notifications` module falls short of the framework's own conventions | `create-warlock` / `@warlock.js/core` stubs | medium | 2026-10-12 |
| FW-10 | Generated image variants are cached on disk forever, even after the source file is deleted | `@warlock.js/core` | low | 2026-10-10 |
| FW-11 | The `/uploads` variant mechanism can only serve the default storage disk | `@warlock.js/core` | low | 2026-10-10 |
| FW-12 | `storage.use(name)` is typed as a contract that omits the directory operations the class has | `@warlock.js/core` | low | 2026-10-10 |
| FW-13 | The circular dependency detector reports a false cycle from a comment | `@warlock.js/core` | low | 2026-10-14 |
| FW-14 | The HTTP rate limiter cannot share its counts between processes without an ioredis client | `@warlock.js/core` | medium | 2026-10-14 |
| FW-15 | The production build rejects `import.meta.url` in test files and test helpers under `src/web` | `@warlock.js/web` | medium | 2026-10-14 |

## Status in 5.30.0

Each package's `CHANGELOG.md` (`## 5.30.0`) has the exact entries.

| Id | Status | What 5.30.0 ships |
| --- | --- | --- |
| FW-01 | Fixed | The client accepts 400–599 error-page payloads with `errors` and `errorCode`, so 4xx pages hydrate. |
| FW-02 | Fixed | Dev and test boot discovery includes `app/*/utils/locales.json`. |
| FW-03 | Fixed | `<Head />` renders a viewport tag by default (`metadata.viewport`, `false` to omit); scaffolded roots no longer need their own. |
| FW-04 | Fixed | Mail and cache logs mask addresses (`maskEmail` in `@warlock.js/logger`); the auth login throttle keys by a SHA-256 of the credential, which resets existing throttle counters once on upgrade. |
| FW-05 | Fixed | The loader port is unreferenced except while a sync waits, so Vitest exits. |
| FW-06 | Fixed | Config and storage-driver keys are read by name and written with `JSON.stringify` in `config.d.ts`. |
| FW-07 | Fixed (cause unconfirmed) | Locale, document and session contexts live in a `globalThis` registry, so a re-evaluated module reuses them. No reproduction was available. |
| FW-08 | Fixed | Covered by WR-016: an abandoned request throws `ClientDisconnectedError` before render. A regression test follows this entry's path. |
| FW-09 | Fixed | `warlock add notifications` writes a module that follows the conventions (resource, schema, typed request, service, locales, one controller per file). Clear-all and delete endpoints are no longer generated; existing modules are left alone. |
| FW-10 | Fixed | Variants are cached per source file and purged on delete, move and rewrite; `purgeImageVariants()` clears them. No size or age cap. |
| FW-11 | Fixed | `createUploadedFileController({ disk })` and `resolveImageVariant()`. |
| FW-12 | Fixed | `storage.use()` returns `ScopedStorage`. |
| FW-13 | Fixed | The import scan ignores comments and self-imports. |
| FW-14 | Fixed | `http.rateLimit.store: "cache"` shares counts through `@warlock.js/cache`; a custom store class is accepted. |
| FW-15 | Fixed | The page scan skips test files and folders, plus `build.testOnly` paths. |

---

## FW-01: A 4xx error page (403, 400) renders but never hydrates

### Package and version

`@warlock.js/web` 5.29.0.

### Found

2026-10-10. Phase 2 (a 403 from the app's `requirePagePermission` page guard) and Phase 3 (an invalid validated page query such as `/machines/new?code=<201 characters>` and `/vendors?limit=99999`, which answer 400). The two reports share one root cause, so they are one entry.

### Symptom

The server answers the right status (403 or 400) and renders the app's error page, but in the browser the page never becomes interactive and the console shows:

```
Warlock hydration payload was found at #__WARLOCK_DATA__ but could not be read.
```

### Steps to reproduce

1. Create an app with `create-warlock`, with the web stack and an `error.page.tsx`.
2. Add a page whose loader (or page middleware) throws a core `HttpError` with a 4xx status, for example `throw new ForbiddenError()` from `@warlock.js/core`. For the 400 variant, give a page `config.validation` (or the validation option your version uses for the page query) and open it with an invalid query value.
3. Open the page in a browser, first through a full document load.
4. The error page is visible, the response status is 403 (or 400), and the console shows the message above. Client-side scripts on the error page do not run.

### Expected

A 4xx error page hydrates like a 5xx one. The server already renders it with the app's error page and the real status.

### Root cause

The server and the client disagree on which statuses an error page can carry.

Server: `esm/server/render-page.mjs`, function `renderErrorPage` (inside `renderPage`), builds the props as `status: currentError?.statusCode ?? 500` and `hydrationErrorPageProps(...)` (`esm/server/error-page.mjs`) copies that status into `bundle.errorPage`, which `buildHydrationPayload` (`esm/server/build-hydration-payload.mjs`) writes into the payload. In `esm/server/execute-page-request.mjs` a thrown `HttpError` below 500 and a failed page validation (`buildErrorRecord(new PageValidationFailedError(...), ..., 400, ...)`) both produce an error record with a 4xx status, so a 4xx `errorPage.status` is sent.

Client: `esm/hydration-payload.mjs`, function `requireErrorPagePayload`, rejects it:

```js
if (typeof errorPage.status !== "number" || !Number.isInteger(errorPage.status)
    || errorPage.status < 500 || errorPage.status > 599) malformedPayload();
```

`isHydrationPayload` returns false, and `readHydrationPayload` (called by `esm/client/hydrate-page.mjs`) throws the "could not be read" error. The doc comment on `readHydrationPayload` says "and a 5xx", so the 500-599 limit looks deliberate, but it contradicts what the server sends for 4xx. `resolveThrownHttpStatus` in `esm/server/resolve-thrown-http-status.mjs` documents the accepted range as 400-599.

The same function guards client-side navigation payloads (`esm/client/navigation/fetch-page-data.mjs` calls `isHydrationPayload`), so a client navigation to such a page is rejected too.

### Suggested fix

Accept 400 to 599 in `requireErrorPagePayload` (change the bounds to `< 400 || > 599`), and update the doc comment on `readHydrationPayload`. Add a test that renders a page whose loader throws a 403 and a page with an invalid validated query, and hydrates the resulting payload. Alternatively, if 4xx pages must stay non-hydrating, mark them with `markNonHydrating` on the server side so no console error is raised; accepting 400 to 599 is the simpler fix.

### Workaround in this app

None. The error pages for 403 and 400 stay non-interactive. The app only links to them from pages the member cannot use, so the cost is small. Tracked in `docs/phases/phase-2.md` and `docs/phases/phase-3.md` follow-ups.


### Seen again

2026-10-14, still present: every 403 page logs "Warlock hydration payload was found at #__WARLOCK_DATA__ but could not be read" twice (for example `/members` or `/qr-codes` as a member without the view permission). The client gate `requireErrorPagePayload` (`esm/hydration-payload.mjs`) also rejects any key on `error` other than `name`, `message`, `stack`, so a 422 `PageValidationFailedError` payload (`errors`) and a production error (`errorCode`) would fail it too, even with the status range widened.

---

## FW-02: Dev and test servers never discover module `locales.json` files at boot

### Package and version

`@warlock.js/core` 5.29.0.

### Found

2026-10-09, while wiring translations for the first modules. Recorded in `docs/PROJECT_BRIEF.md` section 8 (decisions log, 2026-10-09).

### Symptom

Every `t("module.key")` call prints its raw key (for example `members.errors.notFound`) until someone edits the `locales.json` file, which makes the file watcher register it. The same happens in Vitest through `startHttpTestServer`, which reuses the dev server's file discovery.

### Steps to reproduce

1. In a fresh `create-warlock` app, run `warlock generate` for a module (the module generator creates `src/app/<module>/utils/locales.json` containing `{}`) or add `src/app/posts/utils/locales.json` with `{ "title": { "en": "Posts", "ar": "..." } }`.
2. Call `t("posts.title")` from a controller or route and start `pnpm dev`.
3. The response contains the raw key `posts.title`. Touch and save `locales.json` while the server runs: the key now resolves.

### Expected

Module dictionaries found under `src/app/<module>/utils/locales.json` are registered at boot, as `DevelopmentServer.start` and the module loader already intend (`ModuleLoader.loadModule` handles `type === "locale"` JSON files).

### Root cause

`esm/dev-server/utils.mjs`, function `getFilesFromDirectory`, globs `**/*.{ts,tsx}` by default:

```js
async function getFilesFromDirectory(directoryPath = srcPath(), pattern = "**/*.{ts,tsx}") {
```

`FilesOrchestrator.getAllFilesFromFilesystem` (`esm/dev-server/files-orchestrator.mjs`) calls it with no pattern, so the boot file set never contains `.json` files. The loader side is ready: `esm/dev-server/module-loader.mjs`, `loadModule`, registers a `locale` file ending in `.json` through `registerLocaleDictionary`, and `esm/dev-server/special-file-patterns.mjs` has `isLocaleFile` matching `locales.(ts|tsx|json)`. The type generator even finds the files separately (`type-generator.mjs` globs `**/utils/locales.json`). Only the boot discovery misses them. Edits are picked up later because the file watcher reports them as changes.

### Suggested fix

Include `src/app/**/utils/locales.json` (and the route-level locale files `isRouteLocalesJsonPath` knows about) in the boot file set, for example by widening the glob in `getAllFilesFromFilesystem` to `**/*.{ts,tsx}` plus `app/*/utils/locales.json`, and make sure the manifest path (when a manifest exists) records them too. Add a test that boots the dev server and the test server in a project whose only dictionary is a JSON file and asserts that `t()` resolves.

### Workaround in this app

`src/app/shared/utils/register-module-locales.ts` (`registerModuleLocales`) reads every `utils/locales.json` and calls `registerLocaleDictionary`. It is called from `src/app/main.ts` and, for the test workers, from `src/test-setup.ts` (`await import("app/main")`); the CLI commands call it themselves.

---

## FW-03: Scaffolded root emits no viewport meta tag, so phones lay pages out at desktop width

### Package and version

`create-warlock` 5.29.0 (scaffold) with `@warlock.js/web` 5.29.0 (document rendering).

### Found

2026-10-09, in the first mobile check. The initial commit's `src/web/root.tsx` (commit `5b07971`) has no viewport tag.

### Symptom

On a phone the page is drawn at a desktop viewport width and shrunk, so responsive CSS (media queries, `sm:` utilities) never applies.

### Steps to reproduce

1. `create-warlock` a web app, run `pnpm dev`.
2. Open the home page with a phone or with a mobile device emulator.
3. View the document source: `<head>` has no `<meta name="viewport" ...>`.

### Expected

A new app is mobile-ready: either the framework emits `<meta name="viewport" content="width=device-width, initial-scale=1">` through `<Head />`, or the scaffolded `root.tsx` contains it.

### Root cause

The scaffolded `src/web/root.tsx` only renders `<Head />` and the `#vessel` mount point. In the `@warlock.js/web` package the only viewport tag is in the built-in not-found page (`esm/server/not-found-page.mjs`, line 153). The metadata system (`esm/metadata.mjs`, resolved in `resolvePageMetadata`) has no default for it, and `<Head />` does not add it. So neither the framework nor the scaffold supplies it. This is a gap, not a coding bug.

### Suggested fix

Add the viewport tag to the scaffolded `root.tsx` template (the `write-the-root` skill text should show it), or emit it by default from `<Head />` with an opt-out in the metadata API.

### Workaround in this app

`src/web/root.tsx` adds the `<meta name="viewport" ...>` tag by hand, with a comment saying the framework does not emit one.

---

## FW-04: Framework log lines and cache keys carry recipient email addresses

### Package and version

`@warlock.js/core` 5.29.0 (mail), `@warlock.js/auth` 5.29.0 (login throttle), `@warlock.js/cache` 5.29.0 (cache driver logging).

### Found

2026-10-09, reviewing log output during the auth work.

### Symptom

Two separate leaks of personal data into the log:

1. Every sent mail logs `Sending mail to: member@example.com` at info level.
2. The login throttle builds cache keys such as `email.member@example.com`, and the cache driver logs every key it touches (`<key> ...`), so the address reaches the logs again.

### Steps to reproduce

1. In a fresh app with the default log channel, call `sendMail({ to: "someone@example.com", ... })` and read the console: the info line `[mail.smtp][send] Sending mail to: someone@example.com` appears.
2. Mount `loginThrottleMiddleware` from `@warlock.js/auth` on a login route, post a wrong password for an email, and watch the log: the cache driver prints the key `email.<the address lower-cased>` for each get and set.

### Expected

Log lines do not contain addresses, or the address is masked, or the key is hashed before it is used as a cache key. A log redaction config by key name (`log.configure({ redact })`) cannot help here because the address sits inside the message text and inside the key.

### Root cause

- `@warlock.js/core`, `esm/mail/send-mail.mjs`, function `sendMail`: `log.info(\`mail.${driver}\`, "send", \`Sending mail to: ${normalized.to.join(", ")}\`);`
- `@warlock.js/auth`, `esm/middleware/login-throttle.middleware.mjs`, function `buildDefaultIdentifiers`: `identifiers.push(\`email.${value.toLowerCase()}\`)`.
- `@warlock.js/cache`, `esm/drivers/base-cache-driver.mjs`, method `log(operation, key)`: prints the key in the message, and `shouldLog` defaults to `true` (set in the constructor).

### Suggested fix

Do not put the recipient in the mail log message (log the count, or a masked form such as `m***@example.com`). Hash the credential in `buildDefaultIdentifiers` (SHA-256 of the lower-cased value) so the key is safe by default, and have the cache driver log hashed or truncated keys, or default `shouldLog` to off outside development.

### Workaround in this app

- Mail: `src/config/log.ts` adds a `filter` to the console channel that drops `mail.*` entries that are not errors.
- Throttle: `src/app/auth/utils/auth-rate-limits.ts` (`accountIdentifier`) passes a custom identifier extractor that hashes the email, so the key is `email.<sha256>`.

---

## FW-05: The HTTP test server never closes its loader `MessagePort`, so the Vitest main process cannot exit

### Package and version

`@warlock.js/core` 5.29.0.

### Found

2026-10-09, when the first HTTP test lane finished.

### Symptom

After all specs pass and `stopHttpTestServer` has run, Vitest hangs and reports `close timed out ... something prevents Vite server from exiting`.

### Steps to reproduce

1. In a fresh app with the test feature, write a spec that calls `startHttpTestServer()` (or uses `setupTest`) and then `stopHttpTestServer()` / `teardownTest()`.
2. Run it with `vitest run`. The tests pass but the process stays alive until Vitest's close timeout fires.

### Expected

`teardownTest()` leaves nothing referenced that keeps the event loop alive.

### Root cause

`esm/dev-server/loader/register-loader.mjs`, function `registerLoader`, creates `const { port1, port2 } = new MessageChannel()`, registers the hook thread with `port2` and returns `port1`. `FilesOrchestrator.init()` (`esm/dev-server/files-orchestrator.mjs`) attaches `this.loaderPort.on("message", ...)`, which keeps `port1` referenced. Nothing in `esm/tests/start-http-development-server.mjs` (`stopHttpTestServer`) or `esm/tests/vitest-setup.mjs` (`teardownTest`) closes or `unref()`s that port (a search for `loaderPort` with `close` or `unref` finds nothing).

### Suggested fix

Add a `close()` (or `dispose()`) to `FilesOrchestrator` that calls `this.loaderPort.close()` (or at least `unref()`s it), and call it from `stopHttpTestServer`. Do the same for any other `register()` call made by the test bootstrap.

### Workaround in this app

`src/app/shared/testing/bootstrap/track-message-ports.ts` records the `MessagePort` handles that exist before boot and `unref()`s the new ones after teardown (it uses the undocumented `process._getActiveHandles`). It is called from `src/test-global-setup.server.ts`.

---

## FW-06: A quoted config key (for example an image variant named `machine-thumb`) breaks the generated `config.d.ts`

### Package and version

`@warlock.js/core` 5.29.0.

### Found

2026-10-10, while adding a thumbnail variant for machine photos (Phase 3). The app then renamed the variant to `machineThumb`.

### Symptom

With `"machine-thumb": { ... }` under `images.variants` in `src/config/uploads.ts`, `.warlock/typings/config.d.ts` is written with a broken `ConfigKeyRegistry` line, and `pnpm tsc` and the editor report syntax errors in the generated file. (Derived from the code below; the broken output itself was not reproduced in this pass because the app no longer has a hyphenated key.)

### Steps to reproduce

1. In a fresh app, edit `src/config/uploads.ts`:
   ```ts
   const uploadsConfigurations: UploadsConfigurations = {
     images: { variants: { "machine-thumb": { width: 480, height: 480, fit: "inside" } }, formats: ["webp"] },
   };
   ```
2. Run `pnpm dev` or `warlock generate.typings`.
3. Open `.warlock/typings/config.d.ts`. The key line reads `"uploads.images.variants."machine-thumb"": true;`, which is not valid TypeScript.

### Expected

`"uploads.images.variants.machine-thumb": true;`

### Root cause

`esm/dev-server/type-generator.mjs`, method `extractConfigInfo`, inner function `visitKeys`:

```js
const keyName = prop.name.getText(sourceFile);
const fullKey = prefix ? `${prefix}.${keyName}` : keyName;
```

`getText()` returns the property name as written, quotes included, for a string-literal key (`"machine-thumb"` or `'machine-thumb'`). `writeConfigTypesFromCache` then writes each key inside double quotes (`"${key}": true;`), so the quotes nest. A single-quoted key yields a wrong key (`...variants.'machine-thumb'`) instead of a syntax error. The same file already has the right helper for the other registry: `toInterfaceKey` (used for `ConfigRegistry`), and `esm/dev-server/extract-translation-keys.mjs` has `getPropertyName`, which uses `.text` for identifiers, string literals and numeric literals.

### Suggested fix

Replace `prop.name.getText(sourceFile)` with a property-name reader that returns `name.text` for `Identifier`, `StringLiteral`, `NumericLiteral` and `NoSubstitutionTemplateLiteral`, skips computed names it cannot resolve, and escape the final key with `JSON.stringify(key)` when writing. Add a test with a hyphenated, a single-quoted and a numeric key.

### Workaround in this app

The variant is named `machineThumb` in `src/config/uploads.ts` (camelCase, no quotes needed).

---

## FW-07: After editing `.tsx` under `pnpm dev`, pages can answer 500 "useLocale() was called outside Warlock's LocaleProvider" until restart

### Package and version

`@warlock.js/web` 5.29.0.

### Found

2026-10-10, during Phase 3 development with the dev server running while page and component files were edited.

### Symptom

After some edits, requests answer 500 and the server log shows:

```
useLocale() was called outside Warlock's LocaleProvider. Render the component through the @warlock.js/web page pipeline.
```

Restarting `pnpm dev` clears it. The page and the edited file are otherwise correct.

### Steps to reproduce

Not reliably reproduced. It appeared after edits to `.tsx` files that were imported by a page (components and hooks) while the server kept running. Suggested attempt: in a fresh app, make a page component that calls `useLocale()` through a shared hook, load the page, then edit the hook file and the component in quick succession and reload.

### Expected

Hot reload keeps one `LocaleContext` shared by `LocaleProvider` and `useLocale`.

### Root cause

Root cause not confirmed. What was checked:

- The error text is thrown in `esm/localization.mjs`, `useLocale` and `useTrans`, when `useContext(LocaleContext)` returns `undefined`. `LocaleContext` is a module-level `createContext` in that file, and `LocaleProvider` in the same file provides it.
- That symptom needs `LocaleProvider` and `useLocale` to use two different instances of `esm/localization.mjs` (or the component to render outside the provider). `esm/vite/dev-server-config.mjs` already documents and works around a two-instance problem for `@warlock.js/web` in SSR (`ssr.noExternal: WARLOCK_FAMILY_INLINE_PACKAGES`, `resolve.dedupe` for React, `optimizeDeps.exclude: ["@warlock.js/web"]`).
- Hypothesis, not verified: when a `.tsx` module is invalidated in Vite's SSR module graph, a dependent chain can re-evaluate `localization.mjs` (or the file that holds the provider) in one place and keep the old copy in another, so the context identity differs. Look at how `installPageRoutes` (`esm/server/install-page-routes.mjs`) invalidates modules in the Vite module graph and whether `@warlock.js/web`'s own modules are ever invalidated or re-imported.

### Suggested fix

Not known. First add a reproduction: a dev-server test that edits a component in a running Vite SSR instance and re-renders. Then make sure framework modules that own React contexts (`localization.mjs` and the other `*-context` modules) are never invalidated or re-evaluated by an app file change, or hold the contexts on `globalThis` keyed by a symbol so a second evaluation reuses the first.

### Workaround in this app

Restart `pnpm dev`. None in code.

---

## FW-08: SSR renders a page component with no loader data (`data` undefined)

### Package and version

`@warlock.js/web` 5.29.0.

### Found

2026-10-10 (once in Phase 4, right after signing in) and 2026-10-12 (a burst in Phase 6 while files were being edited under the dev server). One entry because the symptom is the same.

### Symptom

The page component is rendered on the server with `data` undefined, and the render throws:

- `/maintenances`: `Cannot destructure property 'create' of 'data'` (the page does `const { create } = data;`)
- `/reports`: `Cannot read properties of undefined (reading 'filters')`

The first happened as a sign-in redirect and a navigation crossed (the browser started a second navigation before the first finished). The second came in a burst of 500s while files were saved. Neither could be reproduced afterwards.

### Steps to reproduce

Not reproduced in this pass. A likely route, to be confirmed by a test: request a page route with a loader and abort the request (close the connection, or start a second navigation) after the layout loaders have run but before the page loader starts. A page that destructures `data` immediately will throw.

### Expected

A request whose connection is gone, or whose loaders did not finish, never renders the page component. It should stop (no response needed) or answer an error page.

### Root cause

Probable cause, found in code, not confirmed by a reproduction. In `esm/server/execute-page-request.mjs`, function `executePageRequest`, the loader loop does:

```js
for (const [index, level] of LEVEL_ORDER.entries()) {
  if (signal) break;
  if (requestAbortController.signal.aborted) {
    if (loaderTimedOut && !signal) signal = { kind: "throw", ... PageLoaderTimeoutError ... };
    break;
  }
  ...
}
```

When the request is aborted for a reason other than the loader timeout (the client disconnected or navigated away), the loop leaves with no `signal`. Further down, `const discarded = requestAbortController.signal.aborted && !loaderTimedOut;` only sets `committedLevels = []`. No short circuit is recorded and no error is set, so execution continues to `finish(bundle)` and then `finishRender` in `esm/server/render-page.mjs`, which renders the page element with `data: bundle.pageData`, which is still `undefined` because the page loader never ran. A search of `render-page.mjs` finds no `aborted` check before the synchronous render. This fits both reports: a crossed redirect and navigation aborts one request, and a burst while editing aborts requests in flight when the dev server restarts or rebuilds.

### Suggested fix

After the loader loop, if the request was aborted and not timed out, return a discarded result without rendering (for example set `bundle.shortCircuit = { stage: "loaders", kind: "aborted", ... }` or return early from `finishRender`). Also make `finishRender` refuse to render a page whose loader level was not committed (`committedLevels` does not include `"page"` while `pageData` is undefined) and answer the error page instead of calling the component. Add a test that aborts a request between loader levels.

### Workaround in this app

None. The failures are harmless in the browser (the aborted request has no reader) but they pollute the dev log. Tracked in `docs/phases/phase-4.md` and `docs/phases/phase-6.md` follow-ups.

---

## FW-09: The scaffolded `src/app/notifications` module falls short of the framework's own conventions

### Package and version

`create-warlock` 5.29.0. The files come from the notifications stubs in `@warlock.js/core` 5.29.0 (`esm/generations/stubs.mjs`, the `notificationsConfigStub`, model, migration, routes and controller stubs). The notification primitives themselves are `@warlock.js/notifications` 5.29.0.

### Found

2026-10-12, when Phase 5 planning (`docs/phases/phase-5.md`, decision 8) found the module to be demo code. The files are unchanged from the initial commit `5b07971`.

### Symptom

The generated module works as a demo but breaks the conventions that the framework's own skills and the project skills describe, so every app has to rewrite it before it can ship.

### Steps to reproduce

Run `create-warlock` with notifications selected (or `warlock add notifications`) and read `src/app/notifications`.

### Expected

Generated code follows the conventions of the skills shipped with the framework (`warlock-js-core`, `warlock-js-notifications`) and of a normal module.

### Root cause

What the scaffold generates, concretely (read in `src/app/notifications`, which matches the stub text in `esm/generations/stubs.mjs`):

1. No authorization beyond sign-in. `routes.ts` wraps the group in `authMiddleware([])` and has no permission or ability check. The scaffold also ships six endpoints, including `DELETE /notifications` (clear all) and `DELETE /notifications/:id`, which most apps do not want.
2. List input is not validated. `listNotificationsController` passes `request.all()` straight into `inApp.list(...)`, with no query schema (no capped `limit`, no whitelist). The `warlock-js-core` skill (`create-controller.md`) lists `request.all()` as the pass-the-whole-input anti-pattern, and the project API skill requires a seal schema plus `request.validated()`.
3. Controllers are loose handlers typed as bare `RequestHandler`, with ids read through `request.input("id")` (untyped), and a hand-written `recipientId(user: unknown)` helper that narrows `unknown` at runtime and throws a plain `Error`. The framework's own typed pattern (`RequestHandler<Request<Schema>>` and a guarded request type that guarantees `request.locals.user`) is not used.
4. Routes are registered one by one with `router.get/patch/delete` instead of the RESTful `router.route()` builder the core skill documents.
5. No resource. The controllers return whatever `inApp.list/find` return (model instances), so the response shape is decided by the model and not by a `defineResource` output gate.
6. One controller file holding six exports, no `services/`, `schema/`, `resources/`, `types/` or `errors/` folders, while the module convention is one responsibility per file.
7. The model sits at the module root (`notification.model.ts`) and the migration at `migrations/`, while the module layout is `models/<noun>/`. The model schema declares `user_id: v.string()`, which has to be changed when the app's ids are not strings of that kind.
8. No `utils/locales.json`, no `*.spec.ts` for any controller, although the testing skill makes a spec per controller mandatory when tests are enabled.

### Suggested fix

Generate a smaller, convention-following module: list, unread count, mark read and mark all read only; a seal query schema for the list; typed guarded controllers using `request.validated()`; a `defineResource` output; services under `services/`; routes through `router.route()`; an empty `locales.json`; one spec per controller; and a commented-out hook for a permission gate. Or keep the demo module but print "demo code, replace before shipping" at the top of each file and move it behind a flag.

### Workaround in this app

`docs/phases/phase-5.md` decision 8 rebuilds the module to the project standards and keeps only list, unread count, mark read and mark all read (planned; the module in `src/app/notifications` is still the unchanged scaffold at the time of this report).

---

## FW-10: Generated image variants are cached on disk forever, even after the source file is deleted

### Package and version

`@warlock.js/core` 5.29.0.

### Found

2026-10-10. Phase 3 follow-ups and the decisions log (the framework caches generated variants and does not evict them).

### Symptom

After a photo is deleted (through `storage.delete` or by removing the file), its derivatives remain under `storage/uploads/.cache/image-variants`, so the cache grows without bound over the life of the app.

### Steps to reproduce

1. Configure `uploads.images.variants` and serve a file through `uploadedFileController` at `/uploads/*`.
2. Request `/uploads/a.webp?variant=thumb&format=webp`; a file appears in `.cache/image-variants`.
3. Delete `a.webp` from storage. The cached derivative stays.

### Expected

Either the cache is bounded (size or age eviction) or a deleted source's variants can be purged.

### Root cause

`esm/http/uploads/uploaded-file.controller.mjs` writes each derivative to `variantCachePath(images.cacheDirectory, hash, format)`, where `hash = variantCacheKey({ relativePath, sourceSize, sourceMtimeMs, variant, format })` (`esm/http/uploads/variant-cache-key.mjs`). The name is a SHA-256 of the source path, size, mtime, variant and format: an app can recompute it only while the source file still exists (and only by copying the private algorithm, which is not exported); once the source is gone nothing maps it back to its derivatives, and no code in `esm/http/uploads/` or the storage drivers deletes anything from the cache directory (a search of the uploads folder finds no eviction, prune or unlink of cached variants). A changed source (new size or mtime) also leaves the old derivative behind.

### Suggested fix

Add a bounded cache (max total bytes and/or max age, pruned lazily on write or by a scheduler job), and make the storage `delete` of a file purge its variants (store derivatives under a directory derived from a hash of the source path so the directory can be removed). Expose a `purgeImageVariants(relativePath?)` helper.

### Workaround in this app

None yet. A purge is listed as a follow-up in `docs/phases/phase-3.md`.

Update 2026-10-14: the app now deletes a machine photo’s cached variants just before it deletes the photo, by recomputing `variantCacheKey` for every configured variant and format (`src/app/machines/utils/machine-photo-variant-cache-files.ts`, a copy of the 5.29 algorithm pinned by a spec). It breaks silently if the framework changes the key. Exporting `variantCacheKey`, or a `purgeImageVariants(path)` helper, would make it safe; a source rewritten in place still leaves its old variants.

---

## FW-11: The `/uploads` variant mechanism can only serve the default storage disk

### Package and version

`@warlock.js/core` 5.29.0.

### Found

2026-10-10. Decision "Private storage and serving" in `docs/PROJECT_BRIEF.md` section 8.

### Symptom

Image variants (`?variant=name`) work only for files under the default disk's root. A file on a second local disk, for example a private disk for invoices, cannot have variants generated through the framework, and cannot be served by `uploadedFileController` at all.

### Steps to reproduce

1. Register a second local disk in `src/config/storage.ts` with a different root.
2. Store an image there with `storage.use("private").put(...)`.
3. There is no route or option that serves variants for it. `uploadedFileController` only resolves paths against `storage.root()`.

### Expected

A documented way to generate and serve a variant for any local disk, or a public function (`generateImageVariant` for a given disk path) that an authenticated route can use.

### Root cause

`esm/http/uploads/uploaded-file.controller.mjs`: `const storageRoot = storage.root();` and every later step (`resolveUploadPath`, `resolveVariantCandidate`) resolves against that one root. There is no disk parameter. The generation function `generateImageVariants` is exported from the package index, but the cache key and directory logic live inside the controller, so an app cannot reuse them.

### Suggested fix

Let the controller take a disk (a route-level option such as `uploadedFileController({ disk })`) and export the variant resolution as a function that takes a disk and a path, so apps can serve private disks from their own authenticated routes.

### Workaround in this app

None needed so far: private attachments are read through the authenticated API route (`GET /api/maintenances/:id/attachments/:attachmentId`) with the stored bytes, and no variants are generated for them.

---

## FW-12: `storage.use(name)` is typed as a contract that omits the directory operations the class has

### Package and version

`@warlock.js/core` 5.29.0.

### Found

2026-10-10, when the attachment cleanup needed `deleteDirectory`.

### Symptom

`storage.use("private").deleteDirectory(...)` does not type-check: the property does not exist on `ScopedStorageContract`, although the object returned at runtime is a `ScopedStorage` instance that has it.

### Steps to reproduce

```ts
import { storage } from "@warlock.js/core";
await storage.use("private").deleteDirectory("some/dir"); // TS2339
```

### Expected

`storage.use()` returns a type that includes the methods the class has, or the contract includes them.

### Root cause

`esm/storage/storage.d.mts`: `use(name: StorageDriverName): ScopedStorageContract;`. `ScopedStorageContract` (`esm/storage/types.d.mts`) lists `put putFromPath putIfAbsent supportsPutIfAbsent putStream putDirectory get getStream delete deleteMany exists url temporaryUrl metadata size copy move list file`. The class `ScopedStorage` (`esm/storage/scoped-storage.d.mts`) additionally has `putFromUrl`, `deleteDirectory`, `copyDirectory`, `moveDirectory`, `emptyDirectory`, `prepend` and `append`.

### Suggested fix

Return `ScopedStorage` from `use()`, or add the missing methods to `ScopedStorageContract`.

### Workaround in this app

`src/app/shared/utils/private-storage.ts` casts the result: `storage.use(PRIVATE_STORAGE_DISK) as ScopedStorage`.

---

## FW-13: The circular dependency detector reports a false cycle from a comment

### Package and version

`@warlock.js/core` 5.29.0.

### Found

2026-10-14. `warlock generate.typings` (run by `pnpm tsc`) prints:

```
Circular Dependencies Detected
Found 1 circular dependency chain
  1. Cycle with 1 files:
     src/web/shared/testing/query-testing.ts → itself
```

### Symptom

A warning about a cycle that does not exist. The file `src/web/shared/testing/query-testing.ts` has no import statements at all. Its only match is a JSDoc comment on line 9:

```ts
 *   (await import("../../shared/testing/query-testing")).queryParamModuleMock(),
```

### Steps to reproduce

1. In a fresh app, create `src/web/example.ts` that has no real `import` and whose doc comment contains `(await import("./example"))`.
2. Run `warlock generate.typings`, or `pnpm dev`.
3. The warning above appears for `src/web/example.ts`.

### Expected

Comments are ignored; no warning.

### Root cause

`esm/dev-server/parse-imports.mjs`, function `parseImports`:

```js
const [imports] = await parse(source);               // es-module-lexer
if (imports && imports.length > 0) return await resolveImports(imports, source, filePath);
...
const regexImports = extractImportPathsWithRegex(source);   // fallback
```

`es-module-lexer` correctly ignores comments, but a file with no real imports returns an empty list, so the code falls through to `extractImportPathsWithRegex`, which runs regular expressions (`dynamicImportPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g` and the others) over the raw source, comments included. The relative path in the comment resolves to the file itself, `DependencyGraph` (`esm/dev-server/dependency-graph.mjs`, `detectCircularDependencies` and `isRuntimeCycle`) sees a runtime self edge, and prints the warning. The fallback should only run when the lexer throws, not when it finds nothing.

### Suggested fix

In `parseImports`, return the lexer result (even an empty map) when `parse` succeeds, and use the regex path only in the `catch`. If the regex path stays, strip comments first (the file already does that in `isTypeOnlyFile`). Ignore edges from a file to itself.

### Workaround in this app

None. The comment can be reworded to avoid the `import("...")` text, but the app keeps the example.

---

## FW-14: The HTTP rate limiter cannot share its counts between processes without an ioredis client

### Package and version

`@warlock.js/core` 5.29.0 (and `@warlock.js/cache` 5.29.0 for the client mismatch).

### Found

2026-10-14, while hardening the app for deployment: the app wanted its per-IP limits to hold when it runs as more than one process, reusing the Redis connection the cache can be configured with.

### Symptom

With N processes behind a load balancer, every IP gets N times the configured limit, because each process counts in its own memory. There is no supported way to point the limiter at the cache's Redis connection.

### Steps to reproduce

1. In a fresh app, set `http.rateLimit` to `{ max: 5, duration: 60_000 }`.
2. Start two instances of the app behind a round-robin proxy.
3. Send ten requests from one IP: all ten pass.

### Expected

A documented option to share the counts, ideally reusing the connection `@warlock.js/cache` already manages when its driver is Redis.

### Root cause

`esm/http/build-rate-limit-options.mjs`, function `buildRateLimitOptions`, copies only the keys listed in `passthroughKeys`. Among them is `redis`, which `@fastify/rate-limit` hands to its `RedisStore`; that store calls ioredis-only APIs (`defineCommand`), so it needs an **ioredis** client. The Redis driver of `@warlock.js/cache` uses the `redis` (node-redis) package, so its connection cannot be passed. There is no `store` key in `passthroughKeys`, so a custom store cannot be supplied either. The per-route limit (`middleware.rateLimit` on a route) is documented in the core skill as always in-process.

```js
const passthroughKeys = ["redis", "nameSpace", "keyGenerator", /* ... */ "addHeadersOnExceeding"];
```

### Suggested fix

Either add `store` to `passthroughKeys` and ship a small store backed by the cache package (so whatever cache driver is configured also backs the limiter, per-route limits included), or document that `rateLimit.redis` needs an ioredis client and list `ioredis` as an optional peer dependency. Make the per-route limit use the same store.

### Workaround in this app

None. The limits stay per process; `src/config/http.ts` says so in a comment, and the deployment notes run a single process.

---

## FW-15: The production build rejects `import.meta.url` in test files and test helpers under `src/web`

### Package and version

`@warlock.js/web` 5.29.0.

### Found

2026-10-14, running `pnpm build` before release. A test-only helper, `src/web/shared/testing/count-queries.ts` (imported only by `*.spec.tsx` files), failed the whole production build.

### Symptom

```
✖ build failed
Build contribution "web" failed during generate: Cannot build the page graph: "src/web/shared/testing/count-queries.ts" uses `import.meta.url`, whose meaning changes under the bundled server build (import.meta.url). Pages are compiled into the server bundle ...
```

The file is never part of the page graph: no page, layout or component imports it. `pnpm dev` and the test suite are not affected, so the failure appears only at release time.

### Steps to reproduce

1. In a fresh app, add `src/web/shared/testing/helper.ts` containing `export const here = import.meta.url;`, imported only by a `*.spec.tsx` file (or by nothing).
2. Run `pnpm build`.
3. The build fails with the error above.

### Expected

The check runs on files the page graph actually imports, or at least skips test files (`*.spec.*`, `*.test.*`) and folders a project marks as test-only, so test code under `src/web` can use `import.meta.url` like test code anywhere else.

### Root cause

`esm/build/generate-pages-barrel.mjs`, function `assertNoViteOnlyImports`, walks **every** `.ts` / `.tsx` file under each web root (`walkFiles(webRoot, ...)`) and throws on the first that contains `import.meta.url`. Its own comment calls it "a FILE-LEVEL scan ... not transitive resolution". There is no exclusion for spec files or test helpers, so a spec file that uses `import.meta.url` fails the build too.

```js
const sources = walkFiles(webRoot, (fileName) => fileName.endsWith(".ts") || fileName.endsWith(".tsx"));
// ...
if (source.includes("import.meta.url")) throw new WebPageGraphUnsupportedImportError(/* ... */);
```

### Suggested fix

Skip `*.spec.*` / `*.test.*` files and a configurable list of test-only folders in the scan, or run the scan over the files esbuild's metafile reports as part of the server bundle instead of over the whole folder.

### Workaround in this app

`count-queries.ts` resolves `@warlock.js/cascade` from `path.join(process.cwd(), "package.json")` instead of `import.meta.url`. `import.meta.dirname` is not checked by the scan and still works in the other test helpers.

---

## Not framework, for reference

- Node 24.15 on Windows kills about one Vitest worker in four runs with exit code `0xC0000409` and no message. This is a Node runtime fault (measured clean on Node 22.16), handled in `scripts/test.mjs` with `KAZLAK_TEST_NODE`. The retry loop in `src/app/shared/testing/bootstrap/migrate-test-database.ts` (the `warlock migrate` CLI occasionally dying on Windows with a fast-fail exit code) uses the same exit code, so it is very likely the same Node problem and not a Warlock defect. Not confirmed in the CLI code.
- The npm "Unknown env config" warnings.
- `?locale=ar` on a page address is not remembered on the next hard navigation (`docs/phases/toasts.md`). This is documented, deliberate framework behaviour, not a defect. `@warlock.js/web`, `esm/server/page-route-handler/persist-requested-locale.mjs`, states that `?locale=` is persisted only for client data requests and "a full document load with the same `?locale=` param never calls this". The app's header language switch uses `changeLocaleCode`, which persists. A mixed-language page after a hard load with `?locale=` followed by a client navigation is the consequence; the app should either not link with `?locale=` or use the switch. If the framework owner wants to reduce the surprise, a document load with `?locale=` could set the cookie, but that is a design change, not a bug fix.
- `src/app/activity-logs/utils/actor-storage.ts` builds its own `AsyncLocalStorage` because `@warlock.js/context` is not importable under pnpm's strict layout (it is a transitive dependency of `@warlock.js/core`). An app decision: the app can add the package as a direct dependency. The framework could re-export its context helpers from core, but nothing is broken.
- `src/app/auth/services/revoke-other-member-sessions.service.spec.ts` notes that the framework deletes family-less access rows whenever a family is revoked. This looks like intended `@warlock.js/auth` behaviour (the spec documents it); not checked in the auth package source.
- The `trustProxy` and `csp` comments in `src/config/http.ts` are the scaffold's own commented guidance, not workarounds.
