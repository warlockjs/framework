import type { SecretBackend } from "./types";

/** Isolated, namespace-aware storage. No OS, environment or filesystem access. */
export class MemorySecretBackend implements SecretBackend {
  private readonly values = new Map<string, Map<string, string>>();

  public async get(namespace: string, name: string): Promise<string | undefined> {
    return this.values.get(namespace)?.get(name);
  }

  public async set(namespace: string, name: string, value: string): Promise<void> {
    let entries = this.values.get(namespace);
    if (!entries) {
      entries = new Map();
      this.values.set(namespace, entries);
    }
    entries.set(name, value);
  }

  public async remove(namespace: string, name: string): Promise<boolean> {
    return this.values.get(namespace)?.delete(name) ?? false;
  }

  public clear(): void {
    this.values.clear();
  }
}
