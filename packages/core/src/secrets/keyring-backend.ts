import { SecretStoreError } from "./errors";
import type { SecretBackend } from "./types";

// Verified against @napi-rs/keyring 2.1.1's published index.d.ts and README:
// https://github.com/Brooooooklyn/keyring-node (2026-10-19).
// Structural types keep the optional peer unnecessary for TypeScript consumers.
interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

type KeyringModule = {
  AsyncEntry: new (
    service: string,
    username: string,
    options: { linux: { store: "secret-service" } },
  ) => KeyringEntry;
};

export class KeyringSecretBackend implements SecretBackend {
  private constructor(private readonly keyring: KeyringModule) {}

  /** Read-only availability probe; never writes a setup credential. */
  public static async load(
    namespace: string,
    importer: () => Promise<unknown> = importKeyring,
  ): Promise<KeyringSecretBackend | undefined> {
    try {
      const keyring = (await importer()) as KeyringModule;
      const backend = new KeyringSecretBackend(keyring);
      await backend.entry(namespace, "").getPassword();
      return backend;
    } catch {
      return undefined;
    }
  }

  private entry(namespace: string, name: string): KeyringEntry {
    // Require persistence on Linux: the library's automatic keyutils fallback
    // is memory-only and loses credentials on reboot. Ignored on other OSes.
    return new this.keyring.AsyncEntry(`warlock:${namespace}`, name || "__availability__", {
      linux: { store: "secret-service" },
    });
  }

  public async get(namespace: string, name: string): Promise<string | undefined> {
    try {
      return (await this.entry(namespace, name).getPassword()) ?? undefined;
    } catch {
      throw new SecretStoreError("UNAVAILABLE");
    }
  }

  public async set(namespace: string, name: string, value: string): Promise<void> {
    try {
      await this.entry(namespace, name).setPassword(value);
    } catch {
      throw new SecretStoreError("UNAVAILABLE");
    }
  }

  public async remove(namespace: string, name: string): Promise<boolean> {
    try {
      return await this.entry(namespace, name).deletePassword();
    } catch {
      throw new SecretStoreError("UNAVAILABLE");
    }
  }
}

async function importKeyring(): Promise<unknown> {
  const peer = "@napi-rs/keyring";
  return import(peer);
}
