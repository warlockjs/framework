---
name: store-secrets
description: "Store app credentials with secrets.get/set/remove/has and environmentName; lazy optional OS keychain, read-only scoped environment variables, encrypted file fallback, typed SecretStoreError and memory-backed secretsFake. Use for provider keys and OAuth credentials the app must read back. Skip user passwords (hash-password) and encrypted database columns (encrypt-data)."
---

# Application secret store

Use core's facade; there is no separate package or preparation step:

```ts
import { secrets, SecretStoreError } from "@warlock.js/core";
// The same API is available from "@warlock.js/core/secrets".

await secrets.set("vendor-token", "provider-credential");
const token = await secrets.get("vendor-token"); // string | undefined
const exists = await secrets.has("vendor-token"); // boolean; true for ""
const removed = await secrets.remove("vendor-token"); // boolean
const variable = secrets.environmentName("vendor-token"); // variable name, not value

try {
  await secrets.remove("vendor-token");
} catch (error) {
  if (error instanceof SecretStoreError && error.code === "READ_ONLY") {
    // Change the deployment environment instead.
  } else {
    throw error;
  }
}
```

Names are case-sensitive, nonempty strings of at most 256 UTF-16 code units. Values are strings, including empty strings. Every operation is async, except `environmentName()`.

## Configuration and backend decisions

- Default namespace: app name plus the SHA-256 hash of the absolute project root. For changing release directories, configure a stable unique namespace including the deployment environment.
- Reads: OS keychain → exact scoped environment variable → encrypted file.
- Optional peer: `npm install @napi-rs/keyring`. Core lazily uses its 2.1.1 `AsyncEntry` API. Linux requires `secret-service` for persistence; it does not use the memory-only keyutils fallback. Sources: [official README](https://github.com/Brooooooklyn/keyring-node#readme), [published declarations](https://www.npmjs.com/package/@napi-rs/keyring?activeTab=code), verified 2026-10-19.
- One initial read-only probe selects the keychain for that store lifetime. Missing peer/initially unavailable service falls back automatically. A later keychain failure throws `UNAVAILABLE`; do not silently change backends mid-operation. Keep backend availability consistent between deployments; independent backend writes are not reconciled automatically.
- Environment names are `WARLOCK_SECRET_<namespace UTF-8 uppercase hex>_<name UTF-8 uppercase hex>`; use `environmentName()` to avoid guessing. No unscoped environment fallback. Both mutation methods throw `READ_ONLY` if that variable is present, including `""` and shadowed environment values.
- File fallback derives a per-namespace HKDF-SHA256 key from `encryption.key` (64 hex characters, conventionally `APP_ENCRYPTION_KEY`) and uses AES-256-GCM with name/namespace authenticated data. It never stores an unencrypted value/key file. Core's global `encrypt()` helper cannot accept a derived key, so the backend uses Node crypto without changing global config. Consult `encrypt-data` for app key provisioning.
- Default files: `storage/secrets/<namespace hash>/<name hash>.secret`. Directories `0700`, files `0600`, owner checks, no symlinks/hardlinks, synced temporary writes and rename. Parent directories must be trusted. Same-key concurrent writes use last completed rename.
- File fallback fails closed on Windows because Node modes cannot enforce owner-only ACLs; use keychain/environment. See [Node file modes](https://nodejs.org/docs/latest-v22.x/api/fs.html#file-modes).
- Keychain writes clear an old file copy; removal clears both writable layers. Retry errors after fixing the backend; a multi-layer operation may partially complete.

```ts title="src/config/secrets.ts"
import type { SecretsConfigurations } from "@warlock.js/core";

export default {
  namespace: "sample-app-production",
  // directory: "/srv/sample-app/private-secrets",
} satisfies SecretsConfigurations;
```

Never change namespace or encryption key without a migration. Keep file storage outside publicly served paths, and secure the app key separately from encrypted backups.

## Isolated tests and explicit stores

`setupTest()` and the HTTP test harness install `secretsFake` by default. `NODE_ENV=test` alone does not install it. Opt out with `tests.fakes: { secrets: false }` only for real-backend tests. Memory is per process; HTTP server and test worker do not share it.

```ts
import { secrets } from "@warlock.js/core";
import { secretsFake } from "@warlock.js/core/tests";

secretsFake.install(); // only needed without the standard test harness
try {
  secretsFake.clear();
  await secrets.set("vendor-token", "test-credential");
  await secretsFake.assertHas("vendor-token");
  await secretsFake.assertStored("vendor-token", "test-credential");
  await secrets.remove("vendor-token");
  await secretsFake.assertMissing("vendor-token");
  const installed = secretsFake.isInstalled();
} finally {
  secretsFake.restore();
}
```

For standalone unit tests or distinct app instances:

```ts
import { MemorySecretBackend, SecretStore } from "@warlock.js/core/secrets";
import type { SecretBackend, SecretStoreOptions } from "@warlock.js/core/secrets";

const backend: SecretBackend = new MemorySecretBackend();
const options: SecretStoreOptions = { namespace: "test-app", backend };
const store = new SecretStore(options);
await store.set("vendor-token", "test-credential");
await store.get("vendor-token");
await store.has("vendor-token");
await store.remove("vendor-token");

const memory = new MemorySecretBackend();
memory.clear();
```

Options also allow a `directory` and `encryptionKey` (string or lazy callback); the default key reads `encryption.key` lazily. A custom `SecretBackend` implements async namespace-aware `get`, `set`, and `remove`. Explicit backends bypass keychain, environment and files; the test fake only swaps the shared facade.

## Error and logging contract

`SecretStoreError.code` is `INVALID_DRIVER`, `MEMORY_IN_PRODUCTION`, `INVALID_NAME`, `INVALID_VALUE`, `INVALID_NAMESPACE`, `READ_ONLY`, `KEY_REQUIRED`, `UNAVAILABLE`, `UNSAFE_FILE` or `CORRUPT_FILE`. Errors never include names, values, paths or vendor causes. `KEY_REQUIRED` means provision/fix the app encryption key; `CORRUPT_FILE` means wrong key, invalid format or failed authentication. Never replace an unreadable store with an empty one.

The store never logs credentials. It registers encountered names and literal values with `@warlock.js/logger` for process-lifetime masking, including old/removed/failed-write values, interpolated messages, Error text/causes, and channel error reports. Keys and exact values stay protected even with permissive custom censors. Registration retains values in memory. It cannot mask direct console/third-party logging, earlier logs, transformed/encoded values, or credentials never encountered by the store. Keep secrets out of logs even with masking enabled. Fake assertion errors do not print values.

## Built-app tests with the memory driver

Run the built server with `SECRETS_DRIVER=memory`, or select the driver in
`src/config/secrets.ts`. Explicit config takes precedence over the environment;
`"auto"` (the default) keeps keychain/environment/file behavior. Unknown driver
names fail with `SecretStoreError.code === "INVALID_DRIVER"`.

```ts title="src/config/secrets.ts"
import type { SecretsConfigurations } from "@warlock.js/core";

export default {
  namespace: "browser-test-server",
  driver: "memory",
  allowMemoryInProduction: true,
} satisfies SecretsConfigurations;
```

`allowMemoryInProduction: true` is required only when the test server runs with
`NODE_ENV=production`. Without it, memory selection fails closed with
`MEMORY_IN_PRODUCTION`; a built bundle does not bypass this check. Set this
option explicitly in the test deployment configuration. `SecretStore` accepts
the same `driver` and `allowMemoryInProduction` options for standalone stores.

The selected memory driver bypasses keychain, scoped environment secrets and
files, and still registers values for log masking. Values are isolated by app
namespace, lost on process exit, and never shared across workers or with a
separate browser-test process. Seed fixtures through application startup or a
test-only endpoint in the server process using the normal `secrets.set()` API:

```ts
import { secrets } from "@warlock.js/core";

await secrets.set("vendor-token", "browser-test-credential");
const token = await secrets.get("vendor-token");
```

The normal test harness still installs `secretsFake`; explicit `backend`
instances and that fake continue to bypass configured backend selection.
