---
title: "API reference"
description: Every exported identifier in @warlock.js/auth — signature, one-line purpose, source link.
sidebar:
  order: 1
  label: "API reference"
---

Every public export from `@warlock.js/auth`. Signatures are condensed for readability; the source link is canonical.

## Models

### `Auth<Schema>`

```ts
abstract class Auth<Schema extends ModelSchema = ModelSchema> extends Model<Schema>
```

Abstract base for every user model. Subclass + override `userType`.

```ts
import { Auth } from "@warlock.js/auth";

@RegisterModel()
export class User extends Auth<typeof userSchema> {
  public get userType() { return "user"; }
}
```

Source: `@warlock.js/auth/src/models/auth.model.ts`.

### `AccessToken`

```ts
class AccessToken extends Model
```

Cascade model backing the `access_tokens` table. Columns: `token`, `user_id`, `user_type`, `is_active`, `last_access`.

Source: `@warlock.js/auth/src/models/access-token/access-token.model.ts`.

### `RefreshToken`

```ts
class RefreshToken extends Model {
  public get isExpired(): boolean;
  public get isRevoked(): boolean;
  public get isValid(): boolean;
  public revoke(): Promise<this>;
  public markAsUsed(): Promise<void>;
}
```

Cascade model backing `refresh_tokens`. The instance getters drive validation; `.revoke()` is soft (stamps `revoked_at`).

Source: `@warlock.js/auth/src/models/refresh-token/refresh-token.model.ts`.

### `authMigrations`

```ts
const authMigrations: Migration[];
```

The migrations array — `[AccessTokenMigration, RefreshTokenMigration]`. Spread into your `defineConfig({ database: { migrations: [...] } })`.

Source: `@warlock.js/auth/src/models/index.ts`.

## Services

### `authService`

The singleton orchestrator. Selected methods:

```ts
login<T>(Model, credentials, deviceInfo?): Promise<LoginResult<T> | null>;
attemptLogin<T>(Model, data): Promise<T | null>;
logout(user, accessToken?, refreshToken?): Promise<void>;

generateAccessToken(user, payload?): Promise<AccessTokenOutput>;
createRefreshToken(user, deviceInfo?): Promise<RefreshToken | undefined>;
createTokenPair(user, deviceInfo?): Promise<TokenPair>;
refreshTokens(refreshTokenString, deviceInfo?): Promise<TokenPair | null>;

removeAccessToken(user, token): Promise<void>;
removeRefreshToken(user, token): Promise<void>;
removeAllAccessTokens(user): Promise<void>;
revokeAllTokens(user): Promise<void>;
revokeTokenFamily(familyId): Promise<void>;

cleanupExpiredTokens(): Promise<number>;
getActiveSessions(user): Promise<RefreshToken[]>;

hashPassword(password): Promise<string>;
verifyPassword(plain, hash): Promise<boolean>;
buildAccessTokenPayload(user): { id, userType, created_at };
```

Source: `@warlock.js/auth/src/services/auth.service.ts`.

### `jwt`

Low-level signing / verification:

```ts
jwt.generate(payload, options?): Promise<string>;
jwt.verify<T>(token, options?): Promise<T>;
jwt.generateRefreshToken(payload, options?): Promise<string>;
jwt.verifyRefreshToken<T>(token, options?): Promise<T>;
```

Options accept the full `fast-jwt` `SignerOptions` / `VerifierOptions` plus an optional `key` override. Defaults come from `config.auth.jwt.*`.

Source: `@warlock.js/auth/src/services/jwt.ts`.

### `authEvents`

Type-safe event bus.

```ts
authEvents.on<T>(event, callback): EventSubscription;
authEvents.subscribe<T>(event, callback): EventSubscription;   // alias for on
authEvents.emit<T>(event, ...args): void;
authEvents.trigger<T>(event, ...args): void;                    // alias for emit
authEvents.off(event?): void;
authEvents.unsubscribeAll(): void;
```

Event names: `login.attempt`, `login.success`, `login.failed`, `logout`, `logout.all`, `logout.failsafe`, `token.created`, `token.refreshed`, `token.revoked`, `token.expired`, `token.familyRevoked`, `password.changed`, `password.resetRequested`, `password.reset`, `session.created`, `session.destroyed`, `cleanup.completed`.

Source: `@warlock.js/auth/src/services/auth-events.ts`.

### `generateJWTSecret`

```ts
function generateJWTSecret(): Promise<void>;
```

The action behind `warlock jwt.generate` — appends `JWT_SECRET` + `JWT_REFRESH_SECRET` to `.env`. Idempotent.

Source: `@warlock.js/auth/src/services/generate-jwt-secret.ts`.

## Middleware

### `authMiddleware`

```ts
function authMiddleware(allowedUserType: string | string[]): Middleware;
```

Route gate. The argument is required and a valid token is always required (no anonymous mode). Empty array = any authenticated user. String / array = restricted to the listed user types. Public routes omit the middleware.

```ts
router.get("/account",    accountController, { middleware: [authMiddleware([])] });
router.get("/admin",      adminController,   { middleware: [authMiddleware("admin")] });
router.get("/staff-area", staffController,   { middleware: [authMiddleware(["staff", "admin"])] });
```

Source: `@warlock.js/auth/src/middleware/auth.middleware.ts`.

## Commands

### `registerJWTSecretGeneratorCommand`

```ts
function registerJWTSecretGeneratorCommand(): CLICommand;
```

Returns the `jwt.generate` command. Spread into `defineConfig({ cli: { commands: [...] } })`.

Source: `@warlock.js/auth/src/commands/jwt-secret-generator-command.ts`.

### `registerAuthCleanupCommand`

```ts
function registerAuthCleanupCommand(): CLICommand;
```

Returns the `auth.cleanup` command. Same registration pattern.

Source: `@warlock.js/auth/src/commands/auth-cleanup-command.ts`.

## Contracts + types

### `Authenticable`

```ts
interface Authenticable {
  get userType(): string;
  generateAccessToken(payload?: Record<string, unknown>): Promise<AccessTokenOutput>;
  generateRefreshToken(deviceInfo?: DeviceInfo): Promise<RefreshToken | undefined>;
  createTokenPair(deviceInfo?: DeviceInfo): Promise<TokenPair>;
  confirmPassword(password: string): Promise<boolean>;
}
```

The contract the `Auth` base implements (`class Auth ... implements Authenticable`) — it mirrors the base's auth surface exactly, so the class fails to compile if the two drift. Useful when typing slots that accept either user-type model.

Source: `@warlock.js/auth/src/contracts/auth-contract.ts`.

### `AuthConfigurations`

The shape of `src/config/auth.ts`. See [Configuration](../getting-started/03-configuration.mdx) for the field-by-field walk-through.

Source: `@warlock.js/auth/src/contracts/types.ts`.

### `AccessTokenOutput`

```ts
type AccessTokenOutput = { token: string; expiresAt: string };
```

The wire shape of an issued token. `expiresAt` is ISO UTC.

### `TokenPair`

```ts
type TokenPair = {
  accessToken: AccessTokenOutput;
  refreshToken?: AccessTokenOutput;
};
```

Returned by `createTokenPair`, `refreshTokens`, and `login`. `refreshToken` is omitted when `config.auth.jwt.refresh.enabled` is `false`.

### `DeviceInfo`

```ts
type DeviceInfo = {
  userAgent?: string;
  ip?: string;
  deviceId?: string;
  familyId?: string;
  payload?: Record<string, any>;
};
```

Metadata for token issuance. `userAgent`/`ip`/`deviceId` land on `refresh_tokens.device_info`. `familyId` continues an existing rotation chain (internal). `payload` overrides the default access-token payload.

### `LoginResult<UserType>`

```ts
type LoginResult<UserType extends Auth> = {
  user: UserType;
  tokens: TokenPair;
};
```

The successful return of `authService.login`.

### `LogoutWithoutTokenBehavior`

```ts
type LogoutWithoutTokenBehavior = "revoke-all" | "error";
```

Controls `config.auth.jwt.refresh.logoutWithoutToken`. Default is `"revoke-all"`.

### `NO_EXPIRATION`

```ts
const NO_EXPIRATION = "100y";
```

Sentinel for "effectively no expiry". Used as `jwt.expiresIn: NO_EXPIRATION`.

Source: `@warlock.js/auth/src/contracts/types.ts`.

## Utilities

### `AuthErrorCodes`

```ts
enum AuthErrorCodes {
  MissingAccessToken = "EC001",
  InvalidAccessToken = "EC002",
  Unauthorized = "EC003",
}
```

The error-code values the middleware returns alongside the localized message. Switch on these on the client.

Source: `@warlock.js/auth/src/utils/auth-error-codes.ts`.

## Related

- [Configuration](../getting-started/03-configuration.mdx) — option-by-option walkthrough of `AuthConfigurations`.
- [Manage tokens](../guides/manage-tokens.md) — what each service method actually does.
- [The auth flow](../essentials/01-the-auth-flow.md) — how the pieces fit together.
