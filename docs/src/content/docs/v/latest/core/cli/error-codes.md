---
title: "Error codes"
description: Every stable Warlock error code (WL1001…WL9104) — what it means, what to do, and the skill that explains it. Thrown framework errors, `warlock doctor --json` findings and `warlock check --json` problems all carry these codes; `warlock explain <CODE>` prints one.
sidebar:
  order: 10
  label: "Error codes"
---

Framework errors thrown by core, every `warlock doctor` finding and every `warlock check` problem carry a **stable code** such as `WL3001`. Look the code up instead of interpreting the message:

```bash
warlock explain WL3001          # what it means, the fix, the skill and this page's anchor
warlock explain WL3001 --json   # the same as JSON
warlock explain                 # list every code
```

```
WL3001  A route name is already taken

  Area:     routing (your code)
  Fix:      Rename one of the two routes with the "name" route option; pages and API routes share one namespace.
  Skill:    register-route
  Docs:     https://warlock.js.org/v/latest/core/cli/error-codes/#wl3001
  Thrown as: RouteNameTakenError
```

## The scheme

A code is `WL` followed by four digits. The first digit is the area:

| Range  | Area        | Who acts                                                            |
| ------ | ----------- | ------------------------------------------------------------------- |
| WL1xxx | config      | your code: a configuration value is missing or invalid              |
| WL2xxx | boot        | your code: a module, connector or service could not boot            |
| WL3xxx | routing     | your code: route registration and lookup                            |
| WL4xxx | validation  | your code: request validation schemas                               |
| WL5xxx | http        | your code: the HTTP layer at runtime                                |
| WL6xxx | database    | your code: migrations, seeders, database code                       |
| WL7xxx | cli         | your code: CLI usage, and the type/lint/test problems `check` finds |
| WL8xxx | environment | **this machine**: Node version, tools, services, ports              |
| WL9xxx | convention  | your code: framework conventions and release hygiene                |

Every entry also has a `category` — `code` or `environment` — and only the WL8xxx codes are `environment`. That is the split `warlock check` turns into its exit codes: [exit 1 for your code, exit 2 for this machine](./check.md#exit-codes).

## Stability

- A released code keeps its meaning forever. It is never renumbered and never reused for a different problem.
- The title, fix and links may be reworded; match on the code, not the text.
- A code that is no longer emitted stays in the table, marked retired.
- New codes are added in the area's range.

## Reading a code in code

The registry is on `@warlock.js/core/errors` (side-effect free) and on the root `@warlock.js/core`:

```ts
import { ERROR_CODES, errorCodeOf, explainErrorCode, WarlockError } from "@warlock.js/core/errors";

try {
  await startServer();
} catch (error) {
  const code = errorCodeOf(error); // "WL8004" for a busy port, "WL8003" for ECONNREFUSED, …

  if (code) {
    console.error(`${code}: ${explainErrorCode(code)?.fix}`);
  }

  throw error;
}

throw new WarlockError("WL3003", `Route name "${name}" not found`);
```

- Framework error classes carry the code as a `code` property (`new ModuleLoadError(...).code === "WL2001"`).
- `PortInUseError.code` stays Node's `"EADDRINUSE"`; `errorCodeOf()` maps it to `WL8004` by class name, so use `errorCodeOf()` rather than reading `.code` directly. (`MailError.code` keeps its own mail codes.)
- `errorCodeOf()` also maps Node system errors (`ECONNREFUSED`, `ENOTFOUND`, `EHOSTUNREACH`, `ETIMEDOUT` → `WL8003`; `EADDRINUSE` → `WL8004`) and follows `error.cause`.
- HTTP errors you throw from handlers (`BadRequestError`, `ResourceNotFoundError`, …) are responses, not framework failures, and carry no code.

Every code follows, grouped by area.

## WL1xxx — config

### WL1001

**A required config section is missing.** Add the missing file under src/config/ (for example src/config/app.ts) exporting the section.

Category: your code · skill: `configure-app`

### WL1002

**No JWT signing secret is configured.** Run `warlock jwt.generate` (writes JWT_SECRET to .env) and read it as auth.accessToken.secret in src/config/auth.ts.

Category: your code · skill: `configure-app`

### WL1003

**The rate-limit store cannot use the configured cache driver.** Use a redis, pg or memory cache driver for http.rateLimit store "cache", or set store: "memory".

Category: your code · skill: `configure-app` · thrown as `UnsupportedRateLimitDriverError`

### WL1004

**An http.csp directive value is invalid.** Fix the directive value named in the message in your http config; quotes must balance and values may not contain ';'.

Category: your code · skill: `configure-app` · thrown as `InvalidCspDirectiveError`

### WL1005

**The uploads.images configuration is invalid.** Correct the uploads.images variant settings named in the message.

Category: your code · skill: `upload-file` · thrown as `ImageVariantsConfigError`

### WL1006

**warlock.config.ts sets a build option the builder refuses.** Remove the named option from the build block of warlock.config.ts; change tsconfig.json instead.

Category: your code · skill: `run-app` · thrown as `ForbiddenBuildOptionError`

### WL1007

**A locale dictionary file cannot be parsed.** Fix the key named in the message in the locales.json file it names.

Category: your code · skill: `use-localization` · thrown as `LocaleDictionaryError`

### WL1008

**A locale outside app.localeCodes was requested.** Add the locale to app.localeCodes in src/config/app.ts, or pass a configured locale.

Category: your code · skill: `use-localization` · thrown as `UnknownLocaleError`

### WL1009

**warlock.config.ts > connectors was refused.** Give every connector in warlock.config.ts a unique name that is not a built-in connector name.

Category: your code · skill: `add-connector`

## WL2xxx — boot

### WL2001

**An app module failed to load.** Open the file named in the message and fix the error it throws on import; its routes and listeners are missing until then.

Category: your code · skill: `warlock-doctor` · thrown as `ModuleLoadError`

### WL2002

**The app's source files could not be discovered.** Run the command from the project root and check that src/ exists and is readable.

Category: your code · skill: `warlock-doctor`

### WL2003

**A connector failed to boot.** Read the connector's message; it usually names the config value or package it needs.

Category: your code · skill: `add-connector`

### WL2004

**A container key was read before it was registered.** Register the key (container.set) before reading it, or read it after the connector that sets it has booted.

Category: your code · skill: `use-app-context` · thrown as `ContainerKeyMissingError`

### WL2005

**A boot precondition failed.** Fix the condition named in the message; restarting does not help until it changes.

Category: your code · skill: `run-app` · thrown as `BootPreconditionError`

### WL2006

**Storage was used before the storage connector ran.** Add src/config/storage.ts; in a custom command add "storage" to preload.connectors.

Category: your code · skill: `store-file` · thrown as `StorageNotInitializedError`

### WL2007

**A configured driver's package is not installed.** Install the package named in the message (for example `pnpm add sharp`), or stop configuring the driver.

Category: your code · skill: `update-packages`

## WL3xxx — routing

### WL3001

**A route name is already taken.** Rename one of the two routes with the "name" route option; pages and API routes share one namespace.

Category: your code · skill: `register-route` · thrown as `RouteNameTakenError`

### WL3002

**A route points at a controller method that does not exist.** Fix the [controller, action] pair: the action must be a method on the controller.

Category: your code · skill: `register-route`

### WL3003

**A URL was built for a route name that is not registered.** Check the name passed to router.route(); `warlock routes --name <part>` lists the registered names.

Category: your code · skill: `warlock-routes`

### WL3004

**A URL was built without one of the route's path parameters.** Pass every :param of the route path when building the URL.

Category: your code · skill: `warlock-routes`

### WL3005

**Route modules loaded but registered no routes.** Make sure routes.ts calls router.get/post/... at module level and is not wrapped in an unused function.

Category: your code · skill: `register-route`

### WL3006

**A handler uses the v4 (request, response) signature.** Rewrite the handler as async ({ request, response }) => { ... }.

Category: your code · skill: `create-controller`

## WL4xxx — validation

### WL4001

**A validation schema cannot be described as JSON Schema.** Use Seal validators with a static shape for validation.schema/params; custom validate middleware is not described.

Category: your code · skill: `validate-input`

## WL5xxx — http

### WL5001

**A cookie was read but the cookie plugin is not registered.** Register @fastify/cookie on the server before reading cookies by name.

Category: your code · skill: `send-response` · thrown as `CookieJarUnavailableError`

### WL5002

**An app route claims a health-probe path.** Move the app route, or rename the probe with http.health.path / http.health.readinessPath.

Category: your code · skill: `health-checks`

### WL5003

**Health probes are enabled but not registered.** Check that the http connector booted and that nothing removed the probe routes.

Category: your code · skill: `health-checks`

### WL5004

**Devtools recorded no timeline for the traced request.** Keep http.requestId enabled (its echoed header is how the request is found) and retry; a path under the devtools prefix is never recorded.

Category: your code · skill: `warlock-trace`

## WL6xxx — database

### WL6001

**A seeder depends on a seeder that is not registered.** Fix the dependsOn name, or register the missing seeder.

Category: your code · skill: `write-seeder` · thrown as `UnknownSeederDependencyError`

### WL6002

**Seeder dependencies form a cycle.** Remove one dependsOn edge from the cycle printed in the message.

Category: your code · skill: `write-seeder` · thrown as `SeederDependencyCycleError`

## WL7xxx — CLI and checked code

### WL7001

**A boolean CLI option received a value it cannot read.** Pass true/false/1/0/yes/no, or the flag on its own for true.

Category: your code · skill: `write-cli-command` · thrown as `CliOptionValueError`

### WL7002

**Generated code imports a package the app does not declare.** Add the named package to the app's dependencies, or import it through @warlock.js/core.

Category: your code · skill: `run-app` · thrown as `UndeclaredGeneratedImportError`

### WL7003

**A command needs an optional package that is not installed.** Install the packages named in the message as dev dependencies (warlock mcp needs @warlock.js/ai-tools and @warlock.js/ai).

Category: your code · skill: `warlock-mcp`

### WL7004

**warlock mcp was asked to listen off loopback without a token.** Pass --token (or set WARLOCK_MCP_TOKEN) when --host is not 127.0.0.1, ::1 or localhost, or keep the default loopback host.

Category: your code · skill: `warlock-mcp`

### WL7005

**An MCP tool that writes files was called on a read-only server.** Restart the server with --allow-writes to let generate tools write; without it they only return the diff.

Category: your code · skill: `warlock-mcp`

### WL7101

**TypeScript reports a type error.** Fix the type error at the reported position; the TypeScript code (TS1234) is in `rule`.

Category: your code · skill: `warlock-check`

### WL7102

**tsconfig.json is missing or invalid.** Fix tsconfig.json at the project root; the message names the problem.

Category: your code · skill: `warlock-check`

### WL7201

**The linter reports an error.** Fix the lint error at the reported position; the rule id is in `rule`.

Category: your code · skill: `warlock-check`

### WL7202

**The linter reports a warning.** Fix the warning, or change the rule's severity in the lint config if it does not apply.

Category: your code · skill: `warlock-check`

### WL7301

**A test failed.** Run the test file alone, read the assertion message and fix the code or the test.

Category: your code · skill: `warlock-check`

### WL7302

**A test file failed before its tests ran.** Fix the import or setup error named in the message; none of the file's tests ran.

Category: your code · skill: `warlock-check`

### WL7401

**The agent board is not initialized.** Run `warlock board init` at the project root first.

Category: your code · skill: `warlock-board`

### WL7402

**A board item does not exist.** Run `warlock board status` to list the item ids.

Category: your code · skill: `warlock-board`

### WL7403

**A board item cannot move to the requested state.** Use one of the next states listed in the message; `warlock board status <id>` shows the item's current state.

Category: your code · skill: `warlock-board`

### WL7404

**No board message arrived before the watch timed out.** Run `warlock board watch` again, or raise --timeout.

Category: your code · skill: `warlock-board`

### WL7501

**AGENTS.md has malformed generated-section markers.** Keep one `<!-- warlock:generated:start -->` line followed by one `<!-- warlock:generated:end -->` line, or remove both.

Category: your code · skill: `warlock-agents-md`

## WL8xxx — this machine

### WL8001

**The Node.js version is not supported.** Switch to a Node.js version that satisfies the engines range in the message (for example with nvm).

Category: this machine · skill: `update-packages`

### WL8002

**A tool the project is configured to use is not installed.** Install the tool named in the message (pnpm install), or remove its config file.

Category: this machine · skill: `warlock-check`

### WL8003

**A service the code needs is unreachable.** Start the service named in the message (database, Redis, ...) or point the config at a running one.

Category: this machine · skill: `warlock-check`

### WL8004

**A port is already in use.** Stop whatever listens on the port, or use another port (port 0 in tests).

Category: this machine · skill: `run-app` · thrown as `PortInUseError`

### WL8005

**esbuild's native binary is not installed.** Run `pnpm approve-builds`, then reinstall dependencies without skipping install scripts.

Category: this machine · skill: `run-app` · thrown as `EsbuildBinaryMissingError`

### WL8006

**Git cannot list the changed files.** Run inside a git repository with git on PATH, or run the command without --changed.

Category: this machine · skill: `warlock-check`

### WL8007

**A tool crashed, timed out or ran out of memory.** Re-run the step; if it repeats, raise the memory limit (NODE_OPTIONS=--max-old-space-size) or use --changed.

Category: this machine · skill: `warlock-check`

### WL8008

**The dev server is not running.** Start `warlock dev` in this project, or pass --url with the address of a running dev server.

Category: this machine · skill: `warlock-trace`

### WL8009

**Devtools is not running in the dev server.** Install it with `warlock add devtools` and restart `warlock dev`; devtools answers loopback requests in development only.

Category: this machine · skill: `warlock-trace`

## WL9xxx — conventions and hygiene

### WL9001

**An auto-loaded file is imported.** Remove the import: routes.ts, main.ts, worker.ts and events/ files are loaded by the framework.

Category: your code · skill: `warlock-conventions`

### WL9002

**An import path ends in .js.** Drop the .js extension from the import path.

Category: your code · skill: `warlock-conventions`

### WL9003

**A relative import reaches into another module.** Import across modules through the app/<module>/... alias instead of ../../.

Category: your code · skill: `warlock-conventions`

### WL9004

**tsconfig.json enables legacy experimentalDecorators.** Remove "experimentalDecorators": true from tsconfig.json; Cascade uses standard decorators.

Category: your code · skill: `lower-stage3-decorators`

### WL9005

**`request.all()` is passed to a query, a service or inApp().** Give the route a validation schema and pass `request.validated()`, which holds only the fields the schema accepted (mass assignment otherwise).

Category: your code · skill: `warlock-conventions`

### WL9006

**A mutating route has no auth guard and is not marked public.** Register the POST/PUT/PATCH/DELETE route inside `guarded()` (or with auth middleware), or pass `{ public: true }` if it is meant to be open.

Category: your code · skill: `warlock-conventions`

### WL9007

**A redirect or link target comes from request input.** Wrap the target in `safeRedirect()` (server, @warlock.js/core) or `safeRedirectTarget()` (pages, @warlock.js/web), or check it with `isSafeRedirect()` first.

Category: your code · skill: `warlock-conventions`

### WL9008

**A raw email, credential or request body is logged.** Pass the value through `maskEmail()`, `redact()`, `escapeLogValue()` or `request.toLogSnapshot()`, or log it under a key the logger censors (`token`, `password`, ...).

Category: your code · skill: `warlock-conventions`

### WL9009

**A regex with an unbounded quantifier runs on request input.** Bound the repetition (`{1,256}` instead of `+` or `*`) or cap the input length before matching.

Category: your code · skill: `warlock-conventions`

### WL9010

**`await` on a synchronous log call.** Remove the `await`: `log.info()` and its siblings return the logger; `await log.flush()` waits for delivery.

Category: your code (a warning: it does not fail `warlock check`) · skill: `warlock-conventions`

### WL9011

**A file defines more than one controller.** Move each extra controller into its own `<name>.controller.ts` file.

Category: your code (a warning: it does not fail `warlock check`) · skill: `warlock-conventions`

### WL9012

**A tagged union uses `kind` as its discriminator.** Rename the discriminator to `type` and update the code that narrows on it.

Category: your code (a warning: it does not fail `warlock check`) · skill: `warlock-conventions`

### WL9101

**A module still uses the deprecated utils/locales.ts.** Run `warlock doctor --fix` to convert it to locales.json, or convert it by hand.

Category: your code · skill: `use-localization`

### WL9102

**package.json version and CHANGELOG.md disagree.** Add a CHANGELOG.md heading for the package.json version, or fix the version.

Category: your code · skill: `warlock-doctor`

### WL9103

**CHANGELOG.md is missing or has no version heading.** Add a CHANGELOG.md with a `## x.y.z` heading for the current version.

Category: your code · skill: `warlock-doctor`

### WL9104

**Translation key is computed at runtime, so the page cannot ship only the keys it uses.** Declare the keys or prefixes the page renders in its setup file, for example `export const config = { translations: ["statuses.*", "members.title"] }`. Until then the page ships every translation group. Reported as a warning on `src/web` files; the page falls back to the full groups.

Category: your code · skill: `use-localization`

### WL9013

Component file exceeds the line limit. Split the component file or configure `componentLineLimit` (default 150). Defaults to a warning; configure severity in `.warlock-check.json`.

```bash
npx warlock explain WL9013
```

### WL9014

More than one component per file. Move extra components to their own TSX files. Defaults to a warning; configure severity in `.warlock-check.json`.

```bash
npx warlock explain WL9014
```

### WL9015

State, effects or handlers inside components. Move state, effects and event-handler functions into a `use-*.ts` hook. Defaults to a warning; configure severity in `.warlock-check.json`.

```bash
npx warlock explain WL9015
```

### WL9016

Native app form control. Use a design-system control; native controls are permitted inside `src/web/design-system/**`. Defaults to a warning; configure severity in `.warlock-check.json`.

```bash
npx warlock explain WL9016
```

### WL9017

Native DOM validation. Use shared schema validation and design-system field errors. Defaults to a warning; configure severity in `.warlock-check.json`.

```bash
npx warlock explain WL9017
```

### WL9018

Controller has no response schema. Assign `handler.responseSchema` to an exported `RequestHandler` in `src/app/**/controllers`. Defaults to a warning; configure severity in `.warlock-check.json`.

```bash
npx warlock explain WL9018
```
