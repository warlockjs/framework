import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

import { openApiGeneratorCommand } from "./openapi-generator.command";

const document = {
  openapi: "3.1.0",
  info: { title: "app", version: "1.0.0" },
  paths: { "/a": { get: {}, post: {} }, "/b": { get: {} } },
};

describe("warlock generate.openapi", () => {
  beforeEach(async () => {
    hoisted.root = await mkdtemp(path.join(tmpdir(), "warlock-openapi-cli-"));
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
      fileURLToPath(new URL("../framework-cli-commands.ts", import.meta.url)),
      "utf8",
    );

    expect(registry).toMatch(/frameworkCommands = \[[\s\S]*openApiGeneratorCommand,/);
    expect(openApiGeneratorCommand.name).toBe("generate.openapi");
    expect(openApiGeneratorCommand.commandOptions.map((option) => option.name)).toEqual([
      "out",
      "title",
      "server",
      "includePages",
    ]);
  });

  it("writes storage/openapi/openapi.json by default, with the build timeout, and lists warnings", async () => {
    await openApiGeneratorCommand.execute({ args: [], options: {} } as never);

    const written = JSON.parse(
      await readFile(path.join(hoisted.root, "storage", "openapi", "openapi.json"), "utf8"),
    );

    expect(written).toEqual(document);
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
    await openApiGeneratorCommand.execute({
      args: [],
      options: { out: "docs/api.json", title: "Shop", server: "https://x.test", includePages: true },
    } as never);

    expect(JSON.parse(await readFile(path.join(hoisted.root, "docs", "api.json"), "utf8"))).toEqual(
      document,
    );
    expect(hoisted.collectOpenApiDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Shop", server: "https://x.test", includePages: true }),
    );
  });

  it("fails loudly when the child fails and writes nothing", async () => {
    hoisted.collectOpenApiDocument.mockRejectedValue(new Error("child exploded"));

    await expect(
      openApiGeneratorCommand.execute({ args: [], options: {} } as never),
    ).rejects.toThrow("child exploded");
    await expect(
      readFile(path.join(hoisted.root, "storage", "openapi", "openapi.json"), "utf8"),
    ).rejects.toThrow();
  });
});
