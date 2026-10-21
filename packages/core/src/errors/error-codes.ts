/**
 * The registry of stable Warlock error codes.
 *
 * Every framework error core throws, every `warlock doctor` finding and every
 * `warlock check` problem carries one of these codes, so a person or an agent
 * can look the code up instead of interpreting the message. `warlock explain
 * <CODE>` prints an entry; the docs page `cli/error-codes` lists all of them.
 *
 * THE SCHEME: `WL` followed by four digits. The first digit is the area:
 *
 * | Range  | Area        | Meaning                                              |
 * | ------ | ----------- | ---------------------------------------------------- |
 * | WL1xxx | config      | a configuration value is missing or invalid          |
 * | WL2xxx | boot        | the app could not boot: modules, connectors, services |
 * | WL3xxx | routing     | route registration and lookup                        |
 * | WL4xxx | validation  | request validation schemas                           |
 * | WL5xxx | http        | the HTTP layer at runtime                            |
 * | WL6xxx | database    | migrations, seeders and database code                |
 * | WL7xxx | cli         | CLI usage, and problems `warlock check` finds in code |
 * | WL8xxx | environment | this machine: Node, tools, services, ports           |
 * | WL9xxx | convention  | framework conventions and release hygiene            |
 *
 * STABILITY: a code, once released, keeps its meaning forever. Its `title`,
 * `fix` and links may be reworded; a code is never reused for a different
 * problem and never renumbered. A retired code stays in this table with
 * `retired: true`.
 *
 * `category` splits "your code" from "this machine": `environment` problems are
 * the ones `warlock check` reports with exit code 2, so an agent stops editing
 * code to fix a missing Redis server.
 *
 * This module is part of the side-effect-free `@warlock.js/core/errors` entry:
 * it imports nothing.
 */

/** The area a code belongs to, matching its first digit. */
export type ErrorCodeArea =
  | "config"
  | "boot"
  | "routing"
  | "validation"
  | "http"
  | "database"
  | "cli"
  | "environment"
  | "convention";

/**
 * Who has to act: `code` problems are fixed in the project's source or config,
 * `environment` problems on the machine running it.
 */
export type ErrorCodeCategory = "code" | "environment";

/** One registry entry. */
export type ErrorCodeDefinition = {
  /** The stable code, e.g. `"WL3001"`. */
  readonly code: string;
  /** The area, matching the first digit. */
  readonly area: ErrorCodeArea;
  /** Whether the project or the machine has to change. */
  readonly category: ErrorCodeCategory;
  /** One-line name of the problem. */
  readonly title: string;
  /** One-line "what to do". */
  readonly fix: string;
  /** Slug of the skill that explains the fix (`packages/<pkg>/skills/<slug>/SKILL.md`). */
  readonly skill: string;
  /** Names of the error classes that carry this code, when an error class does. */
  readonly errorNames?: readonly string[];
  /** Set when the code is no longer emitted. Retired codes are never reused. */
  readonly retired?: true;
};

/** Base URL of the error-code reference; each code is an anchor on that page. */
export const ERROR_CODES_DOCS_URL = "https://warlock.js.org/v/latest/core/cli/error-codes/";

/** The registry, keyed by code. */
export const ERROR_CODES = {
  // ── WL1xxx config ────────────────────────────────────────────────────────
  WL1001: {
    code: "WL1001",
    area: "config",
    category: "code",
    title: "A required config section is missing",
    fix: "Add the missing file under src/config/ (for example src/config/app.ts) exporting the section.",
    skill: "configure-app",
  },
  WL1002: {
    code: "WL1002",
    area: "config",
    category: "code",
    title: "No JWT signing secret is configured",
    fix: "Run `warlock jwt.generate` (writes JWT_SECRET to .env) and read it as auth.accessToken.secret in src/config/auth.ts.",
    skill: "configure-app",
  },
  WL1003: {
    code: "WL1003",
    area: "config",
    category: "code",
    title: "The rate-limit store cannot use the configured cache driver",
    fix: 'Use a redis, pg or memory cache driver for http.rateLimit store "cache", or set store: "memory".',
    skill: "configure-app",
    errorNames: ["UnsupportedRateLimitDriverError"],
  },
  WL1004: {
    code: "WL1004",
    area: "config",
    category: "code",
    title: "An http.csp directive value is invalid",
    fix: "Fix the directive value named in the message in your http config; quotes must balance and values may not contain ';'.",
    skill: "configure-app",
    errorNames: ["InvalidCspDirectiveError"],
  },
  WL1005: {
    code: "WL1005",
    area: "config",
    category: "code",
    title: "The uploads.images configuration is invalid",
    fix: "Correct the uploads.images variant settings named in the message.",
    skill: "upload-file",
    errorNames: ["ImageVariantsConfigError"],
  },
  WL1006: {
    code: "WL1006",
    area: "config",
    category: "code",
    title: "warlock.config.ts sets a build option the builder refuses",
    fix: "Remove the named option from the build block of warlock.config.ts; change tsconfig.json instead.",
    skill: "run-app",
    errorNames: ["ForbiddenBuildOptionError"],
  },
  WL1007: {
    code: "WL1007",
    area: "config",
    category: "code",
    title: "A locale dictionary file cannot be parsed",
    fix: "Fix the key named in the message in the locales.json file it names.",
    skill: "use-localization",
    errorNames: ["LocaleDictionaryError"],
  },
  WL1008: {
    code: "WL1008",
    area: "config",
    category: "code",
    title: "A locale outside app.localeCodes was requested",
    fix: "Add the locale to app.localeCodes in src/config/app.ts, or pass a configured locale.",
    skill: "use-localization",
    errorNames: ["UnknownLocaleError"],
  },
  WL1009: {
    code: "WL1009",
    area: "config",
    category: "code",
    title: "warlock.config.ts > connectors was refused",
    fix: "Give every connector in warlock.config.ts a unique name that is not a built-in connector name.",
    skill: "add-connector",
  },

  // ── WL2xxx boot ──────────────────────────────────────────────────────────
  WL2001: {
    code: "WL2001",
    area: "boot",
    category: "code",
    title: "An app module failed to load",
    fix: "Open the file named in the message and fix the error it throws on import; its routes and listeners are missing until then.",
    skill: "warlock-doctor",
    errorNames: ["ModuleLoadError"],
  },
  WL2002: {
    code: "WL2002",
    area: "boot",
    category: "code",
    title: "The app's source files could not be discovered",
    fix: "Run the command from the project root and check that src/ exists and is readable.",
    skill: "warlock-doctor",
  },
  WL2003: {
    code: "WL2003",
    area: "boot",
    category: "code",
    title: "A connector failed to boot",
    fix: "Read the connector's message; it usually names the config value or package it needs.",
    skill: "add-connector",
  },
  WL2004: {
    code: "WL2004",
    area: "boot",
    category: "code",
    title: "A container key was read before it was registered",
    fix: "Register the key (container.set) before reading it, or read it after the connector that sets it has booted.",
    skill: "use-app-context",
    errorNames: ["ContainerKeyMissingError"],
  },
  WL2005: {
    code: "WL2005",
    area: "boot",
    category: "code",
    title: "A boot precondition failed",
    fix: "Fix the condition named in the message; restarting does not help until it changes.",
    skill: "run-app",
    errorNames: ["BootPreconditionError"],
  },
  WL2006: {
    code: "WL2006",
    area: "boot",
    category: "code",
    title: "Storage was used before the storage connector ran",
    fix: 'Add src/config/storage.ts; in a custom command add "storage" to preload.connectors.',
    skill: "store-file",
    errorNames: ["StorageNotInitializedError"],
  },
  WL2007: {
    code: "WL2007",
    area: "boot",
    category: "code",
    title: "A configured driver's package is not installed",
    fix: "Install the package named in the message (for example `pnpm add sharp`), or stop configuring the driver.",
    skill: "update-packages",
  },

  // ── WL3xxx routing ───────────────────────────────────────────────────────
  WL3001: {
    code: "WL3001",
    area: "routing",
    category: "code",
    title: "A route name is already taken",
    fix: 'Rename one of the two routes with the "name" route option; pages and API routes share one namespace.',
    skill: "register-route",
    errorNames: ["RouteNameTakenError"],
  },
  WL3002: {
    code: "WL3002",
    area: "routing",
    category: "code",
    title: "A route points at a controller method that does not exist",
    fix: "Fix the [controller, action] pair: the action must be a method on the controller.",
    skill: "register-route",
  },
  WL3003: {
    code: "WL3003",
    area: "routing",
    category: "code",
    title: "A URL was built for a route name that is not registered",
    fix: "Check the name passed to router.route(); `warlock routes --name <part>` lists the registered names.",
    skill: "warlock-routes",
  },
  WL3004: {
    code: "WL3004",
    area: "routing",
    category: "code",
    title: "A URL was built without one of the route's path parameters",
    fix: "Pass every :param of the route path when building the URL.",
    skill: "warlock-routes",
  },
  WL3005: {
    code: "WL3005",
    area: "routing",
    category: "code",
    title: "Route modules loaded but registered no routes",
    fix: "Make sure routes.ts calls router.get/post/... at module level and is not wrapped in an unused function.",
    skill: "register-route",
  },
  WL3006: {
    code: "WL3006",
    area: "routing",
    category: "code",
    title: "A handler uses the v4 (request, response) signature",
    fix: "Rewrite the handler as async ({ request, response }) => { ... }.",
    skill: "create-controller",
  },

  // ── WL4xxx validation ────────────────────────────────────────────────────
  WL4001: {
    code: "WL4001",
    area: "validation",
    category: "code",
    title: "A validation schema cannot be described as JSON Schema",
    fix: "Use Seal validators with a static shape for validation.schema/params; custom validate middleware is not described.",
    skill: "validate-input",
  },

  // ── WL5xxx http ──────────────────────────────────────────────────────────
  WL5001: {
    code: "WL5001",
    area: "http",
    category: "code",
    title: "A cookie was read but the cookie plugin is not registered",
    fix: "Register @fastify/cookie on the server before reading cookies by name.",
    skill: "send-response",
    errorNames: ["CookieJarUnavailableError"],
  },
  WL5002: {
    code: "WL5002",
    area: "http",
    category: "code",
    title: "An app route claims a health-probe path",
    fix: "Move the app route, or rename the probe with http.health.path / http.health.readinessPath.",
    skill: "health-checks",
  },
  WL5003: {
    code: "WL5003",
    area: "http",
    category: "code",
    title: "Health probes are enabled but not registered",
    fix: "Check that the http connector booted and that nothing removed the probe routes.",
    skill: "health-checks",
  },
  WL5004: {
    code: "WL5004",
    area: "http",
    category: "code",
    title: "Devtools recorded no timeline for the traced request",
    fix: "Keep http.requestId enabled (its echoed header is how the request is found) and retry; a path under the devtools prefix is never recorded.",
    skill: "warlock-trace",
  },

  // ── WL6xxx database ──────────────────────────────────────────────────────
  WL6001: {
    code: "WL6001",
    area: "database",
    category: "code",
    title: "A seeder depends on a seeder that is not registered",
    fix: "Fix the dependsOn name, or register the missing seeder.",
    skill: "write-seeder",
    errorNames: ["UnknownSeederDependencyError"],
  },
  WL6002: {
    code: "WL6002",
    area: "database",
    category: "code",
    title: "Seeder dependencies form a cycle",
    fix: "Remove one dependsOn edge from the cycle printed in the message.",
    skill: "write-seeder",
    errorNames: ["SeederDependencyCycleError"],
  },

  // ── WL7xxx cli and checked code ──────────────────────────────────────────
  WL7001: {
    code: "WL7001",
    area: "cli",
    category: "code",
    title: "A boolean CLI option received a value it cannot read",
    fix: "Pass true/false/1/0/yes/no, or the flag on its own for true.",
    skill: "write-cli-command",
    errorNames: ["CliOptionValueError"],
  },
  WL7002: {
    code: "WL7002",
    area: "cli",
    category: "code",
    title: "Generated code imports a package the app does not declare",
    fix: "Add the named package to the app's dependencies, or import it through @warlock.js/core.",
    skill: "run-app",
    errorNames: ["UndeclaredGeneratedImportError"],
  },
  WL7003: {
    code: "WL7003",
    area: "cli",
    category: "code",
    title: "A command needs an optional package that is not installed",
    fix: "Install the packages named in the message as dev dependencies (warlock mcp needs @warlock.js/ai-tools and @warlock.js/ai).",
    skill: "warlock-mcp",
  },
  WL7004: {
    code: "WL7004",
    area: "cli",
    category: "code",
    title: "warlock mcp was asked to listen off loopback without a token",
    fix: "Pass --token (or set WARLOCK_MCP_TOKEN) when --host is not 127.0.0.1, ::1 or localhost, or keep the default loopback host.",
    skill: "warlock-mcp",
  },
  WL7005: {
    code: "WL7005",
    area: "cli",
    category: "code",
    title: "An MCP tool that writes files was called on a read-only server",
    fix: "Restart the server with --allow-writes to let generate tools write; without it they only return the diff.",
    skill: "warlock-mcp",
  },
  WL7101: {
    code: "WL7101",
    area: "cli",
    category: "code",
    title: "TypeScript reports a type error",
    fix: "Fix the type error at the reported position; the TypeScript code (TS1234) is in `rule`.",
    skill: "warlock-check",
  },
  WL7102: {
    code: "WL7102",
    area: "cli",
    category: "code",
    title: "tsconfig.json is missing or invalid",
    fix: "Fix tsconfig.json at the project root; the message names the problem.",
    skill: "warlock-check",
  },
  WL7201: {
    code: "WL7201",
    area: "cli",
    category: "code",
    title: "The linter reports an error",
    fix: "Fix the lint error at the reported position; the rule id is in `rule`.",
    skill: "warlock-check",
  },
  WL7202: {
    code: "WL7202",
    area: "cli",
    category: "code",
    title: "The linter reports a warning",
    fix: "Fix the warning, or change the rule's severity in the lint config if it does not apply.",
    skill: "warlock-check",
  },
  WL7301: {
    code: "WL7301",
    area: "cli",
    category: "code",
    title: "A test failed",
    fix: "Run the test file alone, read the assertion message and fix the code or the test.",
    skill: "warlock-check",
  },
  WL7302: {
    code: "WL7302",
    area: "cli",
    category: "code",
    title: "A test file failed before its tests ran",
    fix: "Fix the import or setup error named in the message; none of the file's tests ran.",
    skill: "warlock-check",
  },
  WL7401: {
    code: "WL7401",
    area: "cli",
    category: "code",
    title: "The agent board is not initialized",
    fix: "Run `warlock board init` at the project root first.",
    skill: "warlock-board",
  },
  WL7402: {
    code: "WL7402",
    area: "cli",
    category: "code",
    title: "A board item does not exist",
    fix: "Run `warlock board status` to list the item ids.",
    skill: "warlock-board",
  },
  WL7403: {
    code: "WL7403",
    area: "cli",
    category: "code",
    title: "A board item cannot move to the requested state",
    fix: "Use one of the next states listed in the message; `warlock board status <id>` shows the item's current state.",
    skill: "warlock-board",
  },
  WL7404: {
    code: "WL7404",
    area: "cli",
    category: "code",
    title: "No board message arrived before the watch timed out",
    fix: "Run `warlock board watch` again, or raise --timeout.",
    skill: "warlock-board",
  },
  WL7501: {
    code: "WL7501",
    area: "cli",
    category: "code",
    title: "AGENTS.md has malformed generated-section markers",
    fix: "Keep one `<!-- warlock:generated:start -->` line followed by one `<!-- warlock:generated:end -->` line, or remove both.",
    skill: "warlock-agents-md",
  },

  // ── WL8xxx environment ───────────────────────────────────────────────────
  WL8001: {
    code: "WL8001",
    area: "environment",
    category: "environment",
    title: "The Node.js version is not supported",
    fix: "Switch to a Node.js version that satisfies the engines range in the message (for example with nvm).",
    skill: "update-packages",
  },
  WL8002: {
    code: "WL8002",
    area: "environment",
    category: "environment",
    title: "A tool the project is configured to use is not installed",
    fix: "Install the tool named in the message (pnpm install), or remove its config file.",
    skill: "warlock-check",
  },
  WL8003: {
    code: "WL8003",
    area: "environment",
    category: "environment",
    title: "A service the code needs is unreachable",
    fix: "Start the service named in the message (database, Redis, ...) or point the config at a running one.",
    skill: "warlock-check",
  },
  WL8004: {
    code: "WL8004",
    area: "environment",
    category: "environment",
    title: "A port is already in use",
    fix: "Stop whatever listens on the port, or use another port (port 0 in tests).",
    skill: "run-app",
    errorNames: ["PortInUseError"],
  },
  WL8005: {
    code: "WL8005",
    area: "environment",
    category: "environment",
    title: "esbuild's native binary is not installed",
    fix: "Run `pnpm approve-builds`, then reinstall dependencies without skipping install scripts.",
    skill: "run-app",
    errorNames: ["EsbuildBinaryMissingError"],
  },
  WL8006: {
    code: "WL8006",
    area: "environment",
    category: "environment",
    title: "Git cannot list the changed files",
    fix: "Run inside a git repository with git on PATH, or run the command without --changed.",
    skill: "warlock-check",
  },
  WL8007: {
    code: "WL8007",
    area: "environment",
    category: "environment",
    title: "A tool crashed, timed out or ran out of memory",
    fix: "Re-run the step; if it repeats, raise the memory limit (NODE_OPTIONS=--max-old-space-size) or use --changed.",
    skill: "warlock-check",
  },
  WL8008: {
    code: "WL8008",
    area: "environment",
    category: "environment",
    title: "The dev server is not running",
    fix: "Start `warlock dev` in this project, or pass --url with the address of a running dev server.",
    skill: "warlock-trace",
  },
  WL8009: {
    code: "WL8009",
    area: "environment",
    category: "environment",
    title: "Devtools is not running in the dev server",
    fix: "Install it with `warlock add devtools` and restart `warlock dev`; devtools answers loopback requests in development only.",
    skill: "warlock-trace",
  },

  // ── WL9xxx conventions and hygiene ───────────────────────────────────────
  WL9001: {
    code: "WL9001",
    area: "convention",
    category: "code",
    title: "An auto-loaded file is imported",
    fix: "Remove the import: routes.ts, main.ts, worker.ts and events/ files are loaded by the framework.",
    skill: "warlock-conventions",
  },
  WL9002: {
    code: "WL9002",
    area: "convention",
    category: "code",
    title: "An import path ends in .js",
    fix: "Drop the .js extension from the import path.",
    skill: "warlock-conventions",
  },
  WL9003: {
    code: "WL9003",
    area: "convention",
    category: "code",
    title: "A relative import reaches into another module",
    fix: "Import across modules through the app/<module>/... alias instead of ../../.",
    skill: "warlock-conventions",
  },
  WL9004: {
    code: "WL9004",
    area: "convention",
    category: "code",
    title: "tsconfig.json enables legacy experimentalDecorators",
    fix: 'Remove "experimentalDecorators": true from tsconfig.json; Cascade uses standard decorators.',
    skill: "lower-stage3-decorators",
  },
  WL9005: {
    code: "WL9005",
    area: "convention",
    category: "code",
    title: "`request.all()` is passed to a query, a service or inApp()",
    fix: "Give the route a validation schema and pass `request.validated()`, which holds only the fields the schema accepted (mass assignment otherwise).",
    skill: "warlock-conventions",
  },
  WL9006: {
    code: "WL9006",
    area: "convention",
    category: "code",
    title: "A mutating route has no auth guard and is not marked public",
    fix: "Register the POST/PUT/PATCH/DELETE route inside `guarded()` (or with auth middleware), or pass `{ public: true }` if it is meant to be open.",
    skill: "warlock-conventions",
  },
  WL9007: {
    code: "WL9007",
    area: "convention",
    category: "code",
    title: "A redirect or link target comes from request input",
    fix: "Wrap the target in `safeRedirect()` (server, @warlock.js/core) or `safeRedirectTarget()` (pages, @warlock.js/web), or check it with `isSafeRedirect()` first.",
    skill: "warlock-conventions",
  },
  WL9008: {
    code: "WL9008",
    area: "convention",
    category: "code",
    title: "A raw email, credential or request body is logged",
    fix: "Pass the value through `maskEmail()`, `redact()`, `escapeLogValue()` or `request.toLogSnapshot()`, or log it under a key the logger censors (`token`, `password`, ...).",
    skill: "warlock-conventions",
  },
  WL9009: {
    code: "WL9009",
    area: "convention",
    category: "code",
    title: "A regex with an unbounded quantifier runs on request input",
    fix: "Bound the repetition (`{1,256}` instead of `+` or `*`) or cap the input length before matching.",
    skill: "warlock-conventions",
  },
  WL9010: {
    code: "WL9010",
    area: "convention",
    category: "code",
    title: "`await` on a synchronous log call",
    fix: "Remove the `await`: `log.info()` and its siblings return the logger; `await log.flush()` waits for delivery.",
    skill: "warlock-conventions",
  },
  WL9011: {
    code: "WL9011",
    area: "convention",
    category: "code",
    title: "A file defines more than one controller",
    fix: "Move each extra controller into its own `<name>.controller.ts` file.",
    skill: "warlock-conventions",
  },
  WL9012: {
    code: "WL9012",
    area: "convention",
    category: "code",
    title: "A tagged union uses `kind` as its discriminator",
    fix: "Rename the discriminator to `type` and update the code that narrows on it.",
    skill: "warlock-conventions",
  },
  WL9013: {
    code: "WL9013",
    area: "convention",
    category: "code",
    title: "Component file exceeds the configured line limit",
    fix: "Split the component file; the default limit is 150 lines.",
    skill: "warlock-check",
  },
  WL9014: {
    code: "WL9014",
    area: "convention",
    category: "code",
    title: "A file defines more than one web component",
    fix: "Move each component to its own TSX file.",
    skill: "warlock-check",
  },
  WL9015: {
    code: "WL9015",
    area: "convention",
    category: "code",
    title: "Component state, effects or event handlers live in a component file",
    fix: "Move state, effects and event handlers into a use-*.ts hook.",
    skill: "warlock-check",
  },
  WL9016: {
    code: "WL9016",
    area: "convention",
    category: "code",
    title: "App code uses a native form control",
    fix: "Use a design-system control; native controls are allowed in src/web/design-system/.",
    skill: "warlock-check",
  },
  WL9017: {
    code: "WL9017",
    area: "convention",
    category: "code",
    title: "A DOM form element declares native validation",
    fix: "Use the shared validation schema and field error controls.",
    skill: "warlock-check",
  },
  WL9018: {
    code: "WL9018",
    area: "convention",
    category: "code",
    title: "An exported controller has no response schema",
    fix: "Assign controller.responseSchema with a contract for each response status.",
    skill: "warlock-check",
  },
  WL9019: {
    code: "WL9019",
    area: "convention",
    category: "code",
    title: "A browser route call takes a name that cannot be read statically",
    fix: 'Pass a string literal (or a template with a static prefix), or declare the names the page uses with `config.apiRoutes` in its setup file (`"orders.*"` covers a prefix).',
    skill: "warlock-check",
  },
  WL9020: {
    code: "WL9020",
    area: "convention",
    category: "code",
    title: "Browser code references a named API route that is clientVisible: false",
    fix: "Call the endpoint from the server instead, or remove `clientVisible: false` from the route if the browser must reach it.",
    skill: "warlock-check",
  },
  WL9101: {
    code: "WL9101",
    area: "convention",
    category: "code",
    title: "A module still uses the deprecated utils/locales.ts",
    fix: "Run `warlock doctor --fix` to convert it to locales.json, or convert it by hand.",
    skill: "use-localization",
  },
  WL9102: {
    code: "WL9102",
    area: "convention",
    category: "code",
    title: "package.json version and CHANGELOG.md disagree",
    fix: "Add a CHANGELOG.md heading for the package.json version, or fix the version.",
    skill: "warlock-doctor",
  },
  WL9103: {
    code: "WL9103",
    area: "convention",
    category: "code",
    title: "CHANGELOG.md is missing or has no version heading",
    fix: "Add a CHANGELOG.md with a `## x.y.z` heading for the current version.",
    skill: "warlock-doctor",
  },
} as const satisfies Record<string, ErrorCodeDefinition>;

/** Every registered code, as a union. */
export type WarlockErrorCode = keyof typeof ERROR_CODES;

/** Whether `value` is a registered code. */
export function isWarlockErrorCode(value: unknown): value is WarlockErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/**
 * The registry entry for a code, or `undefined` for an unknown one. Case and
 * surrounding whitespace are ignored, so `explainErrorCode(" wl3001 ")` works.
 */
export function explainErrorCode(code: string): ErrorCodeDefinition | undefined {
  const normalized = code.trim().toUpperCase();

  return isWarlockErrorCode(normalized) ? ERROR_CODES[normalized] : undefined;
}

/** The docs URL of a code: the reference page with the code as its anchor. */
export function errorCodeDocsUrl(code: WarlockErrorCode): string {
  return `${ERROR_CODES_DOCS_URL}#${code.toLowerCase()}`;
}

/** Node errno codes that mean "the machine", mapped to the Warlock code. */
const SYSTEM_ERROR_CODES: Readonly<Record<string, WarlockErrorCode>> = {
  ECONNREFUSED: "WL8003",
  ENOTFOUND: "WL8003",
  EHOSTUNREACH: "WL8003",
  ETIMEDOUT: "WL8003",
  EADDRINUSE: "WL8004",
  ERR_OUT_OF_MEMORY: "WL8007",
};

function readStringProperty(value: object, key: string): string | undefined {
  const property = Reflect.get(value, key);

  return typeof property === "string" ? property : undefined;
}

/**
 * The Warlock code of a thrown value, or `undefined` when it has none.
 *
 * Reads, in order: a registered `code` property (framework errors carry one);
 * the error's `name`, for classes whose `code` property already means
 * something else (`PortInUseError.code` is Node's `"EADDRINUSE"`); a Node
 * system errno such as `ECONNREFUSED`; then the same checks on `cause`. Reading
 * by name rather than `instanceof` keeps the answer right when two copies of
 * core are loaded.
 */
export function errorCodeOf(error: unknown): WarlockErrorCode | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);

    const code = readStringProperty(current, "code");

    if (isWarlockErrorCode(code)) {
      return code;
    }

    const name = readStringProperty(current, "name");

    if (name) {
      for (const definition of Object.values(ERROR_CODES) as ErrorCodeDefinition[]) {
        if (definition.errorNames?.includes(name) && isWarlockErrorCode(definition.code)) {
          return definition.code;
        }
      }
    }

    if (code && SYSTEM_ERROR_CODES[code]) {
      return SYSTEM_ERROR_CODES[code];
    }

    current = Reflect.get(current, "cause");
  }

  return undefined;
}
