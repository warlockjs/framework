import { randomUUID } from "node:crypto";
import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyringSecretBackend } from "./keyring-backend";
import { FileSecretBackend } from "./file-backend";
import { SecretStore } from "./secret-store";
import { secrets } from "./secrets";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SECRETS_DRIVER", "memory");
  config.set("secrets", { namespace: `memory-driver-${randomUUID()}` });
});
afterEach(() => {
  config.set("secrets", undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("configured memory driver", () => {
  it("uses the facade without keychain, scoped environment or file access", async () => {
    const keyring = vi.spyOn(KeyringSecretBackend, "load");
    const file = vi.spyOn(FileSecretBackend.prototype, "set");
    vi.stubEnv(secrets.environmentName("token"), "environment-credential");
    expect(await secrets.get("token")).toBeUndefined();
    await secrets.set("token", "test-credential");
    expect(await secrets.get("token")).toBe("test-credential");
    expect(await secrets.has("token")).toBe(true);
    expect(await secrets.remove("token")).toBe(true);
    expect(await secrets.has("token")).toBe(false);
    expect(keyring).not.toHaveBeenCalled();
    expect(file).not.toHaveBeenCalled();
  });

  it("supports explicit configuration and namespace isolation", async () => {
    vi.stubEnv("SECRETS_DRIVER", "invalid");
    config.set("secrets", { driver: "memory", namespace: "configured-memory-first" });
    await secrets.set("token", "isolated-credential");
    config.set("secrets", { driver: "memory", namespace: "configured-memory-second" });
    expect(await secrets.get("token")).toBeUndefined();
    const store = new SecretStore({ namespace: "standalone", driver: "memory" });
    await store.set("token", "standalone-credential");
    expect(await store.get("token")).toBe("standalone-credential");
  });

  it("refuses unknown drivers without falling back to persistent storage", async () => {
    vi.stubEnv("SECRETS_DRIVER", "typo");
    await expect(secrets.get("token")).rejects.toMatchObject({ code: "INVALID_DRIVER" });
  });

  it("rechecks production policy even for a previously cached memory store", async () => {
    await secrets.set("token", "test-credential");
    vi.stubEnv("NODE_ENV", "production");
    await expect(secrets.get("token")).rejects.toMatchObject({ code: "MEMORY_IN_PRODUCTION" });
    expect(() => new SecretStore({ namespace: "standalone", driver: "memory" })).toThrow(
      /allowMemoryInProduction/,
    );
    config.set("secrets.allowMemoryInProduction", true);
    expect(await secrets.get("token")).toBe("test-credential");
    const allowed = new SecretStore({
      namespace: "standalone",
      driver: "memory",
      allowMemoryInProduction: true,
    });
    await allowed.set("token", "explicit-test-credential");
    expect(await allowed.get("token")).toBe("explicit-test-credential");
    config.set("secrets.allowMemoryInProduction", false);
    await expect(secrets.has("token")).rejects.toMatchObject({ code: "MEMORY_IN_PRODUCTION" });
  });
});
