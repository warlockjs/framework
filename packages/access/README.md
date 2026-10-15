# Warlock Access

Authorization (RBAC + ABAC) for [Warlock.js](https://github.com/warlockjs/core) applications — permission checks (`can` / `authorize` / `gate`), attribute-based `definePolicy` conditions, role checks, and a pluggable `AccessResolver` that connects the engine to however your app stores roles.

`@warlock.js/auth` answers _who you are_; `@warlock.js/access` answers _what you can do_.

## Server-only

`@warlock.js/access`'s entire runtime surface is server-only — its `package.json` declares `"warlock": { "environment": "server" }`. `@warlock.js/web`'s build treats this as a boundary: app client code cannot value-import this package (type-only imports are still allowed), while server loaders/controllers/modules can import it freely.

## Installation

```bash
npx warlock add access
```

This ejects `src/config/access.ts`, a DB-backed `DatabaseAccessResolver`, the `Role` + `UserRole` tables, and registers the locale. `@warlock.js/access` reads `request.user`, so it lives inside a Warlock project alongside `@warlock.js/auth`.

## Configure

The resolver is the **one required piece** — it tells the engine how to read a user's roles + permissions. The ejected `DatabaseAccessResolver` reads roles from the `user_roles` table and maps them through the `roles` catalog table (so roles + their permissions are managed at runtime, in the DB):

```ts title="src/config/access.ts"
import { type AccessConfigurations } from "@warlock.js/access";
import { DatabaseAccessResolver } from "app/access/services/access-resolver";

const access: AccessConfigurations = {
  resolver: new DatabaseAccessResolver(),
};

export default access;
```

For a fixed, code-defined catalog with no tables, swap in `DefaultAccessResolver` (reads `user.get("roles")` and maps through an inline map):

```ts
import { DefaultAccessResolver } from "@warlock.js/access";

const access: AccessConfigurations = {
  resolver: new DefaultAccessResolver({ owner: ["*"], editor: ["orders.*"] }),
};
```

See the `configure-access` and `implement-resolver` skills for the full story.

## Use it

```ts
import { authMiddleware } from "@warlock.js/auth";
import { authorize, can, definePolicy, gate } from "@warlock.js/access";

// route gate (class-level)
router.post("/orders", createOrder, {
  middleware: [authMiddleware([]), gate("orders.create")],
});

// in a service (instance-level — runs the policy)
definePolicy("orders.update", (user, order) => order.get("customer_id") === user.id);
await authorize(user, "orders.update", { resource: order });

// boolean, anywhere
if (await can(user, "orders.viewCost")) { /* … */ }
```

> Register `definePolicy` calls per module, in `src/app/<module>/policies/`, loaded by an `import "./policies";` side-effect in that module's `main.ts` — a policy defined in an unimported module silently never registers.

## Documentation

Task-focused guides live under [`skills/`](./skills):

- **overview** — what the package does and the engine + resolver mental model
- **configure-access** — the required resolver (`DefaultAccessResolver` vs the ejected `DatabaseAccessResolver`), cache + tenant
- **check-permissions** — `can` / `authorize` / `gate` and friends
- **define-policies** — attribute conditions (ownership / tenant / state)
- **manage-roles** — assign / revoke via the ejected `UserRole` (auto-flushes), plus `hasRole` and out-of-band `access.flush`
- **implement-resolver** — connect the engine to your storage (DB catalog, column, pivot, token claim)

## License

MIT © Hasan Zohdy
