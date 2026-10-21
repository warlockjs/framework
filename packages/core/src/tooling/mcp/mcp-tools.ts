import {
  ERROR_CODES,
  errorCodeDocsUrl,
  explainErrorCode,
  isWarlockErrorCode,
} from "../../errors/error-codes";
import { WarlockError } from "../../errors/warlock-error";
import { CHECK_STEPS, type CheckReport, type CheckStepName } from "../check/check-report.types";
import type { TestRunReport } from "../check/run-tests";
import type {
  DevtoolsClient,
  DevtoolsRequestRecord,
  DevtoolsRequestSummaryRecord,
} from "../devtools/devtools-client";
import { type GeneratorSpec, isMakeGenerator, MAKE_GENERATORS } from "../generate";
import {
  INSPECT_SECTIONS,
  type InspectReport,
  type InspectRoute,
  type InspectSection,
} from "../inspect/inspect-report.types";
import { buildDbSchema } from "./db-schema";
import { type DocsCorpus, readDocsFile, searchDocs } from "./docs-search";
import { inputSchema, type McpInputSchema, type McpInputProperty } from "./tool-input";

/**
 * What the `warlock mcp` tools run against. The CLI fills it from a read-only
 * boot of the app; `warlock dev --mcp` fills it from the live dev process;
 * tests pass fakes.
 */
export type WarlockMcpContext = {
  /** Project root. */
  cwd: string;
  /** Whether tools may write project files (`--allow-writes`). */
  allowWrites: boolean;
  /** Describe the app (see `inspectApp`). */
  inspect(sections: readonly InspectSection[]): Promise<InspectReport>;
  /** Run `warlock check`. */
  check(options: {
    changed?: boolean;
    base?: string;
    skip?: readonly CheckStepName[];
  }): Promise<CheckReport>;
  /** Run tests for files, the changed files, or the suite. */
  tests(options: {
    files?: readonly string[];
    changed?: boolean;
    base?: string;
  }): Promise<TestRunReport>;
  /** Connect to the running dev server's devtools API (throws WL8008 / WL8009). */
  devtools(): Promise<DevtoolsClient>;
  /** Preview (and, with `allowWrites`, apply) a `make` / `add` generator. */
  generation: {
    plan(spec: GeneratorSpec): Promise<unknown>;
    apply(spec: GeneratorSpec): Promise<unknown>;
  };
  /** The installed docs corpus (cached by the caller). */
  docs(): Promise<DocsCorpus>;
  /** The `warlock add` feature names, advertised as the `generate_add` enum. */
  features?: readonly string[];
};

/** One tool the server exposes. */
export type WarlockMcpTool = {
  /** Underscored, never dotted: model APIs refuse dots in tool names (`^[a-zA-Z0-9_-]{1,128}$`). */
  name: string;
  description: string;
  input: McpInputSchema;
  /** Whether a call can change project files. Only exposed with `allowWrites`. */
  writes: boolean;
  /** A check run before validation; return a message to refuse the call. */
  precheck?: (input: Record<string, unknown>) => string | null;
  run(input: Record<string, unknown>): Promise<unknown>;
};

/** The `make` generators the `generate_make` tool can run (`warlock generate.<name>`). */
export const MCP_MAKE_GENERATORS = MAKE_GENERATORS;

function stringArg(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanArg(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

function integerArg(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];

  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function stringsArg(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function includesText(values: readonly (string | null | undefined)[], needle: string): boolean {
  const lowered = needle.toLowerCase();

  return values.some((value) => typeof value === "string" && value.toLowerCase().includes(lowered));
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function filterRoutes(
  routes: readonly InspectRoute[],
  input: Record<string, unknown>,
): InspectRoute[] {
  const filter = stringArg(input, "filter");
  const method = stringArg(input, "method")?.toUpperCase();
  const unguarded = booleanArg(input, "unguardedWrites");

  return routes.filter(
    (route) =>
      (!filter ||
        includesText([route.path, route.name, route.handler, route.sourceFile], filter)) &&
      (!method || route.method === method) &&
      (!unguarded || (MUTATING.has(route.method) && !route.auth.required && !route.isPage)),
  );
}

/** The `filter` match of one entry of a section, by the fields an agent would search. */
function sectionEntryMatches(section: InspectSection, entry: unknown, filter: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;

  const fields: Record<InspectSection, readonly string[]> = {
    routes: ["path", "name", "handler", "sourceFile"],
    models: ["name", "table", "sourceFile"],
    resources: ["name"],
    config: ["key", "file"],
    events: ["event"],
    pages: ["path", "name", "file"],
    jobs: ["name", "queue"],
    schedules: ["name"],
    packages: ["name"],
    files: ["file", "module", "role"],
  };

  return includesText(
    fields[section].map((field) => {
      const value = Reflect.get(entry, field);
      return typeof value === "string" ? value : null;
    }),
    filter,
  );
}

const SECTION_DESCRIPTIONS: Record<InspectSection, string> = {
  routes:
    "Registered HTTP routes from the booted router: method, path, name, source file, handler, middleware chain in run order, auth guard, CSRF, rate limit, logging policy, request JSON Schemas and declared responses ($refs resolve against `components`).",
  models:
    "Cascade model classes: table, primary key, data source, columns (from the model's Seal schema), relations, resource, delete strategy and timestamp columns.",
  resources:
    "Resources reached from route responses or models, with their output shape as JSON Schema and the models that use them.",
  config:
    "Every loaded config key as a dotted path with its TYPE (never its value) and the src/config file it came from.",
  events:
    "Event listeners app modules registered while loading, grouped by event, with the registering file.",
  pages:
    "Pages @warlock.js/web installed: path, name, file, layout chain, loaders, actions and guard.",
  jobs: "Queue jobs defined with defineJob() from @warlock.js/queue: name, queue, attempts, backoff, retention.",
  schedules:
    "Scheduled tasks from @warlock.js/scheduler: name, cron expression, intervals, next run.",
  files:
    "Source files, convention roles, exports and resolved imports/importedBy (static analysis, no execution).",
  packages: "Installed @warlock.js/* packages and their versions.",
};

function inspectSectionTool(context: WarlockMcpContext, section: InspectSection): WarlockMcpTool {
  const properties: Record<string, McpInputProperty> = {
    filter: {
      type: "string",
      description:
        "Case-insensitive substring to keep only matching entries (names, paths, keys, files).",
    },
  };

  if (section === "routes") {
    properties.method = {
      type: "string",
      description: "Only routes with this HTTP method (GET, POST, …).",
    };
    properties.unguardedWrites = {
      type: "boolean",
      description: "Only POST/PUT/PATCH/DELETE API routes that have no auth guard.",
    };
  }

  return {
    name: `inspect_${section}`,
    description: `${SECTION_DESCRIPTIONS[section]} The same data as \`warlock inspect --json --section ${section}\`. Read-only.`,
    input: inputSchema(properties),
    writes: false,
    async run(input) {
      const report = await context.inspect([section]);
      const entries: unknown[] = report[section] ?? [];
      const filter = stringArg(input, "filter");
      const kept =
        section === "routes" && report.routes
          ? filterRoutes(report.routes, input)
          : filter
            ? entries.filter((entry) => sectionEntryMatches(section, entry, filter))
            : entries;
      const withSchemas = section === "routes" || section === "models" || section === "resources";

      return {
        schemaVersion: report.schemaVersion,
        [section]: kept,
        total: entries.length,
        ...(withSchemas ? { components: report.components } : {}),
        warnings: report.warnings,
      };
    },
  };
}

function summarizeRequest(summary: DevtoolsRequestSummaryRecord, record?: DevtoolsRequestRecord) {
  if (!record) return summary;

  const nPlusOneShapes = new Set(
    record.warnings
      .filter((warning) => warning.type === "n+1" && typeof warning.shape === "string")
      .map((warning) => warning.shape),
  );

  return {
    ...summary,
    error: record.error ?? null,
    phases: record.phases,
    queries: record.queries.map((query) => ({
      ...query,
      nPlusOne: typeof query.shape === "string" && nPlusOneShapes.has(query.shape),
    })),
    warnings: record.warnings,
    logs: record.logs,
    cache: record.cache,
    mails: record.mails,
    timings: {
      totalMs: record.durationMs ?? null,
      phasesMs: record.phases.reduce<Record<string, number>>((totals, phase) => {
        totals[phase.name] = (totals[phase.name] ?? 0) + phase.durationMs;
        return totals;
      }, {}),
      queriesMs: record.queries.reduce(
        (total, query) => total + (typeof query.durationMs === "number" ? query.durationMs : 0),
        0,
      ),
    },
  };
}

function writeProperty(): Record<string, McpInputProperty> {
  return {
    write: {
      type: "boolean",
      description:
        "Write the files into the project. Default false: only return the diff (the generator runs in a throw-away copy of the project).",
    },
  };
}

function refuseWrite(context: WarlockMcpContext) {
  return (input: Record<string, unknown>): string | null =>
    input.write === true && !context.allowWrites
      ? `WL7005: this MCP server is read-only; restart it with --allow-writes to let generate tools write. Without it they return the diff only.`
      : null;
}

const MAKE_FLAGS: Record<string, McpInputProperty> = {
  withValidation: {
    type: "boolean",
    description: "controller: also generate a validation schema and bind it (--with-validation).",
  },
  withResource: {
    type: "boolean",
    description: "model: also generate a resource (--with-resource).",
  },
  table: { type: "string", description: "model: the table name (--table)." },
  minimal: {
    type: "boolean",
    description: "module: a minimal skeleton instead of the full CRUD scaffold (--minimal).",
  },
  noTimestamps: {
    type: "boolean",
    description: "model / migration: no timestamp columns (--no-timestamps).",
  },
  add: {
    type: "string",
    description: "migration: columns to add, DSL name:type:modifier,… (--add).",
  },
  drop: { type: "string", description: "migration: comma-separated columns to drop (--drop)." },
  rename: { type: "string", description: "migration: columns to rename, old:new,… (--rename)." },
  force: { type: "boolean", description: "Overwrite files that already exist (--force)." },
  overwrite: {
    type: "boolean",
    description:
      "module / model: with force, also replace files that differ from the output (--overwrite).",
  },
};

const FLAG_NAMES: Record<string, string> = {
  withValidation: "with-validation",
  withResource: "with-resource",
  table: "table",
  minimal: "minimal",
  noTimestamps: "no-timestamps",
  add: "add",
  drop: "drop",
  rename: "rename",
  force: "force",
  overwrite: "overwrite",
};

/** The generator spec a `generate_make` call describes. */
export function makeSpecFromInput(input: Record<string, unknown>): GeneratorSpec {
  const generator = stringArg(input, "generator");
  const name = stringArg(input, "name");

  if (!generator || !isMakeGenerator(generator) || !name) {
    throw new Error(
      `generate_make needs a generator (${MCP_MAKE_GENERATORS.join(", ")}) and a name.`,
    );
  }

  const flags: Record<string, string | boolean> = {};

  for (const [key, flag] of Object.entries(FLAG_NAMES)) {
    const value = input[key];

    if (value === true) flags[flag] = true;
    if (typeof value === "string" && value.length > 0) flags[flag] = value;
  }

  return {
    type: "make",
    generator,
    name,
    flags,
  };
}

/**
 * The tools `warlock mcp` serves. Read-only unless `context.allowWrites`:
 * generate tools then accept `write: true`; without it they only return the
 * diff a generator would produce.
 */
export function createWarlockMcpTools(context: WarlockMcpContext): WarlockMcpTool[] {
  const tools: WarlockMcpTool[] = [
    {
      name: "inspect_app",
      description:
        "Summary of the app: name, version, Node, environment, how many routes/models/resources/config keys/events/pages/jobs/schedules/packages it has, and inspect warnings (WL codes for modules that failed to load). Start here, then call the inspect_<section> tool you need. Read-only.",
      input: inputSchema({}),
      writes: false,
      async run() {
        const report = await context.inspect(INSPECT_SECTIONS);
        const counts = Object.fromEntries(
          INSPECT_SECTIONS.map((section) => [section, report[section]?.length ?? 0]),
        );

        return {
          schemaVersion: report.schemaVersion,
          app: report.app,
          counts,
          warnings: report.warnings,
        };
      },
    },
    ...INSPECT_SECTIONS.map((section) => inspectSectionTool(context, section)),
    {
      name: "db_schema",
      description:
        "The database schema the app's models declare: one entry per table with columns (type, required, primary key, foreign key of belongsTo relations), relations, timestamp columns and delete strategy. Built from the models' Seal schemas — no database connection is opened, so migration-only columns are not listed. Read-only.",
      input: inputSchema({
        model: { type: "string", description: "Only this model (class name) or table." },
      }),
      writes: false,
      async run(input) {
        const report = await context.inspect(["models"]);

        return buildDbSchema(report.models ?? [], stringArg(input, "model"));
      },
    },
    {
      name: "docs_search",
      description:
        "Search the documentation of the @warlock.js packages INSTALLED in this app (their skills, README and llms files under node_modules) — offline, so answers match the installed versions. Returns ranked sections with the file, heading, line and an excerpt; read a whole skill with docs_read. Read-only.",
      input: inputSchema(
        {
          query: {
            type: "string",
            description: "Words to look for, e.g. 'validation schema file upload'.",
          },
          limit: {
            type: "integer",
            description: "Maximum hits (default 8).",
            minimum: 1,
            maximum: 25,
          },
          package: {
            type: "string",
            description: "Only this package, e.g. '@warlock.js/cascade'.",
          },
        },
        ["query"],
      ),
      writes: false,
      async run(input) {
        const corpus = await context.docs();
        const query = stringArg(input, "query") ?? "";

        return {
          query,
          files: corpus.files.length,
          hits: searchDocs(corpus, query, {
            limit: integerArg(input, "limit", 8),
            package: stringArg(input, "package"),
          }),
        };
      },
    },
    {
      name: "docs_read",
      description:
        "Read one file returned by docs_search (a skill, README or llms file of an installed @warlock.js package), whole or one section by its heading. Only files of that corpus can be read. Read-only.",
      input: inputSchema(
        {
          file: { type: "string", description: "The `file` of a docs_search hit." },
          heading: { type: "string", description: "Only the section with this exact heading." },
        },
        ["file"],
      ),
      writes: false,
      async run(input) {
        const corpus = await context.docs();
        const file = stringArg(input, "file") ?? "";
        const found = readDocsFile(corpus, context.cwd, file, {
          heading: stringArg(input, "heading"),
        });

        if (!found)
          throw new Error(
            `"${file}" is not an installed docs file (or has no such heading). Use docs_search first.`,
          );

        return found;
      },
    },
    {
      name: "explain",
      description:
        "Explain a stable Warlock error code (WL3001, WL7301, WL8003, …): what it means, whether it is your code or this machine, the one-line fix, the skill that covers it and its docs link. Without a code, lists every code. Read-only.",
      input: inputSchema({ code: { type: "string", description: "The code, e.g. WL3001." } }),
      writes: false,
      async run(input) {
        const code = stringArg(input, "code");

        if (!code) {
          return Object.values(ERROR_CODES).map((definition) => ({
            code: definition.code,
            title: definition.title,
            category: definition.category,
          }));
        }

        const definition = explainErrorCode(code);

        if (!definition)
          throw new Error(
            `Unknown error code "${code}". Call explain without a code to list them.`,
          );

        return {
          ...definition,
          docs: isWarlockErrorCode(definition.code) ? errorCodeDocsUrl(definition.code) : null,
        };
      },
    },
    {
      name: "check_run",
      description:
        "Run `warlock check`: typecheck, lint, the affected tests and the framework convention checks, as one report with one problem per entry (stable WL code, file:line, fix hint, skill). exitCode 1 means your code, 2 means this machine (missing service, Node version, crashed tool) — do not edit code for a 2. Use changed: true while iterating. Does not write project files.",
      input: inputSchema({
        changed: {
          type: "boolean",
          description: "Only the files changed against HEAD (plus untracked) and what they affect.",
        },
        base: {
          type: "string",
          description: "Compare with the merge base of this git ref instead (implies changed).",
        },
        skip: {
          type: "array",
          description: "Steps to skip.",
          items: { type: "string", enum: CHECK_STEPS },
        },
      }),
      writes: false,
      async run(input) {
        const skip = (stringsArg(input, "skip") ?? []).filter((step): step is CheckStepName =>
          (CHECK_STEPS as readonly string[]).includes(step),
        );

        return context.check({
          changed: booleanArg(input, "changed"),
          base: stringArg(input, "base"),
          skip,
        });
      },
    },
    {
      name: "test_run",
      description:
        "Run the app's vitest tests: given test files run as they are; given source files, the tests that import them run (vitest related); changed: true runs the tests related to the files changed in git; neither runs the whole suite. Returns totals and one problem per failure (WL7301 failed test, WL7302 file failed to load, WL8xxx this machine). Does not write project files.",
      input: inputSchema({
        files: {
          type: "array",
          description: "Project-relative files (tests or sources).",
          items: { type: "string" },
        },
        changed: {
          type: "boolean",
          description: "The tests related to the files changed against HEAD.",
        },
        base: {
          type: "string",
          description: "With changed: compare with the merge base of this ref.",
        },
      }),
      writes: false,
      async run(input) {
        return context.tests({
          files: stringsArg(input, "files"),
          changed: booleanArg(input, "changed"),
          base: stringArg(input, "base"),
        });
      },
    },
    {
      name: "requests_recent",
      description:
        "The most recent HTTP requests the running dev server handled, from @warlock.js/devtools (needs `warlock dev` with devtools installed): method, path, matched route, status, duration, and — with details — the phase timeline (route match, each middleware, validation, handler), every query with its duration and an nPlusOne flag, N+1 warnings, logs, cache operations and captured mails. Request and response bodies are not recorded by devtools; use `warlock trace` for those. Read-only.",
      input: inputSchema({
        limit: {
          type: "integer",
          description: "How many requests (default 10, newest first).",
          minimum: 1,
          maximum: 50,
        },
        method: { type: "string", description: "Only this HTTP method." },
        path: { type: "string", description: "Only paths containing this text." },
        status: {
          type: "integer",
          description: "Only this response status.",
          minimum: 100,
          maximum: 599,
        },
        details: {
          type: "boolean",
          description: "Include the full timeline of each request (default true).",
        },
      }),
      writes: false,
      async run(input) {
        const devtools = await context.devtools();
        const method = stringArg(input, "method")?.toUpperCase();
        const pathFilter = stringArg(input, "path");
        const status = typeof input.status === "number" ? input.status : undefined;
        const details = input.details !== false;
        const summaries = (await devtools.listRequests())
          .filter(
            (summary) =>
              (!method || summary.method === method) &&
              (!pathFilter || summary.path.includes(pathFilter)) &&
              (status === undefined || summary.status === status),
          )
          .sort((first, second) => second.startedAt - first.startedAt)
          .slice(0, integerArg(input, "limit", 10));
        const requests = [];

        for (const summary of summaries) {
          requests.push(
            summarizeRequest(summary, details ? await devtools.getRequest(summary.id) : undefined),
          );
        }

        return { devtools: { url: devtools.url, path: devtools.devtoolsPath }, requests };
      },
    },
    {
      name: "generate_make",
      description: `Run a \`warlock generate.<generator>\` scaffold (${MCP_MAKE_GENERATORS.join(", ")}) and return the unified diff of every file it would create or change. By default nothing in the project is written: the generator runs in a throw-away copy.${context.allowWrites ? " Pass write: true to write the files into the project." : " This server is read-only (no --allow-writes)."} Names are module/name for everything but module (e.g. posts/create-post) and the model path for migration.`,
      input: inputSchema(
        {
          generator: { type: "string", description: "Which generator.", enum: MCP_MAKE_GENERATORS },
          name: {
            type: "string",
            description:
              "The generator's argument: `posts` for module, `posts/create-post` for the others, the model path for migration.",
          },
          ...MAKE_FLAGS,
          ...(context.allowWrites ? writeProperty() : {}),
        },
        ["generator", "name"],
      ),
      writes: context.allowWrites,
      precheck: refuseWrite(context),
      async run(input) {
        const spec = makeSpecFromInput(input);

        return input.write === true
          ? context.generation.apply(spec)
          : context.generation.plan(spec);
      },
    },
    {
      name: "generate_add",
      description: `Run \`warlock add <features…>\` (an installable framework feature: a database driver, queue, web, devtools, …) and return the unified diff of every file it would create or change, package.json included. Dependencies are recorded, never installed, in the preview.${context.allowWrites ? " Pass write: true to apply it to the project (this installs the dependencies)." : " This server is read-only (no --allow-writes)."}`,
      input: inputSchema(
        {
          features: {
            type: "array",
            description: "Feature names, e.g. ['devtools'].",
            items: context.features?.length
              ? { type: "string", enum: context.features }
              : { type: "string" },
          },
          ...(context.allowWrites ? writeProperty() : {}),
        },
        ["features"],
      ),
      writes: context.allowWrites,
      precheck: refuseWrite(context),
      async run(input) {
        const features = stringsArg(input, "features") ?? [];

        if (features.length === 0) throw new Error("generate_add needs at least one feature name.");

        const spec: GeneratorSpec = { type: "add", features };

        return input.write === true
          ? context.generation.apply(spec)
          : context.generation.plan(spec);
      },
    },
  ];

  return tools;
}

/** The message a tool failure reaches the client with: code, message and the fix. */
export function describeToolError(error: unknown): string {
  if (error instanceof WarlockError) {
    return `${error.code}: ${error.message} Fix: ${ERROR_CODES[error.code].fix}`;
  }

  return error instanceof Error ? error.message : String(error);
}
