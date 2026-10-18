import { registerLogSecret } from "@warlock.js/logger";
import { config } from "../config/config-getter";
import { storagePath } from "../utils/paths";
import { SecretStoreError } from "./errors";
import { FileSecretBackend } from "./file-backend";
import { KeyringSecretBackend } from "./keyring-backend";
import type { SecretBackend, SecretStoreOptions } from "./types";

/** Lazily prepared, application-scoped credentials. All operations are asynchronous. */
export class SecretStore {
  private primary: Promise<KeyringSecretBackend | undefined> | undefined;
  private readonly file: FileSecretBackend;
  private readonly backend: SecretBackend | undefined;
  public readonly namespace: string;

  public constructor(options: SecretStoreOptions) {
    if (
      typeof options.namespace !== "string" ||
      !options.namespace.trim() ||
      Buffer.from(options.namespace).toString("utf8") !== options.namespace
    ) {
      throw new SecretStoreError("INVALID_NAMESPACE");
    }
    this.namespace = options.namespace;
    this.backend = options.backend;
    const encryptionKey = options.encryptionKey;
    this.file = new FileSecretBackend(
      options.directory ?? storagePath("secrets"),
      typeof encryptionKey === "function"
        ? encryptionKey
        : () => encryptionKey ?? config.key<string | undefined>("encryption.key"),
    );
  }

  private validate(name: string): void {
    if (
      typeof name !== "string" ||
      !name.length ||
      name.length > 256 ||
      Buffer.from(name).toString("utf8") !== name
    ) {
      throw new SecretStoreError("INVALID_NAME");
    }
  }

  /** Exact, collision-free environment variable name (UTF-8 encoded as uppercase hex). */
  public environmentName(name: string): string {
    this.validate(name);
    const hex = (value: string) => Buffer.from(value).toString("hex").toUpperCase();
    return `WARLOCK_SECRET_${hex(this.namespace)}_${hex(name)}`;
  }

  private keyring(): Promise<KeyringSecretBackend | undefined> {
    this.primary ??= KeyringSecretBackend.load(this.namespace);
    return this.primary;
  }

  private register(name: string, value?: string): void {
    registerLogSecret(value ?? "", [name, this.environmentName(name)]);
  }

  private environment(name: string): string | undefined {
    return process.env[this.environmentName(name)];
  }

  private assertWritable(name: string): void {
    const value = this.environment(name);
    if (value !== undefined) {
      this.register(name, value);
      throw new SecretStoreError("READ_ONLY");
    }
  }

  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      // Custom backends may throw messages containing values. Do not propagate them.
      throw new SecretStoreError("UNAVAILABLE");
    }
  }

  public async get(name: string): Promise<string | undefined> {
    this.validate(name);
    this.register(name);
    return this.safe(async () => {
      let value: string | undefined;
      if (this.backend) {
        value = await this.backend.get(this.namespace, name);
      } else {
        const primary = await this.keyring();
        value = await primary?.get(this.namespace, name);
        value ??= this.environment(name);
        value ??= await this.file.get(this.namespace, name);
      }
      if (value !== undefined) this.register(name, value);
      return value;
    });
  }

  public async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== undefined;
  }

  public async set(name: string, value: string): Promise<void> {
    this.validate(name);
    if (typeof value !== "string") throw new SecretStoreError("INVALID_VALUE");
    // Register before any backend call, including failed writes.
    this.register(name, value);
    return this.safe(async () => {
      if (this.backend) {
        const previous = await this.backend.get(this.namespace, name);
        if (previous !== undefined) this.register(name, previous);
        return this.backend.set(this.namespace, name, value);
      }
      this.assertWritable(name);
      const primary = await this.keyring();
      const backend = primary ?? this.file;
      if (primary) {
        const fallback = await this.file.get(this.namespace, name);
        if (fallback !== undefined) this.register(name, fallback);
      }
      // Retain masking for the old value after replacement as well.
      const previous = await backend.get(this.namespace, name);
      if (previous !== undefined) this.register(name, previous);
      await backend.set(this.namespace, name, value);
      if (primary) await this.file.remove(this.namespace, name);
    });
  }

  /** Remove every writable layer so a fallback value cannot reappear. */
  public async remove(name: string): Promise<boolean> {
    this.validate(name);
    this.register(name);
    return this.safe(async () => {
      if (this.backend) {
        const previous = await this.backend.get(this.namespace, name);
        if (previous !== undefined) this.register(name, previous);
        return this.backend.remove(this.namespace, name);
      }
      this.assertWritable(name);
      const primary = await this.keyring();
      const previous = await primary?.get(this.namespace, name);
      if (previous !== undefined) this.register(name, previous);
      const fromFile = await this.file.get(this.namespace, name);
      if (fromFile !== undefined) this.register(name, fromFile);
      const removed = (await primary?.remove(this.namespace, name)) ?? false;
      return (await this.file.remove(this.namespace, name)) || removed;
    });
  }
}
