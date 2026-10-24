import baseConfig from "@mongez/config";
import events from "@mongez/events";
import { Model, removeModelFromRegistery, registerModelInRegistry } from "@warlock.js/cascade";
import { v } from "@warlock.js/seal";
import Ajv2020 from "ajv/dist/2020";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineResource } from "../../resource/define-resource";
import { router } from "../../router/router";
import { isUnguardedMutatingRoute, markAuthGuard } from "../../router/unguarded-route-diagnostics";
import { renderAgentsMdSection } from "../agents-md/render-agents-md";
import type { RequestHandler, Route } from "../../router/types";
import { EventRecorder } from "./event-recorder";
import { inspectApp, parseInspectSections } from "./inspect-app";
import { INSPECT_REPORT_JSON_SCHEMA } from "./inspect-report.schema";
import { INSPECT_SECTIONS, type InspectReport } from "./inspect-report.types";

/**
 * `inspectApp()` against a small in-process fixture app: real Seal schemas,
 * a real Cascade model and resource, a guard carrying the `warlock.auth`
 * descriptor, config loaded through `@mongez/config` and listeners recorded
 * from a module import. The output is validated against the published JSON
 * Schema, so the schema and the code cannot drift apart.
 */

const AUTH = Symbol.for("warlock.auth");

const PostResource = defineResource({
  schema: { id: "number", title: "string", createdAt: "date" },
});

class Post extends Model {
  public static table = "posts";

  public static resource = PostResource;

  public static schema = v.object({
    title: v.string().required(),
    views: v.int().optional(),
  });

  public static relations = {
    author: { type: "belongsTo", model: "InspectAuthor", foreignKey: "authorId", localKey: "id" },
  } as const;
}

function authGuard() {
  return undefined;
}

Object.defineProperty(authGuard, AUTH, { value: { sources: ["header"], userTypes: ["user"] } });

function auditTrail() {
  return undefined;
}

const updatePost: RequestHandler = async () => undefined;

updatePost.validation = {
  schema: v.object({ title: v.string().required(), draft: v.boolean().optional() }),
};
updatePost.responseSchema = { 200: { body: { post: PostResource } } };

const listPosts: RequestHandler = async () => undefined;

function route(overrides: Partial<Route> & Pick<Route, "method" | "path" | "handler">): Route {
  return { $prefix: "/", $prefixStack: [], sourceFile: "src/app/posts/routes.ts", ...overrides };
}

const routes: Route[] = [
  route({
    method: "PATCH",
    path: "/posts/:id",
    handler: updatePost,
    name: "posts.update",
    middleware: [authGuard, auditTrail],
    rateLimit: { max: 5, timeWindow: 60_000 },
    logging: { body: false },
  }),
  route({ method: "GET", path: "/posts", handler: listPosts, name: "posts.list", csrf: false }),
  route({
    method: "POST",
    path: "/posts",
    handler: listPosts,
    name: "posts.create",
    rateLimit: true,
  }),
  route({
    method: "DELETE",
    path: "/posts/:id",
    handler: listPosts,
    name: "posts.delete",
    rateLimit: false,
  }),
];

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-inspect-"));
  mkdirSync(path.join(root, "src", "config"), { recursive: true });
  writeFileSync(path.join(root, "src", "config", "http.ts"), "export default {};");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "shop", version: "2.1.0" }),
  );
  mkdirSync(path.join(root, "node_modules", "@warlock.js", "core"), { recursive: true });
  writeFileSync(
    path.join(root, "node_modules", "@warlock.js", "core", "package.json"),
    JSON.stringify({ name: "@warlock.js/core", version: "5.31.0" }),
  );
  registerModelInRegistry("InspectPost", Post);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  removeModelFromRegistery("InspectPost");
  baseConfig.unset(["http"]);
});

async function inspectFixture(sections = [...INSPECT_SECTIONS]): Promise<InspectReport> {
  baseConfig.set("http", {
    port: 3000,
    rateLimit: { max: 100, duration: 30_000 },
    logging: { query: false },
    cookies: { secret: "do-not-print-me" },
  });

  const recorder = new EventRecorder().start([events]);

  Reflect.set(globalThis, "__currentModuleFile", { relativePath: "src/app/posts/events/audit.ts" });

  try {
    events.subscribe("post.published", function notifyFollowers() {
      return undefined;
    });
  } finally {
    Reflect.set(globalThis, "__currentModuleFile", undefined);
    recorder.stop();
  }

  events.unsubscribe("post.published");

  return inspectApp({
    cwd: root,
    sections,
    routes,
    modelModules: [{ file: "src/app/posts/models/post.model.ts", exports: { Post } }],
    events: recorder.list(),
    moduleFailures: [{ file: "src/app/broken/routes.ts", message: "boom" }],
    pages: [
      {
        path: "/blog",
        name: "blog",
        file: path.join(root, "src/app/web/blog.page.tsx"),
        actions: ["default"],
      },
    ],
    config: baseConfig.get("http") ? { http: baseConfig.get("http") } : {},
    importFromApp: async () => undefined,
    resolveResourceName: (resource) => (resource === PostResource ? "PostResource" : undefined),
    now: () => new Date("2026-10-17T00:00:00.000Z"),
  });
}

describe("inspectApp", () => {
  it("validates against the published JSON Schema", async () => {
    const report = await inspectFixture();
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = ajv.compile(INSPECT_REPORT_JSON_SCHEMA);

    expect(validate(report), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(report.schemaVersion).toBe(1);
    expect(report.sections).toEqual([...INSPECT_SECTIONS]);
  });

  it("ships a JSON Schema file identical to the exported constant", () => {
    const file = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../schemas/inspect-report.schema.json"), "utf8"),
    );

    expect(file).toEqual(INSPECT_REPORT_JSON_SCHEMA);
  });

  it("describes a route's chain, guard, limits, logging and schemas", async () => {
    const report = await inspectFixture();
    const update = report.routes?.find((entry) => entry.name === "posts.update");
    const list = report.routes?.find((entry) => entry.name === "posts.list");

    expect(report.routes?.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      "GET /posts",
      "POST /posts",
      "PATCH /posts/:id",
      "DELETE /posts/:id",
    ]);
    expect(update).toMatchObject({
      handler: "updatePost",
      sourceFile: "src/app/posts/routes.ts",
      middleware: ["authGuard", "auditTrail"],
      auth: { required: true, sources: ["header"], userTypes: ["user"] },
      csrf: true,
      rateLimit: { source: "route", max: 5, timeWindow: 60_000 },
      logging: { body: false, query: false, privateRules: false },
    });
    expect(update?.request.parameters.map((parameter) => parameter.name)).toEqual(["id"]);
    expect(update?.request.body).toMatchObject({
      type: "object",
      properties: { title: { type: "string" }, draft: { type: "boolean" } },
      required: ["title"],
    });
    expect(update?.responses["200"]?.schema).toMatchObject({
      properties: { post: { $ref: "#/components/schemas/PostResource" } },
    });
    expect(list).toMatchObject({
      auth: { required: false },
      csrf: false,
      rateLimit: { source: "global", max: 100, timeWindow: 30_000 },
      logging: { body: true, query: false },
    });
    // `rateLimit: true` keeps the global policy; `false` exempts the route from it.
    expect(report.routes?.find((entry) => entry.name === "posts.create")?.rateLimit).toEqual({
      source: "global",
      max: 100,
      timeWindow: 30_000,
    });
    expect(report.routes?.find((entry) => entry.name === "posts.delete")?.rateLimit).toEqual({
      source: "none",
      max: null,
      timeWindow: null,
    });
  });

  it("describes models with columns, relations and their resource", async () => {
    const report = await inspectFixture();

    expect(report.models).toEqual([
      expect.objectContaining({
        name: "InspectPost",
        table: "posts",
        registered: true,
        sourceFile: "src/app/posts/models/post.model.ts",
        resource: "PostResource",
        relations: [
          {
            name: "author",
            type: "belongsTo",
            model: "InspectAuthor",
            foreignKey: "authorId",
            localKey: "id",
          },
        ],
      }),
    ]);
    expect(report.models?.[0]?.columns.map((column) => [column.name, column.required])).toEqual([
      ["title", true],
      ["views", false],
    ]);
    expect(report.resources).toEqual([
      expect.objectContaining({ name: "PostResource", models: ["InspectPost"] }),
    ]);
    expect(report.components.schemas.PostResource).toMatchObject({
      type: "object",
      properties: { id: { type: "number" }, title: { type: "string" } },
    });
  });

  it("lists config keys with types and never their values", async () => {
    const report = await inspectFixture();

    expect(report.config).toContainEqual({
      key: "http.port",
      type: "number",
      file: "src/config/http.ts",
    });
    expect(report.config).toContainEqual({
      key: "http.cookies.secret",
      type: "string",
      file: "src/config/http.ts",
    });
    expect(JSON.stringify(report)).not.toContain("do-not-print-me");
  });

  it("reports listeners, pages, packages and boot failures", async () => {
    const report = await inspectFixture();

    expect(report.events).toEqual([
      {
        event: "post.published",
        listeners: [{ name: "notifyFollowers", sourceFile: "src/app/posts/events/audit.ts" }],
      },
    ]);
    expect(report.pages).toEqual([
      {
        path: "/blog",
        name: "blog",
        file: "src/app/web/blog.page.tsx",
        layouts: [],
        loaders: [],
        actions: ["default"],
        guard: null,
      },
    ]);
    expect(report.packages).toEqual([{ name: "@warlock.js/core", version: "5.31.0" }]);
    expect(report.jobs).toEqual([]);
    expect(report.schedules).toEqual([]);
    expect(report.app).toMatchObject({ name: "shop", version: "2.1.0", root });
    expect(report.warnings).toContainEqual({
      code: "WL2001",
      message: "src/app/broken/routes.ts failed to load: boom",
      source: "src/app/broken/routes.ts",
    });
  });

  it("includes only the requested sections", async () => {
    const report = await inspectFixture(["routes", "packages"]);

    expect(report.sections).toEqual(["routes", "packages"]);
    expect(report.routes).toHaveLength(4);
    expect(report.models).toBeUndefined();
    expect(report.config).toBeUndefined();
    // Resources reached from routes still resolve: the $refs point here.
    expect(Object.keys(report.components.schemas)).toEqual(["PostResource"]);
  });
});

describe("parseInspectSections", () => {
  it("parses a comma list in report order and defaults to every section", () => {
    expect(parseInspectSections("packages, routes")).toEqual(["routes", "packages"]);
    expect(parseInspectSections(undefined)).toEqual([...INSPECT_SECTIONS]);
  });

  it("refuses an unknown section and lists the valid ones", () => {
    expect(() => parseInspectSections("routes,controllers")).toThrow(
      "Unknown inspect section(s): controllers. Valid sections: routes, models,",
    );
  });
});

const sessionGuard = (optional: boolean) => {
  const middleware = markAuthGuard(async () => undefined, !optional);
  Object.defineProperty(middleware, AUTH, {
    value: {
      required: !optional,
      sources: [{ cookie: "access_token" }, "header"],
      userTypes: ["user"],
    },
  });
  return middleware;
};

describe("grouped session guard inspection", () => {
  it("keeps required groups out of unguarded writes and includes optional groups", async () => {
    const previous = router.list();
    Reflect.set(router, "routes", []);
    try {
      router.group({ prefix: "/account", middleware: [sessionGuard(false)] }, () => {
        router.group({ prefix: "/settings" }, () => router.post("/save", listPosts));
      });
      router.group({ middleware: [sessionGuard(true)] }, () =>
        router.post("/personalize", listPosts),
      );
      const registered = router.list();
      const report = await inspectApp({ sections: ["routes"], routes: registered });
      expect(report.routes?.find((entry) => entry.path === "/account/settings/save")?.auth).toEqual(
        {
          required: true,
          sources: [{ cookie: "access_token" }, "header"],
          userTypes: ["user"],
        },
      );
      expect(report.routes?.find((entry) => entry.path === "/personalize")?.auth.required).toBe(
        false,
      );
      expect(registered.filter(isUnguardedMutatingRoute).map((entry) => entry.path)).toEqual([
        "/personalize",
      ]);
      const summary = renderAgentsMdSection(report);
      const warning = summary
        .split("\n")
        .find((line) => line.startsWith("Mutating routes without"));
      expect(warning).toContain("POST /personalize");
      expect(warning).not.toContain("/account/settings/save");
    } finally {
      Reflect.set(router, "routes", previous);
    }
  });
});

describe("custom guard inspection", () => {
  it("counts a group middleware that declared itself a guard, with or without a descriptor", async () => {
    const previous = router.list();
    Reflect.set(router, "routes", []);
    try {
      // No `warlock.auth` descriptor and a name that says nothing about guards.
      const staffOnly = markAuthGuard(async () => undefined);
      router.group({ prefix: "/api/admin", middleware: [staffOnly] }, () => {
        router.post("/users", listPosts);
      });
      router.post("/api/open", listPosts);
      const registered = router.list();
      const report = await inspectApp({ sections: ["routes"], routes: registered });

      expect(report.routes?.find((entry) => entry.path === "/api/admin/users")?.auth.required).toBe(
        true,
      );
      const warning = renderAgentsMdSection(report)
        .split("\n")
        .find((line) => line.startsWith("Mutating routes without"));
      expect(warning).toContain("POST /api/open");
      expect(warning).not.toContain("/api/admin/users");
    } finally {
      Reflect.set(router, "routes", previous);
    }
  });
});
