---
name: hash-password
description: 'One-way bcrypt password hashing — `hashPassword` / `verifyPassword`, plus the declarative `useHashedPassword()` schema transformer that auto-hashes a model''s password field on save. Salt rounds come from `src/config/encryption.ts`. Triggers: `hashPassword`, `verifyPassword`, `useHashedPassword`, `password.salt`, `bcryptjs`; "hash a user password", "verify login credentials", "auto-hash on save", "rotate a password"; typical import `import { hashPassword, verifyPassword } from "@warlock.js/core"`. Skip: reversible secrets — `@warlock.js/core/encrypt-data/SKILL.md`; the other transformers — `@warlock.js/core/use-model-transformers/SKILL.md`; config wiring — `@warlock.js/core/configure-app/SKILL.md`; competing libs `bcrypt` native, `argon2`, `scrypt`.'
---

# Warlock — hash a password

For storing user-typed passwords, bcrypt is the one right answer — and the only one. It's **deliberately slow** (~250ms per call with the default salt rounds), which is what makes it expensive to brute-force a stolen password database. Use it for nothing else: not API keys, not session tokens, not "this needs to be one-way."

If your value needs to be read back later → [`encrypt-data/SKILL.md`](../encrypt-data/SKILL.md).
If you need a fast searchable fingerprint of an encrypted value → also `encrypt-data` (`hmacHash`).

## The shape

```ts
import { hashPassword, verifyPassword } from "@warlock.js/core";

const hashed = await hashPassword("user-password-123");
// → "$2b$12$..." — store this

const valid = await verifyPassword("user-password-123", hashed);
// → true / false
```

Both are async because bcrypt is CPU-bound. The framework uses `bcryptjs` (pure JS — portable across every platform, no native build) under the hood.

## Configuration — `src/config/encryption.ts`

```ts title="src/config/encryption.ts"
import type { EncryptionConfigurations } from "@warlock.js/core";

const encryptionConfig: EncryptionConfigurations = {
  password: {
    salt: 12,    // bcrypt rounds — 10–12 is the standard band
  },
  // ...other crypto config (key/hmacKey for encrypt/decrypt — see encrypt-data skill)
};

export default encryptionConfig;
```

The `salt` knob is bcrypt's **work factor** — `2^salt` iterations per hash. Each unit doubles the cost. `12` is the modern default; bump to `13`/`14` if your hardware is fast enough that login feels instant and you want a bigger brute-force tax. Don't go below `10` — that's the lower bound for modern security.

## `hashPassword` / `verifyPassword`

```ts title="src/app/users/services/register-user.service.ts"
import { hashPassword } from "@warlock.js/core";
import { User } from "../models/user";

export async function registerUserService(input: { email: string; password: string }) {
  const user = await User.create({
    email: input.email,
    password: await hashPassword(input.password),
  });

  return user;
}
```

```ts title="src/app/auth/services/verify-credentials.service.ts"
import { verifyPassword } from "@warlock.js/core";
import { usersRepository } from "app/users/repositories/users.repository";

export async function verifyCredentialsService(email: string, password: string) {
  const user = await usersRepository.first({ email });
  if (!user) return null;

  const isValid = await verifyPassword(password, user.get("password"));
  return isValid ? user : null;
}
```

The `@warlock.js/auth` package wires both into its `auth.service.ts` — `authService.hashPassword(p)` and `authService.verifyPassword(plain, hash)` are thin proxies over these helpers. Use the auth service if you're using `@warlock.js/auth`; use the core helpers directly if you're rolling your own.

## The declarative pattern — `useHashedPassword()`

Manually calling `hashPassword` in every service that touches a password is repetitive and easy to forget. The framework offers a **schema transformer** that auto-hashes the field on save:

```ts title="src/app/users/models/user/user.model.ts"
import { useHashedPassword } from "@warlock.js/core";
import { type Infer, v } from "@warlock.js/seal";

export const userSchema = v.object({
  email: v.email().unique("User"),
  password: v.string().requiredIfEmpty("id").addTransformer(useHashedPassword()),
});

export type UserSchema = Infer<typeof userSchema>;
```

What it does:

- **New row** → hashes `password` once on `.create()` / `.save()`.
- **Existing row** → only re-hashes when the field actually changes; leaves the stored hash alone otherwise.
- **Empty / undefined value** → returns the value untouched (won't double-hash, won't overwrite with `undefined`).

Internally it calls `authService.hashPassword(value)`, which is the same bcryptjs path as the standalone helper — just attached to the schema so controllers and services never deal with plaintext storage. Pass `request.validated().password` straight into `User.create({...})` and the transformer handles the hashing.

This is the **recommended pattern** for user models. The standalone helper is for non-schema contexts (CLI tools generating users, one-off scripts, custom auth services).

## Common patterns

### Rotate a user's password

```ts
import { hashPassword, verifyPassword } from "@warlock.js/core";

const user = await usersRepository.findById(id);

if (!(await verifyPassword(oldPassword, user.get("password")))) {
  throw new BadRequestError("Current password incorrect");
}

await user.save({ password: await hashPassword(newPassword) });
```

If the model uses `useHashedPassword()`, you can skip the explicit `hashPassword` call:

```ts
await user.save({ password: newPassword });  // transformer hashes on save
```

The transformer detects that the field is changing and re-hashes.

### Login flow

```ts
import { verifyPassword } from "@warlock.js/core";

const user = await usersRepository.first({ email });
if (!user) {
  // Same response shape as "wrong password" to prevent email enumeration
  throw new BadRequestError("Invalid credentials");
}

const valid = await verifyPassword(password, user.get("password"));
if (!valid) {
  throw new BadRequestError("Invalid credentials");
}

return user;
```

The "same error for missing user vs wrong password" pattern is deliberate — it stops attackers from learning which emails are registered.

## Installation

`hashPassword` / `verifyPassword` need `bcryptjs`. Install it directly:

```bash
yarn add bcryptjs
```

If you skip the install, the first call throws with the framework's install hint:

```
Password encryption requires the bcryptjs package.
Install it with:

  yarn add bcryptjs

Or with your preferred package manager:

  yarn add bcryptjs
```

There is no `warlock add` feature for password hashing — `bcryptjs` is a plain dependency, so install it directly with `yarn add bcryptjs`.

## Gotchas

- **Never use `hashPassword` for non-password values.** A 250ms tax on every API request because someone reached for it as a "general one-way hash" — that's a performance bug waiting to happen. For one-way fingerprinting of encrypted values, use `hmacHash` (see [`encrypt-data/SKILL.md`](../encrypt-data/SKILL.md)).
- **Don't `hashPassword` on the request hot path twice.** Each call is ~250ms. If you `hashPassword(input)` then call it again as part of `verifyPassword`'s internals (you don't), you're stacking the tax. `verifyPassword(plain, storedHash)` takes the plaintext and the stored hash — that's the API.
- **Don't swap `bcryptjs` for native `bcrypt` without a reason.** `bcryptjs` is portable across every platform (no native build), and the perf delta isn't meaningful in the password-verification workflow.
- **The transformer detects changes by comparison.** If your model's password field is `null` and you save `null` again, it's a no-op. If it's a hash and you save the same hash string, also no-op. Only an actual value change triggers re-hashing.
- **Don't strip the hash before sending the user back to the client.** Use a resource layer (`UserResource`) that excludes the password field — that's where filtering belongs, not in your service code.

## See also

- [`use-model-transformers/SKILL.md`](../use-model-transformers/SKILL.md) — `useHashedPassword` + the two other model transformers (`useComputedSlug`, `useComputedModel`).
- [`encrypt-data/SKILL.md`](../encrypt-data/SKILL.md) — reversible AES-256-GCM `encrypt`/`decrypt` + one-way HMAC `hmacHash` (the other two members of the encryption module).
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `src/config/encryption.ts` and the `password.salt` knob.
- [`define-resource/SKILL.md`](../define-resource/SKILL.md) — where to filter the password field out of API responses.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — service layering, where the password boundary should sit.
