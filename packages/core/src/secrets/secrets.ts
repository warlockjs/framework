import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "../config/config-getter";
import { rootPath, storagePath } from "../utils/paths";
import { SecretStore } from "./secret-store";
import type { SecretBackend } from "./types";

let testBackend: SecretBackend | undefined;
let stores = new Map<string, SecretStore>();

/** @internal The test kit swaps only the facade, never explicitly constructed stores. */
export function replaceSecretsBackend(backend: SecretBackend): () => void {
  const previous = testBackend;
  const previousStores = stores;
  testBackend = backend;
  stores = new Map();
  return () => {
    testBackend = previous;
    stores = previousStores;
  };
}

function current(): SecretStore {
  const root = rootPath();
  const appName = config.key<string | undefined>("app.appName") || path.basename(root);
  const namespace =
    config.key<string | undefined>("secrets.namespace") ??
    `${appName}:${createHash("sha256").update(root).digest("hex")}`;
  const directory = config.key<string | undefined>("secrets.directory") ?? storagePath("secrets");
  const identity = JSON.stringify([root, namespace, directory]);
  let store = stores.get(identity);
  if (!store) {
    store = new SecretStore({ namespace, directory, backend: testBackend });
    stores.set(identity, store);
  }
  return store;
}

/** App identity and configuration are resolved on first use, after config has loaded. */
export const secrets = {
  async get(name: string): Promise<string | undefined> {
    return current().get(name);
  },
  async set(name: string, value: string): Promise<void> {
    return current().set(name, value);
  },
  async remove(name: string): Promise<boolean> {
    return current().remove(name);
  },
  async has(name: string): Promise<boolean> {
    return current().has(name);
  },
  environmentName(name: string): string {
    return current().environmentName(name);
  },
};
