# Warlock Access

Authorization (RBAC + ABAC) for [Warlock.js](https://github.com/warlockjs/core) applications — permission checks (`can` / `authorize` / `requirePermission`), attribute-based `definePolicy` conditions, role management, and a pluggable `AccessResolver` that connects the engine to however your app stores roles.

`@warlock.js/auth` answers _who you are_; `@warlock.js/access` answers _what you can do_.

## Installation

```bash
yarn add @warlock.js/access
```

`@warlock.js/access` reads `request.user`, so install it inside a Warlock project alongside `@warlock.js/auth`.

## Configure

```ts title="src/config/access.ts"
import { type AccessConfigurations } from "@warlock.js/access";

const access: AccessConfigurations = {
  roles: {
    owner: ["*"], //                          `*` is the super-grant
    editor: ["orders.*", "posts.create"], //  `orders.*` covers orders.update, orders.view, …
    viewer: ["orders.view"],
  },
};

export default access;
```

The built-in resolver reads a user's roles from `user.get("roles")` (or a single `user.get("role")`) and maps them through the `roles` catalog. For a `user_roles` table or any other storage, swap the resolver — see the `configure-access` and `implement-resolver` skills.

## Use it

```ts
import { authMiddleware } from "@warlock.js/auth";
import { authorize, can, definePolicy, requirePermission } from "@warlock.js/access";

// route gate (class-level)
router.post("/orders", createOrder, {
  middleware: [authMiddleware([]), requirePermission("orders.create")],
});

// in a service (instance-level — runs the policy)
definePolicy("orders.update", (user, order) => order.get("customer_id") === user.id);
await authorize(user, "orders.update", { resource: order });

// boolean, anywhere
if (await can(user, "orders.viewCost")) { /* … */ }
```

> Register `definePolicy` calls in a boot side-effect file that is actually imported (e.g. `src/app/access/policies.ts`, imported from your `main.ts`) — a policy defined in an unimported module silently never registers.

## Documentation

Task-focused guides live under [`skills/`](./skills):

- **overview** — what the package does and the engine + resolver mental model
- **configure-access** — the `roles` map, the resolver, tenant + cache
- **check-permissions** — `can` / `authorize` / `requirePermission` and friends
- **define-policies** — attribute conditions (ownership / tenant / state)
- **manage-roles** — assign / revoke roles + `hasRole` and the `UserRole` table
- **implement-resolver** — connect the engine to your storage (column, pivot, token claim)

## License

MIT © Hasan Zohdy
