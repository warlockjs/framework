import config from "@mongez/config";
import { afterEach, describe, expect, it, vi } from "vitest";

let currentEnvironment = "development";

vi.mock("@warlock.js/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@warlock.js/core")>()),
  environment: () => currentEnvironment,
}));

const { resolveLoaderTimeoutMs } = await import("./streaming-config");

describe("resolveLoaderTimeoutMs — development default", () => {
  afterEach(() => {
    config.set("web", {});
    currentEnvironment = "development";
  });

  it("is generous in development so a cold compile is not a 504", () => {
    expect(resolveLoaderTimeoutMs()).toBe(90_000);
  });

  it("keeps 15000ms in production", () => {
    currentEnvironment = "production";

    expect(resolveLoaderTimeoutMs()).toBe(15_000);
  });

  it("lets an explicit value win in development", () => {
    config.set("web", { loaderTimeout: 5_000 });

    expect(resolveLoaderTimeoutMs()).toBe(5_000);
  });
});
