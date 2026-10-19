import { randomUUID } from "node:crypto";
import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyringSecretBackend } from "./keyring-backend";
import { FileSecretBackend } from "./file-backend";
import { SecretStore } from "./secret-store";
import { secrets } from "./secrets";
import { fakeKeyring } from "../../tests/fixtures/fake-keyring";

const loadKeyring = KeyringSecretBackend.load.bind(KeyringSecretBackend);

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
  it.each([true, false])(
    "reports resolved auto selection with keychain available=%s",
    async (available) => {
      const fake = fakeKeyring();
      fake.state.unavailable = !available;
      const load = vi
        .spyOn(KeyringSecretBackend, "load")
        .mockImplementation((namespace) => loadKeyring(namespace, async () => fake.module));
      // Resolved config overrides SECRETS_DRIVER=memory from setup.
      config.set("secrets.driver", "auto");
      vi.stubEnv(secrets.environmentName("token"), "environment-credential");
      const expected = available ? "keychain" : "file";
      expect(
        await Promise.all([secrets.backend(), secrets.backend(), secrets.get("token")]),
      ).toEqual([expected, expected, "environment-credential"]);
      expect(await secrets.backend()).toBe(expected);
      expect(load).toHaveBeenCalledTimes(1);
      expect(fake.state.calls).toEqual(available ? ["get", "get"] : ["get"]);
    },
  );

  it("uses the facade without keychain, scoped environment or file access", async () => {
    const keyring = vi.spyOn(KeyringSecretBackend, "load");
    const file = vi.spyOn(FileSecretBackend.prototype, "set");
    expect(await secrets.backend()).toBe("memory");
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
    expect(await secrets.backend()).toBe("memory");
    await secrets.set("token", "isolated-credential");
    config.set("secrets", { driver: "memory", namespace: "configured-memory-second" });
    expect(await secrets.get("token")).toBeUndefined();
    const store = new SecretStore({ namespace: "standalone", driver: "memory" });
    expect(await store.backend()).toBe("memory");
    await store.set("token", "standalone-credential");
    expect(await store.get("token")).toBe("standalone-credential");
  });

  it("refuses unknown drivers without falling back to persistent storage", async () => {
    vi.stubEnv("SECRETS_DRIVER", "typo");
    await expect(secrets.backend()).rejects.toMatchObject({ code: "INVALID_DRIVER" });
    await expect(secrets.get("token")).rejects.toMatchObject({ code: "INVALID_DRIVER" });
  });

  it("rechecks production policy even for a previously cached memory store", async () => {
    await secrets.set("token", "test-credential");
    vi.stubEnv("NODE_ENV", "production");
    await expect(secrets.backend()).rejects.toMatchObject({ code: "MEMORY_IN_PRODUCTION" });
    await expect(secrets.get("token")).rejects.toMatchObject({ code: "MEMORY_IN_PRODUCTION" });
    expect(() => new SecretStore({ namespace: "standalone", driver: "memory" })).toThrow(
      /allowMemoryInProduction/,
    );
    config.set("secrets.allowMemoryInProduction", true);
    expect(await secrets.backend()).toBe("memory");
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
