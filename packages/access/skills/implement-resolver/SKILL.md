---
name: implement-resolver
description: 'Connect `@warlock.js/access` to your role/permission storage by implementing the `AccessResolver` contract (`rolesOf` / `permissionsOf`) — for a user column, a pivot table, a token claim, an external directory, or a hybrid. The engine owns matching / caching / policies; the resolver only fetches. TRIGGER: `AccessResolver`, "custom resolver", "where do roles come from", "roles in a token claim", "permissions from an external API", "direct permissions per user", "implement resolver". Skip: the built-in resolvers — `@warlock.js/access/configure-access/SKILL.md`.'
---

# Implement a resolver

When neither built-in (`DefaultAccessResolver`, `ModelAccessResolver`) fits your storage, implement the contract. It's the ONE thing only you can write — your schema — and it's just a function over your own data. The engine does the rest.

```ts
export interface AccessResolver {
  rolesOf(user: Auth, tenant?: string): Promise<string[]>; //       powers hasRole
  permissionsOf(user: Auth, tenant?: string): Promise<string[]>; // powers can / authorize
}
```

Register it: `access: { resolver: new MyResolver() }`.

## Recipes

**A single role column, permissions mapped in code**

```ts
class ColumnResolver implements AccessResolver {
  public constructor(private readonly roles: Record<string, string[]>) {}
  async rolesOf(user) {
    return [user.get("role")].filter(Boolean);
  }
  async permissionsOf(user) {
    return (await this.rolesOf(user)).flatMap((role) => this.roles[role] ?? []);
  }
}
```

**Roles from a token claim (external IdP — no DB)**

```ts
class ClaimResolver implements AccessResolver {
  async rolesOf(user) {
    return user.get("decodedAccessToken")?.roles ?? [];
  }
  async permissionsOf(user) {
    return user.get("decodedAccessToken")?.permissions ?? [];
  }
}
```

**Direct permissions per user (role is just a label)**

```ts
class DirectResolver implements AccessResolver {
  async rolesOf(user) {
    return [user.get("role")];
  }
  async permissionsOf(user) {
    const rows = await UserPermission.query().where({ user_id: user.id }).get();
    return rows.map((row) => row.get("name") as string);
  }
}
```

## Rules

- **Only fetch — never cache inside the resolver.** The engine caches per `(user, tenant)`; caching twice causes stale grants. Invalidate with `access.flush(user, tenant)` when your data changes.
- Return plain `string[]`. Wildcards (`orders.*`, `*`) in the returned permissions are honored by the engine.
- `rolesOf` and `permissionsOf` may read **different** sources — roles and permissions are independent axes (a role can be a pure label with permissions granted directly).
- Throwing from the resolver fails the check **closed** (denied + logged).

## See also

- [`@warlock.js/access/configure-access/SKILL.md`](@warlock.js/access/configure-access/SKILL.md) — the built-in resolvers.
