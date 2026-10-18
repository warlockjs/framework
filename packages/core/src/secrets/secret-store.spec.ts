import { applyRedact } from "@warlock.js/logger";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeKeyring } from "../../tests/fixtures/fake-keyring";
import { FileSecretBackend } from "./file-backend";
import { KeyringSecretBackend } from "./keyring-backend";
import { MemorySecretBackend } from "./memory-backend";
import { SecretStore } from "./secret-store";
import { SecretStoreError } from "./errors";

const appKey = "a".repeat(64);
let root: string;
let fake: ReturnType<typeof fakeKeyring>;
const loadKeyring = KeyringSecretBackend.load.bind(KeyringSecretBackend);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "warlock-secrets-spec-"));
  fake = fakeKeyring();
  vi.spyOn(KeyringSecretBackend, "load").mockImplementation((namespace) =>
    loadKeyring(namespace, async () => fake.module),
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function store(namespace = "sample-app") {
  return new SecretStore({
    namespace,
    directory: path.join(root, "private"),
    encryptionKey: appKey,
  });
}

describe("memory secrets", () => {
  it("supports CRUD, overwrites, empty strings and missing values", async () => {
    const backend = new MemorySecretBackend();
    const secrets = new SecretStore({ namespace: "app", backend });
    expect(await secrets.get("vendor-key")).toBeUndefined();
    expect(await secrets.has("vendor-key")).toBe(false);
    await secrets.set("vendor-key", "test-credential-old");
    await secrets.set("vendor-key", "");
    expect(await secrets.get("vendor-key")).toBe("");
    expect(await secrets.has("vendor-key")).toBe(true);
    expect(await secrets.remove("vendor-key")).toBe(true);
    expect(await secrets.remove("vendor-key")).toBe(false);
    expect(fake.state.calls).toEqual([]);
  });

  it("isolates namespaces even when stores share the memory backend", async () => {
    const backend = new MemorySecretBackend();
    const first = new SecretStore({ namespace: "first", backend });
    const second = new SecretStore({ namespace: "second", backend });
    await first.set("vendor-key", "isolated-credential");
    expect(await second.has("vendor-key")).toBe(false);
    backend.clear();
    expect(await first.has("vendor-key")).toBe(false);
  });

  it("rejects invalid input with typed errors without echoing the input", async () => {
    const secrets = store();
    expect(() => new SecretStore({ namespace: "" })).toThrow(SecretStoreError);
    await expect(secrets.get("")).rejects.toMatchObject({ code: "INVALID_NAME" });
    await expect(secrets.set("x".repeat(257), "credential")).rejects.toMatchObject({
      code: "INVALID_NAME",
    });
    await expect(secrets.set("vendor-key", 123 as unknown as string)).rejects.toMatchObject({
      code: "INVALID_VALUE",
    });
    expect(fake.state.calls).toEqual([]);
  });

  it("sanitizes custom backend errors instead of retaining credentials in causes", async () => {
    const backend = new MemorySecretBackend();
    vi.spyOn(backend, "get").mockRejectedValue(new Error("private-vendor-error-credential"));
    const secrets = new SecretStore({ namespace: "custom", backend });
    try {
      await secrets.get("vendor-key");
      throw new Error("Expected a backend failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretStoreError);
      expect(error).toMatchObject({ code: "UNAVAILABLE" });
      expect(String(error)).not.toContain("private-vendor-error-credential");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("masks names and old/new values, including errors and failed writes", async () => {
    const secrets = new SecretStore({ namespace: "redaction", backend: new MemorySecretBackend() });
    await secrets.set("vendor-private-ref", "credential-before-rotation");
    await secrets.set("vendor-private-ref", "credential-after-rotation");
    await secrets.remove("vendor-private-ref");
    const data = applyRedact(
      {
        type: "info",
        module: "sample",
        action: "mask",
        message: new Error("credential-before-rotation credential-after-rotation"),
        context: { vendorPrivateRef: "unseen credential" },
      },
      { defaultKeys: false, censor: (value: unknown) => value },
    );
    expect(data.message.message).toBe("[REDACTED] [REDACTED]");
    expect(data.context).toEqual({ vendorPrivateRef: "[REDACTED]" });
    fake.state.writeFailure = true;
    await expect(store().set("vendor-key", "failed-sensitive-credential")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(
      applyRedact(
        { type: "info", module: "sample", action: "mask", message: "failed-sensitive-credential" },
        undefined,
      ).message,
    ).toBe("[REDACTED]");
  });
});

describe("keychain selection and precedence", () => {
  it("imports/probes only on first use, shares initialization and scopes service names", async () => {
    const first = store("first");
    const second = store("second");
    expect(KeyringSecretBackend.load).not.toHaveBeenCalled();
    expect(existsSync(path.join(root, "private"))).toBe(false);
    await Promise.all([first.has("vendor-key"), first.has("another-key")]);
    expect(KeyringSecretBackend.load).toHaveBeenCalledTimes(1);
    await first.set("vendor-key", "credential-in-keychain");
    expect(await second.get("vendor-key")).toBeUndefined();
    expect(fake.state.values.get(fake.key("warlock:first", "vendor-key"))).toBe(
      "credential-in-keychain",
    );
    expect(fake.state.options.every((options) => options.linux.store === "secret-service")).toBe(
      true,
    );
    expect(existsSync(path.join(root, "private"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "reads keychain before environment before encrypted files",
    async () => {
      const secrets = store();
      const file = new FileSecretBackend(path.join(root, "private"), () => appKey);
      await file.set(secrets.namespace, "vendor-key", "file-credential");
      vi.stubEnv(secrets.environmentName("vendor-key"), "environment-credential");
      fake.state.values.set(
        fake.key(`warlock:${secrets.namespace}`, "vendor-key"),
        "keychain-credential",
      );
      expect(await secrets.get("vendor-key")).toBe("keychain-credential");
      fake.state.values.clear();
      expect(await secrets.get("vendor-key")).toBe("environment-credential");
      vi.unstubAllEnvs();
      expect(await secrets.get("vendor-key")).toBe("file-credential");
    },
  );

  it("does not mutate or shadow environment secrets, including empty values", async () => {
    const secrets = store();
    const variable = secrets.environmentName("vendor-key");
    vi.stubEnv(variable, "");
    expect(await secrets.has("vendor-key")).toBe(true);
    await expect(secrets.set("vendor-key", "other-credential")).rejects.toMatchObject({
      code: "READ_ONLY",
    });
    await expect(secrets.remove("vendor-key")).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(process.env[variable]).toBe("");
    expect(fake.state.calls).not.toContain("set");
    expect(fake.state.calls).not.toContain("remove");
  });

  it("uses collision-free environment names across names and namespaces", () => {
    expect(store("ab").environmentName("c")).not.toBe(store("a").environmentName("bc"));
    expect(store().environmentName("vendor-key")).not.toBe(store().environmentName("vendor_key"));
  });

  it.skipIf(process.platform === "win32")(
    "falls back automatically when the optional peer or initial service is unavailable",
    async () => {
      expect(
        await loadKeyring("app", async () => {
          throw new Error("peer missing");
        }),
      ).toBeUndefined();
      fake.state.unavailable = true;
      const secrets = store();
      await secrets.set("vendor-key", "fallback-credential");
      expect(await secrets.get("vendor-key")).toBe("fallback-credential");
      expect(fake.state.calls).not.toContain("set");
    },
  );

  it("keeps a selected keychain stable and fails safely if it later locks", async () => {
    const secrets = store();
    await secrets.set("vendor-key", "persistent-credential");
    fake.state.unavailable = true;
    await expect(secrets.get("vendor-key")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(secrets.set("vendor-key", "replacement-credential")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(existsSync(path.join(root, "private"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "removes stale file copies when setting a keychain value, and removes both layers",
    async () => {
      const secrets = store();
      const file = new FileSecretBackend(path.join(root, "private"), () => appKey);
      await file.set(secrets.namespace, "vendor-key", "stale-file-credential");
      await secrets.set("vendor-key", "new-keychain-credential");
      expect(await file.get(secrets.namespace, "vendor-key")).toBeUndefined();
      await file.set(secrets.namespace, "vendor-key", "duplicate-file-credential");
      expect(await secrets.remove("vendor-key")).toBe(true);
      expect(await secrets.has("vendor-key")).toBe(false);
      expect(await secrets.remove("vendor-key")).toBe(false);
    },
  );

  it("reports failed keychain deletions as errors rather than claiming absence", async () => {
    const secrets = store();
    await secrets.set("vendor-key", "kept-credential");
    fake.state.deleteFailure = true;
    await expect(secrets.remove("vendor-key")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await secrets.has("vendor-key")).toBe(true);
  });
});
