---
title: "The resolver"
description: The one adapter you give the engine — and why authorization is split this way.
sidebar:
  order: 2
  label: "The resolver"
---

There are a dozen ways to store roles — a column on the user, a pivot table, a token claim, an external directory. The package refuses to pick one for you. Instead it depends on a single seam, the **resolver**, which you supply — and `npx warlock add access` ejects a working DB-backed one to start from.

## The contract

```ts
export interface AccessResolver {
  resolveRoles(user: Auth, tenant?: string): Promise<string[]>; //       powers hasRole
  resolvePermissions(user: Auth, tenant?: string): Promise<string[]>; // powers can / authorize
  resolveTenant?(user: Auth): string | undefined; //                     optional ambient tenant
}
```

Two methods that return plain string arrays, plus an optional `resolveTenant`. That's the whole thing the package can't know — your schema — and it's the only thing you supply. The engine does everything else: wildcard matching, caching, policies, fail-closed.

> **Thick engine, thin adapter.** The resolver only *fetches*. Never cache inside it — the engine caches per `(user, tenant)` for you, and a second cache layer would serve stale grants.

## The two starting points

You rarely write a resolver from scratch:

- **`DatabaseAccessResolver`** (the eject) — reads roles from the `user_roles` table and maps them through the `roles` catalog table. Multi-role, per-tenant, runtime-editable. This is what `npx warlock add access` wires up, and it lives in your app at `src/app/access/services/access-resolver.ts`, so you own it.
- **`DefaultAccessResolver`** (built into the package) — takes a fixed `{ role: [permissions] }` catalog inline and reads each user's roles from `user.get("roles")` (or a single `user.get("role")`). Zero tables. **Not tenant-aware** — it returns the same roles in every tenant; use the DB-backed resolver for per-tenant roles.

## Two independent axes

`resolveRoles` and `resolvePermissions` can read **different** sources. A role can be a pure label (`admin`, `moderator`) while permissions come from somewhere else entirely:

```ts
class DirectResolver implements AccessResolver {
  public async resolveRoles(user: Auth): Promise<string[]> {
    return [user.get("role")]; // a label
  }

  public async resolvePermissions(user: Auth): Promise<string[]> {
    const rows = await UserPermission.query().where({ user_id: user.id }).get();

    return rows.map((row) => row.get("name") as string); // granted directly
  }
}
```

This is why "the user has a role like `admin`, and permissions are stored separately" is a first-class shape, not a workaround.

## Roles from a token claim (no database)

If an external identity provider (Auth0, Keycloak, Cognito) puts roles in the JWT, the resolver reads them straight off the decoded token:

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

Register any resolver with `access: { resolver: new MyResolver() }`. See the [implement-resolver guide](../guides/implement-resolver.md) for more recipes.
