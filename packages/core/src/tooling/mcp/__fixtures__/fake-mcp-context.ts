import { CHECK_EXIT_CODES, type CheckReport } from "../../check/check-report.types";
import type { TestRunReport } from "../../check/run-tests";
import type { DevtoolsClient } from "../../devtools/devtools-client";
import type { GeneratorSpec } from "../../generate";
import { INSPECT_SECTIONS, type InspectReport } from "../../inspect/inspect-report.types";
import type { DocsCorpus } from "../docs-search";
import type { WarlockMcpContext } from "../mcp-tools";

/**
 * A small fixture app as `inspectApp()` would describe it: one guarded PATCH,
 * one unguarded POST, one GET; a `Post` model with a `belongsTo` author.
 * Shared by the MCP specs and the stdio child script.
 */
export function fixtureReport(): InspectReport {
  const route = (method: string, path: string, name: string, guarded: boolean) => ({
    method,
    path,
    name,
    sourceFile: "src/app/posts/routes.ts",
    handler: `${name}Controller`,
    description: null,
    isPage: false,
    middleware: guarded ? ["authMiddleware"] : [],
    auth: { required: guarded, sources: guarded ? ["header" as const] : [], userTypes: [] },
    csrf: true,
    rateLimit: { source: "none" as const, max: null, timeWindow: null },
    logging: { body: true, query: true, privateRules: false },
    request: { parameters: [], body: null, customValidation: false },
    responses: {},
  });

  return {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    app: {
      name: "fixture-app",
      version: "1.0.0",
      root: "/fixture",
      node: "v22.15.0",
      environment: "development",
      runtimeStrategy: "development",
    },
    sections: [...INSPECT_SECTIONS],
    routes: [
      route("GET", "/posts", "posts.list", false),
      route("POST", "/posts", "posts.create", false),
      route("PATCH", "/posts/:id", "posts.update", true),
    ],
    models: [
      {
        name: "Post",
        table: "posts",
        primaryKey: "id",
        dataSource: null,
        sourceFile: "src/app/posts/models/post/post.model.ts",
        registered: true,
        columns: [
          { name: "id", required: true, schema: { type: "integer" } },
          { name: "title", required: true, schema: { type: "string" } },
          { name: "authorId", required: false, schema: { type: "integer" } },
          { name: "publishedAt", required: false, schema: { type: "string", format: "date-time" } },
        ],
        relations: [
          {
            name: "author",
            type: "belongsTo",
            model: "User",
            foreignKey: "authorId",
            localKey: "id",
          },
        ],
        resource: null,
        deleteStrategy: "trash",
        createdAtColumn: "createdAt",
        updatedAtColumn: "updatedAt",
        deletedAtColumn: null,
      },
    ],
    resources: [],
    wiring: [
      { type: "file", role: "config", file: "src/config/http.ts", module: "src/config", order: 1 },
      {
        type: "file",
        role: "main",
        file: "src/app/posts/main.ts",
        module: "src/app/posts",
        order: 2,
      },
      {
        type: "file",
        role: "route",
        file: "src/app/posts/routes.ts",
        module: "src/app/posts",
        order: 3,
      },
      {
        type: "capability",
        name: "posts.notifier",
        description: "Tells followers about a post",
        required: true,
        provided: true,
        definedIn: "src/app/posts/capabilities.ts",
        providedBy: "src/app/posts/main.ts",
        consumers: ["src/app/posts/services/publish.service.ts"],
      },
    ],
    config: [
      { key: "app.name", type: "string", file: "src/config/app.ts" },
      { key: "database.port", type: "number", file: "src/config/database.ts" },
    ],
    events: [],
    pages: [],
    jobs: [],
    schedules: [],
    packages: [{ name: "@warlock.js/core", version: "5.31.0" }],
    components: { schemas: {} },
    warnings: [],
  };
}

/** A clean `warlock check` report. */
export function cleanCheckReport(): CheckReport {
  return {
    schemaVersion: 1,
    ok: true,
    exitCode: CHECK_EXIT_CODES.ok,
    changed: false,
    files: null,
    steps: [],
    problems: [],
    summary: { errors: 0, warnings: 0, code: 0, environment: 0 },
  };
}

/** A fake devtools client holding one request with an N+1. */
export function fakeDevtools(): DevtoolsClient {
  const summary = {
    id: "req-1",
    method: "GET",
    path: "/posts",
    route: "/posts",
    status: 200,
    startedAt: 10,
    durationMs: 12,
    queryCount: 2,
    warningCount: 1,
  };
  const record = {
    ...summary,
    phases: [
      { name: "middleware", startedAt: 10, durationMs: 1, attrs: { name: "auth", index: 0 } },
      { name: "handler", startedAt: 11, durationMs: 9 },
    ],
    queries: [
      { id: "q1", sql: "select * from posts", shape: "select * from posts", durationMs: 2 },
      { id: "q2", sql: "select * from users where id = $1", shape: "users-by-id", durationMs: 1 },
    ],
    cache: [],
    logs: [{ level: "info", module: "posts", action: "list", message: "listed", at: 11 }],
    mails: [],
    warnings: [{ type: "n+1", message: "N+1", shape: "users-by-id", count: 6 }],
  };

  return {
    url: "http://localhost:9",
    devtoolsPath: "/__warlock",
    listRequests: async () => [summary, { ...summary, id: "req-0", startedAt: 1, path: "/health" }],
    getRequest: async (id) => (id === "req-1" ? record : undefined),
    waitForRequest: async () => record,
  };
}

/** Everything the fake context recorded, for assertions. */
export type FakeContextCalls = {
  plans: GeneratorSpec[];
  applies: GeneratorSpec[];
  tests: unknown[];
  checks: unknown[];
};

/** A {@link WarlockMcpContext} backed by fixtures. */
export function fakeMcpContext(
  options: { allowWrites?: boolean; corpus?: DocsCorpus; cwd?: string } = {},
): { context: WarlockMcpContext; calls: FakeContextCalls } {
  const calls: FakeContextCalls = { plans: [], applies: [], tests: [], checks: [] };
  const corpus: DocsCorpus = options.corpus ?? { files: [], sections: [] };

  const context: WarlockMcpContext = {
    cwd: options.cwd ?? "/fixture",
    allowWrites: options.allowWrites === true,
    inspect: async (sections) => {
      const report = fixtureReport();

      return { ...report, sections: [...sections] };
    },
    check: async (input) => {
      calls.checks.push(input);
      return cleanCheckReport();
    },
    tests: async (input) => {
      calls.tests.push(input);
      const report: TestRunReport = {
        schemaVersion: 1,
        ok: true,
        exitCode: 0,
        mode: "files",
        files: input.files ? [...input.files] : null,
        args: [],
        total: 1,
        passed: 1,
        failed: 0,
        problems: [],
      };
      return report;
    },
    devtools: async () => fakeDevtools(),
    generation: {
      plan: async (spec) => {
        calls.plans.push(spec);
        return {
          spec,
          ok: true,
          files: [{ path: "src/app/posts/services/x.service.ts", status: "created", diff: "+x" }],
        };
      },
      apply: async (spec) => {
        calls.applies.push(spec);
        return { spec, ok: true, files: [] };
      },
    },
    docs: async () => corpus,
    features: ["devtools", "queue"],
  };

  return { context, calls };
}
