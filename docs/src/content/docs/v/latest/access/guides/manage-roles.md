---
title: "Manage roles"
description: Assign and revoke roles via the ejected UserRole model, read them with hasRole, and where the catalog lives.
sidebar:
  order: 3
  label: "Manage roles"
---

`npx warlock add access` ejects two models into your app: `Role` (the catalog — each role and the permissions it grants) and `UserRole` (assignments — which user holds which role, in which tenant). Both live under `src/app/access/models/`, so you own and evolve them. Assignment is a write to `UserRole`; the catalog is a row in `Role`.

## Assign and revoke

Use the `UserRole` statics. `assign` and `revoke` **auto-flush** the affected user's cached set, so the next check reflects the change without a manual call:

```ts
import { UserRole } from "app/access/models/user-role";

await UserRole.assign(user, "editor", "tenant-1"); // editor in tenant-1 — flushes tenant-1
await UserRole.assign(user, "viewer", "tenant-2"); // viewer in tenant-2 — same user, different role
await UserRole.revoke(user, "editor", "tenant-1"); // revokes and flushes tenant-1
```

Reach for `access.flush(user, tenant)` manually only for **other out-of-band changes** — editing a `Role` row's permissions, or mutating role rows through a path that bypasses `assign` / `revoke`:

```ts
import { access } from "@warlock.js/access";

await access.flush(user, "tenant-1"); // after an out-of-band change to this user's grants
```

The `tenant` argument is optional — omit it for single-tenant apps (roles are stored globally). In a **multi-tenant** app, always pass the tenant: an omitted or unresolved tenant scopes to global roles only, never the cross-tenant union.

## Manage the catalog

A role's permissions are a `Role` row, edited at runtime — no deploy:

```ts
import { Role } from "app/access/models/role";

await Role.create({ name: "editor", permissions: ["orders.*", "posts.create"] });

const role = await Role.first({ name: "editor" });
role.set("permissions", ["orders.*", "posts.*"]);
await role.save();
```

The `DatabaseAccessResolver` reads these rows when it resolves a user's permissions, so an admin screen over the `Role` table is your runtime permission catalog.

## Read roles

```ts
import { hasRole, hasAnyRole, hasAllRoles } from "@warlock.js/access";

await hasRole(user, "editor"); //              tenant is an optional 3rd argument
await hasAnyRole(user, ["admin", "manager"]);
await hasAllRoles(user, ["staff", "verified"]);
```

:::tip[Prefer permission checks]
Role checks couple your code to the role taxonomy — rename a role and every `hasRole("editor")` breaks. `can(user, "orders.update")` survives the rename. Reach for `hasRole` only for coarse UI gating.
:::

## Extend the model

`UserRole` is a plain cascade model in your app — `{ user_id, user_type, role, tenant }`. Add columns the way you would any model: extend its schema and migration in `src/app/access/models/user-role/`. Because it's ejected, there's no subclass-and-rewire step — you edit the file directly.

`user_id` defaults to `uuid` in the ejected `UserRole` migration (`src/app/access/models/user-role/migrations/`). If your user ids are integers, change the column type in that migration before you run it.

## Roles stored on the user?

If you'd rather keep roles as a column on the user model or in a token claim, you don't use the `UserRole` table at all — swap `DatabaseAccessResolver` for a resolver that reads them. See [implement a resolver](./implement-resolver.md).
