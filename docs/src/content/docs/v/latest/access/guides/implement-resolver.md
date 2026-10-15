---
title: "Implement a resolver"
description: Connect the engine to any role/permission storage by implementing AccessResolver.
sidebar:
  order: 4
  label: "Implement a resolver"
---

The resolver is the one piece only you can write — your schema — and it's just a function over your own data. `npx warlock add access` ejects a working DB-backed one; this guide shows what's inside it and how to write your own when your storage differs.

```ts
export interface AccessResolver {
  resolveRoles(user: Auth, tenant?: string): Promise<string[]>; //       powers hasRole
  resolvePermissions(user: Auth, tenant?: string): Promise<string[]>; // powers can / authorize
  resolveTenant?(user: Auth): string | undefined; //                     optional ambient tenant
}
```

Register it: `access: { resolver: new MyResolver() }`.

## The DB-backed resolver (the eject)

The default `DatabaseAccessResolver` reads roles from the `user_roles` table and joins them through the `roles` catalog table — so roles and their permissions are both managed at runtime. This is the shape `npx warlock add access` scaffolds into `src/app/access/services/access-resolver.ts`:

```ts title="src/app/access/services/access-resolver.ts"
import type { AccessResolver } from "@warlock.js/access";
import type { Auth } from "@warlock.js/auth";
import { Role } from "app/access/models/role";
import { UserRole } from "app/access/models/user-role";

export class DatabaseAccessResolver implements AccessResolver {
  public async resolveRoles(user: Auth, tenant?: string): Promise<string[]> {
    return UserRole.rolesFor(user, tenant);
  }

  public async resolvePermissions(user: Auth, tenant?: string): Promise<string[]> {
    const names = await this.resolveRoles(user, tenant);

    if (names.length === 0) return [];

    const roles = await Role.query().whereIn("name", names).get();

    return [...new Set(roles.flatMap((role) => role.permissions))];
  }

  // Multi-tenant? Uncomment to derive the active tenant from the user, so
  // checks scope to it without passing `{ tenant }` every time. Reading the
  // tenant off the user is safer than trusting client-supplied request input.
  // public resolveTenant(user: Auth): string | undefined {
  //   return user.get("organization_id");
  // }
}
```

`UserRole.rolesFor` filters by `tenant: tenant ?? null`, so an unresolved tenant reads **global** rows only — never the cross-tenant union. Keep that invariant if you rewrite the query.

## A single role column, permissions in code

```ts
class ColumnResolver implements AccessResolver {
  public constructor(private readonly roles: Record<string, string[]>) {}

  public async resolveRoles(user: Auth): Promise<string[]> {
    return [user.get("role")].filter(Boolean);
  }

  public async resolvePermissions(user: Auth): Promise<string[]> {
    return (await this.resolveRoles(user)).flatMap((role) => this.roles[role] ?? []);
  }
}
```

## Direct permissions per user (role is a label)

```ts
class DirectResolver implements AccessResolver {
  public async resolveRoles(user: Auth): Promise<string[]> {
    return [user.get("role")];
  }

  public async resolvePermissions(user: Auth): Promise<string[]> {
    const rows = await UserPermission.query().where({ user_id: user.id }).get();

    return rows.map((row) => row.get("name") as string);
  }
}
```

## Hybrid — role permissions plus direct grants

```ts
class HybridResolver implements AccessResolver {
  public constructor(private readonly roles: Record<string, string[]>) {}

  public async resolveRoles(user: Auth): Promise<string[]> {
    return user.get("roles") ?? [];
  }

  public async resolvePermissions(user: Auth): Promise<string[]> {
    const fromRoles = (await this.resolveRoles(user)).flatMap((role) => this.roles[role] ?? []);
    const direct = user.get("extraPermissions") ?? [];

    return [...fromRoles, ...direct];
  }
}
```

## Rules

- **Only fetch — never cache inside the resolver.** The engine caches per `(user, tenant)`; a second cache serves stale grants. Invalidate with `access.flush(user, tenant)` when your data changes.
- Return plain `string[]`. Wildcards (`orders.*`, `*`) in the returned permissions are honored by the engine.
- `resolveRoles` and `resolvePermissions` may read different sources — roles and permissions are independent axes.
- `resolveTenant(user)` is optional — return `undefined` for single-tenant apps. Derive the tenant from the user (e.g. `user.get("organization_id")`) — safer than trusting client request input. An unresolved tenant must read global rows only, never the cross-tenant union.
- Throwing from the resolver fails the check **closed** (denied + logged).
