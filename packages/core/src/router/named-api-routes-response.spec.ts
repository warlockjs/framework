import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAppModuleImporter } from "../loader/app-module-importer";
import { collectNamedApiRoutesWithResponses } from "./named-api-routes-with-responses";
import { router } from "./router";
import type { RequestHandler } from "./types";

const appRoot = resolve("/work/app");
const userFile = resolve(appRoot, "src/app/users/resources/user.resource.ts");

class UserResource {}

const schema = {
  200: { body: { user: UserResource, token: "string" } },
  400: { body: { error: "string" } },
} as const;

/**
 * Return the item at `index`, or throw so a missing route fails the spec instead of narrowing with `!`.
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`Expected an item at index ${index}, got ${items.length} item(s).`);
  }

  return item;
}

const handler = (): RequestHandler => (() => undefined) as unknown as RequestHandler;

const declared = (): RequestHandler => {
  const target = handler();

  target.responseSchema = schema as unknown as RequestHandler["responseSchema"];

  return target;
};

describe("responseSchema on bound handlers", () => {
  beforeEach(() => {
    (router as any).routes = [];
  });

  afterEach(() => {
    (router as any).routes = [];
  });

  it("copies responseSchema onto an array [controller, action] handler", () => {
    const controller = {
      login: declared(),
      logout: handler(),
    };

    router.post("/login", [controller, "login"] as any, { name: "login" });
    router.post("/logout", [controller, "logout"] as any, { name: "logout" });

    const routesList = router.list();
    const login = at(routesList, 0);
    const logout = at(routesList, 1);

    expect(login.handler).not.toBe(controller.login);
    expect(login.handler.responseSchema).toBe(controller.login.responseSchema);
    expect(logout.handler.responseSchema).toBeUndefined();
  });

  it("copies responseSchema onto every restful resource route", () => {
    const resource = {
      list: declared(),
      get: declared(),
      create: declared(),
      update: declared(),
      patch: declared(),
      delete: declared(),
      bulkDelete: declared(),
      validation: { create: { validate: () => undefined } },
    };

    router.restfulResource("/users", resource as any);

    const routes = router.list();

    expect(routes).toHaveLength(7);

    for (const route of routes) {
      expect(route.handler.responseSchema, route.name).toBe(schema);
    }
  });

  it("leaves a restful route without a declared schema untouched", () => {
    router.restfulResource("/users", { list: handler() } as any);

    expect(at(router.list(), 0).handler.responseSchema).toBeUndefined();
  });
});

describe("router.getNamedApiRoutes responses", () => {
  beforeEach(() => {
    (router as any).routes = [];
  });

  afterEach(() => {
    (router as any).routes = [];
  });

  it("keeps the exact three-key record when no schema is declared or no resolver is given", () => {
    router.get("/ping", handler(), { name: "ping" });
    router.post("/login", declared(), { name: "login" });

    expect(router.getNamedApiRoutes()).toEqual([
      { name: "ping", path: "/ping", method: "GET" },
      { name: "login", path: "/login", method: "POST" },
    ]);
    expect(Object.keys(at(router.getNamedApiRoutes(), 1))).toEqual(["name", "path", "method"]);
  });

  it("adds response only to routes that declare a schema and the resolver describes", () => {
    router.get("/ping", handler(), { name: "ping" });
    router.post("/login", declared(), { name: "login" });

    const routes = router.getNamedApiRoutes({
      resolveResponse: () => ({ "200": "{ }" }),
    });

    expect(Object.keys(at(routes, 0))).toEqual(["name", "path", "method"]);
    expect(at(routes, 1)).toEqual({ name: "login", path: "/login", method: "POST", response: { "200": "{ }" } });
    expect(Object.isFrozen(at(routes, 1).response)).toBe(true);
  });

  it("omits response when the resolver has nothing to say", () => {
    router.post("/login", declared(), { name: "login" });

    const routes = router.getNamedApiRoutes({ resolveResponse: () => undefined });

    expect(Object.keys(at(routes, 0))).toEqual(["name", "path", "method"]);
  });
});

describe("collectNamedApiRoutesWithResponses", () => {
  const importer = vi.fn(async (url: string) => {
    if (fileURLToPath(url) === userFile) return { userResource: UserResource };

    throw new Error(`unexpected import ${url}`);
  });

  beforeEach(() => {
    (router as any).routes = [];
    importer.mockClear();
    setAppModuleImporter(importer);
  });

  afterEach(() => {
    (router as any).routes = [];
    setAppModuleImporter(undefined);
  });

  const files = [
    { absolutePath: userFile, relativePath: "src/app/users/resources/user.resource.ts" },
    { absolutePath: resolve(appRoot, "src/app/users/models/user.model.ts"), relativePath: "src/app/users/models/user.model.ts" },
  ];

  it("maps resources by identity and produces the documented strings", async () => {
    router.get("/ping", handler(), { name: "ping" });
    router.post("/login", declared(), { name: "login" });

    const routes = await collectNamedApiRoutesWithResponses({ appRoot, files });

    expect(Object.keys(at(routes, 0))).toEqual(["name", "path", "method"]);
    expect(at(routes, 1).response).toEqual({
      "200": `{ "user": import("@warlock.js/core").ResourceOutput<typeof import("../../src/app/users/resources/user.resource")["userResource"]>; "token": import("@warlock.js/core").CastOutput<"string"> }`,
      "400": `{ "error": import("@warlock.js/core").CastOutput<"string"> }`,
    });
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("imports no resource module when no route declares a schema", async () => {
    router.get("/ping", handler(), { name: "ping" });

    await collectNamedApiRoutesWithResponses({ appRoot, files });

    expect(importer).not.toHaveBeenCalled();
  });

  it("types an unmapped resource as unknown and warns with the route", async () => {
    router.post("/login", declared(), { name: "login" });
    const onWarn = vi.fn();

    const routes = await collectNamedApiRoutesWithResponses({ appRoot, files: [], onWarn });

    expect(at(routes, 0).response?.["200"]).toContain(`"user": unknown`);
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('Route "login"'));
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("200.body.user"));
  });

  it("survives an unimportable resource file with a warning", async () => {
    router.post("/login", declared(), { name: "login" });
    const onWarn = vi.fn();
    setAppModuleImporter(async () => {
      throw new Error("syntax error");
    });

    const routes = await collectNamedApiRoutesWithResponses({ appRoot, files, onWarn });

    expect(at(routes, 0).response?.["200"]).toContain(`"user": unknown`);
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("syntax error"));
  });
});
