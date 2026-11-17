import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildOpenApiDocument, openApiToPostmanCollection } from "@warlock.js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionOpenApi } from "../../src/production/openapi";

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

/** Core as `warlock start` has it: routes registered, no development OpenAPI provider. */
function fakeCore(routes: unknown[]) {
  root = mkdtempSync(path.join(tmpdir(), "devtools-openapi-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "shop-api", version: "2.1.0" }));

  const build = vi.fn(buildOpenApiDocument);
  const values: Record<string, unknown> = { "app.baseUrl": "https://shop.example" };

  return {
    build,
    core: {
      router: { list: () => routes },
      buildOpenApiDocument: build,
      openApiToPostmanCollection,
      config: { get: (key: string, fallback?: unknown) => values[key] ?? fallback },
      rootPath: (...parts: string[]) => path.join(root, ...parts),
    } as never,
  };
}

describe("the API tab's documents in production", () => {
  it("builds the OpenAPI document from the registered routes, once per process", async () => {
    const { core, build } = fakeCore([
      { method: "get", path: "/notes", handler: () => null },
      { method: "post", path: "/notes", handler: () => null },
    ]);
    const openApi = createProductionOpenApi(core);
    const document = (await openApi.getOpenApiDocument()) as {
      info: { title: string; version: string };
      servers?: { url: string }[];
      paths: Record<string, Record<string, unknown>>;
    };

    expect(document.info).toMatchObject({ title: "shop-api", version: "2.1.0" });
    expect(document.servers?.[0]?.url).toBe("https://shop.example");
    expect(Object.keys(document.paths["/notes"] ?? {}).sort()).toEqual(["get", "post"]);

    await openApi.getOpenApiDocument();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("derives the Postman collection from the same document", async () => {
    const { core } = fakeCore([{ method: "get", path: "/hello", handler: () => null }]);
    const collection = (await createProductionOpenApi(core).getPostmanCollection()) as {
      info: { name: string };
      item: unknown[];
    };

    expect(collection.info.name).toBe("shop-api");
    expect(JSON.stringify(collection.item)).toContain("hello");
  });
});
