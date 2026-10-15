import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { RegistrationChildProcess } from "../production/registration-child-runner";
import { collectOpenApiDocument } from "./collect-openapi-document";

class FakeChild extends EventEmitter {
  public connected = true;
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public readonly send = vi.fn();
  public readonly kill = vi.fn();
  public readonly disconnect = vi.fn(() => {
    this.connected = false;
  });
}

const document = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: { title: "app", version: "1.0.0" },
  paths: {},
};

function collect(child: FakeChild, options: Parameters<typeof collectOpenApiDocument>[0] = {}) {
  return collectOpenApiDocument({
    cwd: "C:/app",
    forkProcess: () => child as unknown as RegistrationChildProcess,
    ...options,
  });
}

describe("collectOpenApiDocument", () => {
  it("sends the OpenAPI request options to the registration child and returns the document", async () => {
    const child = new FakeChild();
    const result = collect(child, { title: "Shop", server: "https://api.shop.test", includePages: true });

    child.emit("message", { type: "route-registration:progress", module: "src/app/users/routes.ts" });
    child.emit("message", {
      type: "openapi-registration:document",
      result: { version: 1, document, warnings: ["GET /x: something"] },
    });
    child.emit("close", 0);

    await expect(result).resolves.toEqual({ version: 1, document, warnings: ["GET /x: something"] });
    expect(child.send).toHaveBeenCalledWith({
      version: 1,
      cwd: "C:/app",
      environment: undefined,
      runtimeStrategy: undefined,
      openapi: { version: 1, title: "Shop", server: "https://api.shop.test", includePages: true },
    });
  });

  it("sends only the options that were given", async () => {
    const child = new FakeChild();
    const result = collect(child);

    child.emit("message", {
      type: "openapi-registration:document",
      result: { version: 1, document, warnings: [] },
    });
    child.emit("close", 0);
    await result;

    expect(child.send).toHaveBeenCalledWith(
      expect.objectContaining({ openapi: { version: 1 } }),
    );
  });

  it.each([
    ["no result", undefined],
    ["a wrong version", { version: 2, document, warnings: [] }],
    ["a missing document", { version: 1, warnings: [] }],
    ["a document without paths", { version: 1, document: { openapi: "3.1.0" }, warnings: [] }],
    ["non-string warnings", { version: 1, document, warnings: [1] }],
  ])("refuses a payload with %s", async (_label, payload) => {
    const child = new FakeChild();
    const result = collect(child);

    child.emit("message", { type: "openapi-registration:document", result: payload });

    await expect(result).rejects.toThrow("invalid OpenAPI document payload");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("does not accept a route snapshot as the answer", async () => {
    const child = new FakeChild();
    const result = collect(child);

    child.emit("message", {
      type: "route-registration:snapshot",
      snapshot: { version: 1, routes: [] },
    });
    child.emit("close", 0);

    await expect(result).rejects.toThrow("without a valid document");
  });

  it("surfaces a child failure", async () => {
    const child = new FakeChild();
    const result = collect(child);

    child.emit("message", { type: "route-registration:error", message: "boom" });

    await expect(result).rejects.toThrow("Route registration child failed: boom");
  });

  it("keeps the child on the same app loading path and only branches on the request", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../production/route-registration-child.ts", import.meta.url)),
      "utf8",
    );
    const loadAt = source.indexOf("filesOrchestrator.moduleLoader.loadAll(");
    const branchAt = source.indexOf("if (request.openapi)");
    const snapshotAt = source.indexOf("collectNamedApiRoutesWithResponses({");

    expect(loadAt).toBeGreaterThan(-1);
    expect(branchAt).toBeGreaterThan(loadAt);
    expect(snapshotAt).toBeGreaterThan(branchAt);
  });
});
