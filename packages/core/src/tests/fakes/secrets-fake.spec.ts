import config from "@mongez/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyringSecretBackend } from "../../secrets/keyring-backend";
import { secrets } from "../../secrets/secrets";
import { FakeAssertionError } from "./fake-assertion-error";
import { secretsFake } from "./secrets-fake";
import { resolveTestFakes } from "./test-fakes";

afterEach(() => {
  secretsFake.restore();
  config.set("secrets", undefined);
  config.set("app", undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("secretsFake", () => {
  it("is selected by default and supports selective opt-out", () => {
    expect(resolveTestFakes()).toContain("secrets");
    expect(resolveTestFakes({ secrets: false })).not.toContain("secrets");
  });

  it("isolates the facade from keychain and environment and resets between installs", async () => {
    const load = vi.spyOn(KeyringSecretBackend, "load");
    secretsFake.install();
    expect(await secrets.backend()).toBe("memory");
    vi.stubEnv(secrets.environmentName("vendor-key"), "production-environment-credential");
    await secretsFake.assertMissing("vendor-key");
    await secrets.set("vendor-key", "test-memory-credential");
    await secretsFake.assertHas("vendor-key");
    await secretsFake.assertStored("vendor-key", "test-memory-credential");
    expect(load).not.toHaveBeenCalled();
    secretsFake.install();
    await secretsFake.assertMissing("vendor-key");
    await secrets.set("vendor-key", "another-test-credential");
    secretsFake.clear();
    await secretsFake.assertMissing("vendor-key");
  });

  it("scopes the facade by app configuration, including explicit namespaces", async () => {
    secretsFake.install();
    config.set("app", { appName: "first-app" });
    await secrets.set("vendor-key", "first-app-credential");
    const firstVariable = secrets.environmentName("vendor-key");
    config.set("app", { appName: "second-app" });
    expect(secrets.environmentName("vendor-key")).not.toBe(firstVariable);
    await secretsFake.assertMissing("vendor-key");
    config.set("secrets", { namespace: "stable-deployment" });
    await secrets.set("vendor-key", "explicit-scope-credential");
    config.set("app", { appName: "renamed-app" });
    await secretsFake.assertStored("vendor-key", "explicit-scope-credential");
  });

  it("restores the real facade and never prints values in assertion failures", async () => {
    const load = vi.spyOn(KeyringSecretBackend, "load").mockResolvedValue(undefined);
    secretsFake.install();
    await secrets.set("vendor-key", "sensitive-assertion-credential");
    await expect(
      secretsFake.assertStored("vendor-key", "expected-private-credential"),
    ).rejects.toThrow("The stored secret does not match the expected value.");
    secretsFake.restore();
    expect(secretsFake.isInstalled()).toBe(false);
    expect(await secrets.backend()).toBe("file");
    expect(() => secretsFake.clear()).toThrow(FakeAssertionError);
    vi.stubEnv(secrets.environmentName("restored-key"), "restored-environment-credential");
    expect(await secrets.get("restored-key")).toBe("restored-environment-credential");
    expect(load).toHaveBeenCalled();
  });
});
