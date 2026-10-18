/** Backend implementations must never log credentials or attach them to errors. */
export interface SecretBackend {
  get(namespace: string, name: string): Promise<string | undefined>;
  set(namespace: string, name: string, value: string): Promise<void>;
  remove(namespace: string, name: string): Promise<boolean>;
}

export type SecretsConfigurations = {
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
