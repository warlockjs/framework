import config from "@mongez/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  routes: [] as unknown[],
  resourceMap: new Map<unknown, { file: string; exportName: string }>(),
  collectResourceExportMap: vi.fn(),
}));

vi.mock("../router/router", () => ({ router: { list: () => hoisted.routes } }));
vi.mock("../router/named-api-routes-with-responses", () => ({
  collectResourceExportMap: hoisted.collectResourceExportMap,
}));

import { buildOpenApiForChild, resolveDefaultServer } from "./openapi-child-output";

class UserResource {
  public static schema = { id: "number" };
}

const handler = (props: object = {}) => Object.assign(() => undefined, props);

describe("buildOpenApiForChild", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "warlock-openapi-"));
    hoisted.routes = [];
    hoisted.collectResourceExportMap.mockReset();
    hoisted.collectResourceExportMap.mockResolvedValue(hoisted.resourceMap);
    hoisted.resourceMap.clear();
    config.set("http", { host: "0.0.0.0", port: 4100 });
    config.set("validation.response", {});
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("reads info from the app package.json and the server from the http config", async () => {
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "shop-api", version: "2.3.4", description: "The shop" }),
    );
    hoisted.routes = [{ method: "GET", path: "/health", handler: handler() }];

    const { document } = await buildOpenApiForChild({
      cwd,
      files: [],
      request: { version: 1 },
    });

    expect(document.info).toEqual({ title: "shop-api", version: "2.3.4", description: "The shop" });
    expect(document.servers).toEqual([{ url: "http://localhost:4100" }]);
    expect(Object.keys(document.paths)).toEqual(["/health"]);
  });

  it("lets the request override title and server, and falls back without a package.json", async () => {
    const { document } = await buildOpenApiForChild({
      cwd,
      files: [],
      request: { version: 1, title: "Custom", server: "https://api.example.com" },
    });

    expect(document.info).toEqual({ title: "Custom", version: "0.0.0" });
    expect(document.servers).toEqual([{ url: "https://api.example.com" }]);
  });

  it("names resources by their export and only imports resource modules when a route declares a schema", async () => {
    hoisted.resourceMap.set(UserResource, { file: "/app/user.resource.ts", exportName: "UserResource" });
    hoisted.routes = [{ method: "GET", path: "/plain", handler: handler() }];

    await buildOpenApiForChild({ cwd, files: [], request: { version: 1 } });

    expect(hoisted.collectResourceExportMap).not.toHaveBeenCalled();

    hoisted.routes = [
      {
        method: "GET",
        path: "/me",
        handler: handler({ responseSchema: { 200: { body: { user: UserResource } } } }),
      },
    ];

    const { document } = await buildOpenApiForChild({ cwd, files: [], request: { version: 1 } });

    expect(hoisted.collectResourceExportMap).toHaveBeenCalledOnce();
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(["UserResource"]);
  });

  it("passes includePages and the validation.response config through", async () => {
    config.set("validation.response", { errors: "problems", status: 400 });
    hoisted.routes = [
      { method: "GET", path: "/about", isPage: true, handler: handler() },
      {
        method: "POST",
        path: "/x",
        handler: handler({ validation: { schema: { toJsonSchema: () => ({ type: "object", properties: {} }) } } }),
      },
    ];

    const without = await buildOpenApiForChild({ cwd, files: [], request: { version: 1 } });
    const withPages = await buildOpenApiForChild({
      cwd,
      files: [],
      request: { version: 1, includePages: true },
    });

    expect(Object.keys(without.document.paths)).toEqual(["/x"]);
    expect(Object.keys(withPages.document.paths)).toEqual(["/about", "/x"]);
    expect(Object.keys(without.document.paths["/x"]?.post?.responses ?? {})).toEqual(["200", "400"]);
  });
});

describe("resolveDefaultServer", () => {
  it("uses the configured host unless it is a wildcard bind address", () => {
    config.set("http", { host: "api.local", port: 8080 });
    expect(resolveDefaultServer()).toBe("http://api.local:8080");

    config.set("http", { host: "::", port: 8080 });
    expect(resolveDefaultServer()).toBe("http://localhost:8080");
  });
});
