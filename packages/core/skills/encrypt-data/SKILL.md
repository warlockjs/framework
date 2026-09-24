---
name: encrypt-data
description: 'Reversible AES-256-GCM `encrypt` / `decrypt` for secrets you need to read back; one-way HMAC-SHA256 `hmacHash` for deterministic fingerprints (lookup/dedup of encrypted columns). Keys come from `src/config/encryption.ts`. Triggers: `encrypt`, `decrypt`, `hmacHash`, `EncryptionConfigurations`, `APP_ENCRYPTION_KEY`, `APP_HMAC_KEY`; "store an API key reversibly", "fingerprint an encrypted column for lookup", "AES-256-GCM secret", "HMAC-SHA256 dedup key"; typical import `import { encrypt, decrypt, hmacHash } from "@warlock.js/core"`. Skip: password hashing — `@warlock.js/core/hash-password/SKILL.md`; config wiring — `@warlock.js/core/configure-app/SKILL.md`; competing libs Node `crypto` direct, `crypto-js`, `libsodium-wrappers`.'
---

# Warlock — encrypt and fingerprint

Two helpers, two different jobs:

| Tool                    | Direction  | Algorithm    | Use for                                                        |
| ----------------------- | ---------- | ------------ | -------------------------------------------------------------- |
| `encrypt` / `decrypt`   | reversible | AES-256-GCM  | Secrets you need to read back (API keys, OAuth tokens).        |
| `hmacHash`              | one-way    | HMAC-SHA256  | Deterministic fingerprint for lookup/dedup of encrypted values. |

Both live in `@warlock.js/core`. For **password hashing** (a one-way job with very different requirements), reach for [`hash-password/SKILL.md`](../hash-password/SKILL.md) instead — bcrypt is the right tool there, not encrypt.

## The shape

```ts
import { encrypt, decrypt, hmacHash } from "@warlock.js/core";

// reversible — fast, integrity-checked, fresh IV per call
const cipherText = encrypt("sk-proj-12345");
const plainText = decrypt(cipherText);

// fingerprint — fast, deterministic (same input → same output)
const fingerprint = hmacHash("sk-proj-12345");
```

## Configuration — `src/config/encryption.ts`

```ts title="src/config/encryption.ts"
import type { EncryptionConfigurations } from "@warlock.js/core";
import { env } from "@warlock.js/core";

const encryptionConfig: EncryptionConfigurations = {
  key: env("APP_ENCRYPTION_KEY"),     // 64 hex chars = 32 bytes — required
  algorithm: "aes-256-gcm",            // optional, default
  hmacKey: env("APP_HMAC_KEY"),       // 64 hex chars — falls back to `key` if absent
};

export default encryptionConfig;
```

Generate the keys once (Node REPL):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put both in `.env` and **never rotate the encryption key without a migration** — every value encrypted under the old key becomes garbage. The HMAC key can rotate if you accept that fingerprints recomputed under the new key won't match historical ones.

## `encrypt` / `decrypt` — reversible secrets

For values you need to read back: API keys you'll later send to a third party, OAuth refresh tokens, credentials in a vault row. **Never use this for passwords** — you'd be storing recoverable plaintext, which means a database breach equals a credentials leak.

```ts title="src/app/ai-api-keys/services/create-ai-api-key.service.ts"
import { ConflictError, encrypt, hmacHash } from "@warlock.js/core";
import { AiApiKey } from "../models/ai-api-key";
import { aiApiKeysRepository } from "../repositories/ai-api-keys.repository";

export async function createAiApiKeyService(data: { key: string; organization_id: string }) {
  if (
    await aiApiKeysRepository.first({
      organization_id: data.organization_id,
      hash: hmacHash(data.key),
    })
  ) {
    throw new ConflictError("API key already exists");
  }

  return AiApiKey.create({
    ...data,
    key: encrypt(data.key),                // the secret, recoverable
    hash: hmacHash(data.key),              // the fingerprint, lookup-able
    last_four_chars: data.key.slice(-4),
  });
}
```

This is the canonical pattern: **encrypt the secret, hmacHash the same value for lookup**. Now you can find the row by user-provided plaintext (`first({ hash: hmacHash(input) })`) without ever decrypting, and `decrypt(row.get("key"))` recovers the secret when you need it.

```ts title="reading it back"
import { decrypt } from "@warlock.js/core";

const apiKey = await aiApiKeysRepository.first({ id });
const plainKey = decrypt(apiKey.get("key"));
```

### Format

`encrypt(plain)` returns `iv:ciphertext:authTag` — three hex chunks joined with `:`. The IV is a fresh 16-byte random per call, so encrypting the same input twice yields two different cipher texts (this is what you want — it defeats pattern analysis). The `authTag` is GCM's integrity check: if the stored ciphertext is tampered with, `decrypt()` throws.

`decrypt()` throws on:

- Invalid format (not three colon-separated parts).
- Wrong key.
- Tampered ciphertext (auth tag mismatch).
- Wrong algorithm vs the one used to encrypt.

Handle those at the boundary — they almost always mean misconfiguration or a corrupted row, not a runtime bug.

### Empty-string passthrough

Both `encrypt("")` and `decrypt("")` return `""` unchanged — convenient for nullable columns where `""` means "no value." `null` / `undefined` will throw at the type level (the signatures require `string`).

## `hmacHash` — deterministic fingerprints

A keyed one-way hash. Same input + same key always produces the same 64-hex-char output. Two properties that matter:

1. **Deterministic.** Use it to dedup or look up encrypted values without decrypting them.
2. **Keyed.** An attacker with the database but not the HMAC key can't precompute a rainbow table — they don't know which hash function you're using.

Three solid use cases:

```ts
// 1. Unique constraint on an encrypted column
await aiApiKeysRepository.first({ hash: hmacHash(userInput) });

// 2. Idempotency key derived from a payload
await idempotencyKeysRepository.first({ hash: hmacHash(JSON.stringify(request)) });

// 3. Fingerprint of a secret for audit logs (without storing the secret)
log.info("api-key", "used", { fingerprint: hmacHash(apiKey).slice(0, 8) });
```

**Do not use `hmacHash` for passwords.** It's fast — a brute-force attack with a stolen database would clear common passwords in minutes. That's what bcrypt is for (see [`hash-password/SKILL.md`](../hash-password/SKILL.md)).

## Common patterns

### Encrypt + fingerprint together (the canonical pattern)

```ts
await Model.create({
  key: encrypt(plain),
  hash: hmacHash(plain),                   // for lookups
  last_four_chars: plain.slice(-4),         // for UI display ("ending in 1234")
});
```

`last_four_chars` is useful in dashboards — show users which key is which without revealing it.

### Encrypt before persisting via a model accessor

```ts title="src/app/secrets/models/secret/secret.model.ts"
import { encrypt, decrypt } from "@warlock.js/core";

export class Secret extends Model {
  public setValue(plain: string) {
    this.set("value", encrypt(plain));
  }

  public getValue(): string {
    return decrypt(this.get("value"));
  }
}
```

Keeps the encryption boundary in one place — controllers and services deal in plaintext, the model handles the crypto.

### Audit log without leaking the secret

```ts
log.info("ai-api-key", "used", {
  organization_id,
  fingerprint: hmacHash(apiKey).slice(0, 8),  // first 8 hex chars = enough to correlate
});
```

You can search logs for the same fingerprint to track usage of a specific key across requests without ever storing the plaintext in your log pipeline.

### Idempotency keys

```ts
const idempotencyKey = hmacHash(JSON.stringify({
  user_id: user.id,
  action: "transfer",
  amount,
  to,
  // include a monotonic component if the same exact payload should be allowed twice
}));

const existing = await idempotencyRepository.first({ key: idempotencyKey });
if (existing) return existing.get("result");
```

Same payload → same key → returns the cached result. Different keys (because the HMAC is keyed) per environment if you set different `hmacKey` values.

## Gotchas

- **Never log decrypted values.** A log line is a leak. If you must debug, log the HMAC fingerprint, not the plaintext.
- **`encrypt`/`decrypt` keys must be 32 bytes (64 hex chars).** Anything else throws with a clear message. Don't truncate or pad.
- **Empty key value is fatal.** If `env("APP_ENCRYPTION_KEY")` returns `undefined`, the first `encrypt()` call throws "Missing encryption key" at runtime, not boot. Cover this in your startup health check.
- **HMAC falls back to the encryption key.** If `hmacKey` isn't set, `hmacHash` uses `key`. Convenient, but slightly weakens your isolation — best practice is two separate keys.
- **Don't reuse the same value across encrypt and password.** A bcrypt hash of a value isn't comparable to an encryption of that value. They're different domains.
- **Rotating the encryption key requires a migration.** Every existing ciphertext becomes unrecoverable under a new key. Plan rotation as: keep the old key as `OLD_APP_ENCRYPTION_KEY`, decrypt each row with old, encrypt with new, retire old key once the table is clean.

## Installation

`encrypt` / `decrypt` / `hmacHash` use Node's built-in `crypto` — no extra dependency. They're available out of the box.

Password hashing (`hashPassword`) needs `bcryptjs`, which is its own install — see [`hash-password/SKILL.md`](../hash-password/SKILL.md).

## See also

- [`hash-password/SKILL.md`](../hash-password/SKILL.md) — bcrypt password hashing (the third member of the encryption module, but a different job entirely).
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `src/config/encryption.ts` and env wiring.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — service layering, where the encryption boundary should sit.
