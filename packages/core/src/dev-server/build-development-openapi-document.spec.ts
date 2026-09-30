import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  files: new Map<string, { absolutePath: string; relativePath: string }>(),
  devLogWarn: vi.fn(),
}));

vi.mock("./files-orchestrator", () => ({
  filesOrchestrator: { getFiles: () => hoisted.files },
}));
vi.mock("./dev-logger", () => ({ devLogWarn: hoisted.devLogWarn }));

import { router } from "../router/router";
import type { RequestHandler } from "../router/types";
import { buildDevelopmentOpenApiDocument } from "./build-development-openapi-document";

const handler = (): RequestHandler => (() => undefined) as unknown as RequestHandler;

describe("buildDevelopmentOpenApiDocument", () => {
  beforeEach(() => {
    (router as any).routes = [];
    hoisted.files.clear();
  });

  afterEach(() => {
    (router as any).routes = [];
  });

  it("documents the routes registered in this process", async () => {
    router.get("/ping", handler(), { name: "ping" });
    router.post("/orders", handler());

    const { document } = await buildDevelopmentOpenApiDocument();

    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual(["/orders", "/ping"]);
    expect(document.paths["/ping"].get.operationId).toBe("ping");
    expect(document.paths["/orders"].post).toBeDefined();
  });

  it("returns an empty document when no route is registered", async () => {
    const { document } = await buildDevelopmentOpenApiDocument();

    expect(document.paths).toEqual({});
  });
});
