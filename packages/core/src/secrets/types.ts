/** Active storage selection, independent of the source of an individual secret. */
export type SecretBackendType = "keychain" | "file" | "memory";

/** Backend implementations must never log credentials or attach them to errors. */
export interface SecretBackend {
  /** Report injected storage; omitted metadata defaults to memory for test overrides. */
  readonly type?: SecretBackendType;
  get(namespace: string, name: string): Promise<string | undefined>;
  set(namespace: string, name: string, value: string): Promise<void>;
  remove(namespace: string, name: string): Promise<boolean>;
}

export type SecretsConfigurations = {
  /** auto selects keychain/environment/files; memory is isolated to this process. */
  driver?: "auto" | "memory";
  /** Explicitly permit the volatile memory driver under NODE_ENV=production. */
  allowMemoryInProduction?: boolean;
  /** Stable identity shared only by processes belonging to this app installation. */
  namespace?: string;
  /** Trusted parent location; defaults to storage/secrets. */
  directory?: string;
};

export type SecretStoreOptions = SecretsConfigurations & {
  namespace: string;
  /** Bypasses keychain, environment and files, for isolated tests. */
  backend?: SecretBackend;
  /** Defaults to the current encryption.key config, read only when files are used. */
  encryptionKey?: string | (() => string | undefined);
};
