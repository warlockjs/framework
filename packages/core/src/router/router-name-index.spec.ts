import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RouteNameTakenError } from "./route-name-taken-error";
import { router } from "./router";

const SOURCE = "router-name-index.spec";
const handler = () => undefined;

afterEach(() => {
  router.removeRoutesBySourceFile(SOURCE);
  router.removeRoutesBySourceFile(`${SOURCE}:reloaded`);
});

describe("route names", () => {
  it("rejects a taken name on the same method and suffixes it on another", async () => {
    await router.withSourceFile(SOURCE, () => {
      router.get("/name-index/a", handler, { name: "nameIndex.a" });
      router.post("/name-index/a", handler, { name: "nameIndex.a" });
    });

    expect(router.getRoute("nameIndex.a")).toBe("/name-index/a");
    expect(
      router
        .list()
        .some((route) => route.name?.startsWith("nameIndex.a") && route.method === "POST"),
    ).toBe(true);

    await expect(
      router.withSourceFile(SOURCE, () => {
        router.get("/name-index/b", handler, { name: "nameIndex.a" });
      }),
    ).rejects.toBeInstanceOf(RouteNameTakenError);
  });

  it("resolves the new path after the route file is reloaded", async () => {
    await router.withSourceFile(SOURCE, () => {
      router.get("/name-index/old/:id", handler, { name: "nameIndex.reload" });
    });

    expect(router.getRoute("nameIndex.reload", { id: 1 })).toBe("/name-index/old/1");

    await router.replaceRoutesBySourceFiles([SOURCE], () =>
      router.withSourceFile(SOURCE, () => {
        router.get("/name-index/new/:id", handler, { name: "nameIndex.reload" });
      }),
    );

    expect(router.getRoute("nameIndex.reload", { id: 2 })).toBe("/name-index/new/2");

    router.removeRoutesBySourceFile(SOURCE);

    expect(() => router.getRoute("nameIndex.reload")).toThrow(/not found/);
  });

  it("lets a removed name be registered again", async () => {
    await router.withSourceFile(SOURCE, () => {
      router.get("/name-index/c", handler, { name: "nameIndex.c" });
    });

    router.removeRoutesBySourceFile(SOURCE);

    await router.withSourceFile(SOURCE, () => {
      router.get("/name-index/c2", handler, { name: "nameIndex.c" });
    });

    expect(router.getRoute("nameIndex.c")).toBe("/name-index/c2");
  });
});

describe("boot-time imports", () => {
  it("loads the proxy plugin only when a proxy route is declared", () => {
    const source = readFileSync(path.join(import.meta.dirname, "router.ts"), "utf8");

    expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+"@fastify\/http-proxy"/m);
    expect(source).toContain('import("@fastify/http-proxy")');
  });

  it("loads oxc-parser on first parse, not when the module is imported", async () => {
    const source = readFileSync(path.join(import.meta.dirname, "../tooling/syntax/ast.ts"), "utf8");

    expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+"oxc-parser"/m);

    const { parseSourceFile } = await import("../tooling/syntax/ast");
    const file = parseSourceFile("a.ts", "const answer: number = 42;");

    expect(file.type).toBe("Program");
    expect(file.body).toHaveLength(1);
  });
});
