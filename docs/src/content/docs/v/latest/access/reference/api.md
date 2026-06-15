---
title: "API reference"
description: The exported surface of @warlock.js/access.
sidebar:
  order: 1
  label: "API"
---

Everything `@warlock.js/access` exports. All check functions are also available on the `access` facade object (`access.can`, `access.authorize`, …).

## Permission checks

| Export | Signature | Notes |
| --- | --- | --- |
| `can` | `(user, permission, ctx?) => Promise<boolean>` | grant (and policy, if a `resource` is in `ctx`) |
| `cannot` | `(user, permission, ctx?) => Promise<boolean>` | inverse of `can` |
| `canAll` | `(user, permissions[], ctx?) => Promise<boolean>` | every permission; short-circuits |
| `canAny` | `(user, permissions[], ctx?) => Promise<boolean>` | any permission; short-circuits |
| `authorize` | `(user, permission, ctx?) => Promise<void>` | throws `ForbiddenError` (403) on deny |
| `authorizeAll` | `(user, permissions[], ctx?) => Promise<void>` | throws unless all pass |
| `authorizeAny` | `(user, permissions[], ctx?) => Promise<void>` | throws unless any passes |

## Role checks

| Export | Signature |
| --- | --- |
| `hasRole` | `(user, role, tenant?) => Promise<boolean>` |
| `hasAnyRole` | `(user, roles[], tenant?) => Promise<boolean>` |
| `hasAllRoles` | `(user, roles[], tenant?) => Promise<boolean>` |

## Cache

| Export | Signature | Notes |
| --- | --- | --- |
| `access.flush` / `flush` | `(user, tenant?) => Promise<void>` | drop the cached role/permission set after you mutate role rows |

Role assignment is **not** in the package — it lives on the ejected `UserRole` model in your app (`UserRole.assign` / `UserRole.revoke`). Call those, then `access.flush(user, tenant)`.

## Policies

| Export | Signature |
| --- | --- |
| `definePolicy` | `(permission, (user, resource, ctx) => boolean \| Promise<boolean>) => void` |

## Middleware

| Export | Signature | Notes |
| --- | --- | --- |
| `gate` | `(permission) => Middleware` | class-level route gate |
| `gateAny` | `(permissions[]) => Middleware` | passes on any |
| `gateAll` | `(permissions[]) => Middleware` | passes on all |

Stack these after `authMiddleware` (they read `request.user`).

## Resolvers

| Export | Notes |
| --- | --- |
| `AccessResolver` | the contract — `resolveRoles` + `resolvePermissions` + optional `resolveTenant` |
| `DefaultAccessResolver` | `new (roles, readRoles?)` — fixed inline catalog; reads roles off the user model |

`resolveTenant?(user: Auth): string \| undefined` is the optional third method — implement it to supply the ambient tenant when a check doesn't pass one. It receives the user, so derive the tenant from there (e.g. `user.get("organization_id")`) — safer than trusting client request input. The DB-backed resolver and the role tables (`Role`, `UserRole`) are **ejected into your app** (`npx warlock add access`), not exported by the package.

## Errors & types

| Export | Notes |
| --- | --- |
| `AccessErrorCodes` | `Forbidden = "EC100"` |
| `AccessConfigError` | thrown loudly on misconfig (e.g. no resolver) — not a silent deny |
| `AccessConfigurations` | `config.access.*` shape — `{ resolver, cache?: { ttl } }` |
| `AccessContext` | check context — reserved `resource` / `tenant` + free-form |
| `PolicyContext` | what a policy receives — `tenant`, `hasRole`, `hasPermission`, free-form |
| `PolicyFn` | `(user, resource, ctx) => boolean \| Promise<boolean>` |
| `RolesMap` | `Record<string, string[]>` |

## Decision semantics

- `can` / `authorize` = **grant AND (no policy OR policy passes)**. A policy runs only when `ctx.resource` is supplied.
- Wildcards: `*` (super-grant), `orders.*` (prefix, nested-aware — but **not** the bare `orders`), exact.
- **Fails closed** — any error resolving a decision denies and logs.
- The cache is **best-effort** — a cache failure degrades to the resolver, never denies.
- Tenant = `ctx.tenant ?? resolver.resolveTenant?.(user) ?? undefined`.
- A missing `resolver` throws `AccessConfigError` (loud) **at boot** instead of denying.
