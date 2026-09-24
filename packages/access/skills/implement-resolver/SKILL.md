---
name: implement-resolver
description: 'Connect `@warlock.js/access` to your role/permission storage by implementing the `AccessResolver` contract (`resolveRoles` / `resolvePermissions`, optional `resolveTenant`) — for a DB-backed catalog, a user column, a pivot table, a token claim, or an external directory. The engine owns matching / caching / policies; the resolver only fetches. TRIGGER: `AccessResolver`, `DatabaseAccessResolver`, `resolveTenant`, "custom resolver", "where do roles come from", "roles in a token claim", "permissions from an external API", "implement resolver". Skip: the quickstart `DefaultAccessResolver` — `@warlock.js/access/configure-access/SKILL.md`.'
---

# Implement a resolver

The resolver is the ONE thing only you can write — your schema — and it's just a function over your own data. The engine does matching, caching, policies, and fail-closed for you.

```ts
export interface AccessResolver {
  resolveRoles(user: Auth, tenant?: string): Promise<string[]>; //       powers hasRole
  resolvePermissions(user: Auth, tenant?: string): Promise<string[]>; // powers can / authorize
  resolveTenant?(user: Auth): string | undefined; //                     optional ambient tenant
}
```

Register it: `access: { resolver: new MyResolver() }`.

## The default: dynamic, DB-backed (ejected)

`npx warlock add access` ejects this `DatabaseAccessResolver` — roles come from the `user_roles` table, permissions are joined through the `roles` catalog table. This is what most apps run, because admins manage roles + permissions at runtime.

```ts
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

  // Multi-tenant? Uncomment to scope checks to the user's tenant. Derive it from
  // the user — never trust client-supplied request input for the tenant boundary:
  // public resolveTenant(user: Auth): string | undefined {
  //   return user.get("organization_id");
  // }
}
```

## Other recipes

**A single role column, permissions mapped in code**

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

**Roles from a token claim (external IdP — no DB)**

```ts
class ClaimResolver implements AccessResolver {
  public async resolveRoles(user: Auth): Promise<string[]> {
    return user.get("decodedAccessToken")?.roles ?? [];
  }
  public async resolvePermissions(user: Auth): Promise<string[]> {
    return user.get("decodedAccessToken")?.permissions ?? [];
  }
}
```

**Direct permissions per user (role is just a label)**

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

## Rules

- **Only fetch — never cache inside the resolver.** The engine caches per `(user, tenant)`; caching twice causes stale grants. Invalidate with `access.flush(user, tenant)` when your data changes.
- Return plain `string[]`. Wildcards (`orders.*`, `*`) in the returned permissions are honored by the engine.
- `resolveRoles` and `resolvePermissions` may read **different** sources — roles and permissions are independent axes (a role can be a pure label with permissions granted directly).
- Throwing from the resolver fails the check **closed** (denied + logged).

## See also

- [`@warlock.js/access/configure-access/SKILL.md`](@warlock.js/access/configure-access/SKILL.md) — the quickstart `DefaultAccessResolver`.
```
