import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  root: "",
  collectOpenApiDocument: vi.fn(),
}));

vi.mock("../../openapi/collect-openapi-document", () => ({
  collectOpenApiDocument: hoisted.collectOpenApiDocument,
}));
vi.mock("../../production/resolve-build-config", () => ({
  resolveBuildConfig: () => ({ routeRegistrationTimeoutMs: 45_000 }),
}));
vi.mock("../../utils/paths", () => ({ rootPath: () => hoisted.root }));

import { postmanGeneratorCommand } from "./postman-generator.command";

const document = {
  openapi: "3.1.0",
  info: { title: "app", version: "1.0.0" },
  servers: [{ url: "http://localhost:2030" }],
  paths: {
    "/users": {
      get: { operationId: "users.list", tags: ["users"], responses: { "200": { description: "Successful response" } } },
    },
    "/ping": { get: { operationId: "ping", responses: { "200": { description: "Successful response" } } } },
  },
};

describe("warlock generate.postman", () => {
  beforeEach(async () => {
    hoisted.root = await mkdtemp(path.join(tmpdir(), "warlock-postman-cli-"));
    hoisted.collectOpenApiDocument.mockReset();
    hoisted.collectOpenApiDocument.mockResolvedValue({ version: 1, document, warnings: ["GET /a: gap"] });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(hoisted.root, { recursive: true, force: true });
  });

  it("is registered as a framework command with the documented options", async () => {
    const registry = await readFile(
      path.resolve(__dirname, "../framework-cli-commands.ts"),
      "utf8",
    );

    expect(registry).toMatch(/frameworkCommands = \[[\s\S]*postmanGeneratorCommand,/);
    expect(postmanGeneratorCommand.name).toBe("generate.postman");
    expect(postmanGeneratorCommand.commandOptions.map((option) => option.name)).toEqual([
      "out",
      "title",
      "server",
      "includePages",
    ]);
  });

  it("writes storage/postman/collection.json by default, asks the child the same way, and lists warnings", async () => {
    await postmanGeneratorCommand.execute({ args: [], options: {} } as never);

    const written = JSON.parse(
      await readFile(path.join(hoisted.root, "storage", "postman", "collection.json"), "utf8"),
    );

    expect(written.info.schema).toBe("https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
    expect(written.info.name).toBe("app");
    expect(written.item.map((item: { name: string }) => item.name)).toEqual(["users", "ping"]);
    expect(written.variable[0]).toEqual({ key: "baseUrl", value: "http://localhost:2030", type: "string" });
    expect(hoisted.collectOpenApiDocument).toHaveBeenCalledWith({
      cwd: hoisted.root,
      timeoutMs: 45_000,
      title: undefined,
      server: undefined,
      includePages: false,
    });
    expect(console.warn).toHaveBeenCalledWith("  - GET /a: gap");
  });

  it("honours --out, --title, --server and --include-pages", async () => {
    await postmanGeneratorCommand.execute({
      args: [],
      options: { out: "docs/api.postman.json", title: "Shop", server: "https://x.test", includePages: true },
    } as never);

    const written = JSON.parse(await readFile(path.join(hoisted.root, "docs", "api.postman.json"), "utf8"));

    expect(written.item).toHaveLength(2);
    expect(hoisted.collectOpenApiDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Shop", server: "https://x.test", includePages: true }),
    );
  });

  it("fails loudly when the child fails and writes nothing", async () => {
    hoisted.collectOpenApiDocument.mockRejectedValue(new Error("child exploded"));

    await expect(postmanGeneratorCommand.execute({ args: [], options: {} } as never)).rejects.toThrow(
      "child exploded",
    );
    await expect(
      readFile(path.join(hoisted.root, "storage", "postman", "collection.json"), "utf8"),
    ).rejects.toThrow();
  });
});
