import config from "@mongez/config";
import { v } from "@warlock.js/seal";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileManager } from "../dev-server/file-manager";
import { defineConfigSchema, InvalidConfigError } from "./config-schema";

const modules = new Map<string, { default?: unknown; configSchema?: unknown }>();
const executed: string[] = [];

vi.mock("../loader/app-module-importer", () => ({
  importAppModule: async (url: string) => modules.get(url) ?? {},
}));

vi.mock("./config-special-handlers", () => ({
  configSpecialHandlers: {
    execute: async (name: string) => {
      executed.push(name);
    },
  },
}));

const { ConfigLoader } = await import("./config-loader");

const mailSchema = defineConfigSchema(v.object({ host: v.string() }), {
  env: { host: "MAIL_HOST" },
});

function configFile(
  name: string,
  module: { default?: unknown; configSchema?: unknown },
): FileManager {
  const absolutePath = `/app/src/config/${name}.ts`;
  modules.set(pathToFileURL(absolutePath).href, module);
  return { relativePath: `src/config/${name}.ts`, absolutePath } as unknown as FileManager;
}

describe("ConfigLoader with config schemas", () => {
  beforeEach(() => {
    modules.clear();
    executed.length = 0;
  });

  it("loads files without a schema exactly as before", async () => {
    await new ConfigLoader().loadAll([configFile("app", { default: { name: "demo" } })]);

    expect(config.get("app")).toEqual({ name: "demo" });
    expect(executed).toEqual(["app"]);
  });

  it("collects every invalid file into one boot error and skips their handlers", async () => {
    const files = [
      configFile("mail", { default: { host: undefined }, configSchema: mailSchema }),
      configFile("cache", { default: { driver: "memory" } }),
      configFile("search", {
        default: { url: 42 },
        configSchema: defineConfigSchema(v.object({ url: v.string() })),
      }),
    ];

    const error = await new ConfigLoader().loadAll(files).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidConfigError);
    expect(
      (error as InvalidConfigError).issues.map((issue) => `${issue.config}.${issue.key}`),
    ).toEqual(["mail.host", "search.url"]);
    expect((error as InvalidConfigError).message).toContain("MAIL_HOST");
    // Valid files still load; invalid ones are registered but never handled.
    expect(executed).toEqual(["cache"]);
  });

  it("keeps the previous value when a hot reload is invalid", async () => {
    const loader = new ConfigLoader();
    await loader.loadAll([
      configFile("mail", { default: { host: "smtp.example.com" }, configSchema: mailSchema }),
    ]);

    const broken = configFile("mail", { default: { host: "" }, configSchema: mailSchema });
    await expect(loader.reloadConfig(broken)).rejects.toBeInstanceOf(InvalidConfigError);

    expect(config.get("mail")).toEqual({ host: "smtp.example.com" });
  });
});
