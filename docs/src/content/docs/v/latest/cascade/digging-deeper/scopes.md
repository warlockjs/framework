---
title: "Scopes"
sidebar:
  order: 10
  label: "Scopes"
---

Scopes are **reusable query fragments** attached to a model. They come in two flavours:

- **Global scopes** — applied automatically to every query on the model. Use them for tenant isolation, soft-delete filtering, "active only" defaults, etc.
- **Local scopes** — opt-in shortcuts you apply by name (`User.query().scope("admins")`). Use them to name the filters you write over and over.

This guide covers both, when to reach for each, and how to bypass globals on the queries that need to.

## Where to declare scopes — the `static` block

Both flavours are class-level — they live on the constructor, not on instances. Declare them inside a **TypeScript `static {}` initialiser block** in the model file. That keeps the declaration co-located with the model, runs once at class load, and reads as the natural home:

```ts
// src/app/users/models/user/user.model.ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;

  static {
    // Global scopes — applied to every User query
    this.addGlobalScope("notDeleted", q => q.whereNull("deletedAt"));

    // Local scopes — opt-in by name
    this.addScope("active", q => q.where("status", "active"));
    this.addScope("admins", q => q.where("role", "admin"));
  }
}
```

This is the pattern most app code uses. Module-bottom calls (`User.addScope("active", ...)` below the class) also work — same result — but the `static {}` block reads cleaner and keeps the model self-contained.

## Global scopes

A global scope runs on every query against the model — unless explicitly disabled. Register one with `this.addGlobalScope(name, callback, options?)` inside the model's `static {}` block:

```ts
static {
  this.addGlobalScope("tenant", query => {
    query.where("tenantId", getCurrentTenant());
  });

  this.addGlobalScope("notDeleted", query => {
    query.whereNull("deletedAt");
  });
}
```

From this point on, **every** `User.query()`, `User.find()`, `User.where()`, etc. has the tenant filter and the soft-delete filter baked in. You can't accidentally write a query that leaks across tenants.

If the scope depends on request context (current tenant, current user), the callback runs at query execution time — `getCurrentTenant()` is called once per query, not once at registration.

### Timing — `before` vs `after`

```ts
User.addGlobalScope(
  "tenant",
  query => query.where("tenantId", tenantId),
  { timing: "before" }, // default
);
```

`timing` controls whether the scope's where-clauses are added *before* the user's query operations or *after*. Default is `"before"`. Most scopes don't care — `before` is the right choice unless you specifically need your filter to run after the query has had its other where-clauses applied.

### Disabling global scopes

Sometimes you need the unfiltered view — an admin page that *should* see soft-deleted rows, a cross-tenant report. Two methods:

```ts
// Disable a specific scope:
await User.query().withoutGlobalScope("tenant").get();

// Disable several:
await User.query().withoutGlobalScope("tenant", "notDeleted").get();

// Disable ALL global scopes:
await User.query().withoutGlobalScopes().get();
```

This is local to the query — it doesn't remove the scope from the model.

### Removing a global scope permanently

```ts
User.removeGlobalScope("tenant");
```

Rare in app code, useful in tests where you want to assert against unscoped data.

## Local scopes

Local scopes are *named*, *opt-in* query fragments. Declare them in the same `static {}` block:

```ts
static {
  this.addScope("admins", q => q.where("role", "admin"));
  this.addScope("active", q => q.where("status", "active"));
}

// Use them:
const admins = await User.query().scope("admins").get();
const activeAdmins = await User.query().scope("active").scope("admins").get();
```

Local scopes don't run automatically. You opt in per query.

### Why bother — they're just query fragments

Two reasons local scopes earn their keep:

1. **Naming.** `User.query().scope("activeAdmins")` is the same query as a four-method chain, but the name documents *intent* — your controllers read closer to English.
2. **Reuse.** The same definition lives in one place. When the definition of "active" changes from `status === 'active'` to `status === 'active' AND deletedAt IS NULL`, you update the scope, not every caller.

### Scopes with arguments

The contract supports trailing args — pass them through:

```ts
static {
  this.addScope("withRole", (query, role: string) => {
    query.where("role", role);
  });
}

await User.query().scope("withRole", "moderator").get();
```

### Removing a local scope

```ts
User.removeScope("admins");
```

## Composing scopes

Both flavours compose freely with the rest of the query API:

```ts
const result = await User.query()
  .scope("active")
  .scope("withRole", "admin")
  .where("createdAt", ">=", lastMonth)
  .orderBy("name")
  .paginate({ page: 1, limit: 20 });
```

Order matters for `where`s vs `orWhere`s (as it does in any query builder), but otherwise scopes are just method calls — chain them wherever they read best.

## When to reach for each

| Situation                                                | Use            |
| -------------------------------------------------------- | -------------- |
| Tenant isolation across the entire app                   | Global scope   |
| Soft-delete filtering ("hide `deletedAt != null`")       | Global scope   |
| "Active records by default" for a model with status flags| Global scope   |
| Named filters reused in many places                      | Local scope    |
| Query fragment with parameters                           | Local scope    |
| A one-off filter only used in one controller             | Inline `.where()` — no scope needed |

## Common patterns

### Soft-delete hiding

```ts
@RegisterModel()
export class Post extends Model<PostSchema> {
  public static table = "posts";
  public static schema = postSchema;
  public static deleteStrategy = "soft";

  static {
    this.addGlobalScope("notDeleted", q => q.whereNull("deletedAt"));
  }
}

// Admin page that needs to see everything:
await Post.query().withoutGlobalScope("notDeleted").get();
```

This is the pattern that pairs with the soft-delete strategy from the [Delete strategies guide](./delete-strategies.md) — Cascade doesn't auto-hide soft-deleted rows; the scope does.

### Tenant scoping with async context

If your tenant comes from an async-local-storage context (typical in HTTP frameworks), the scope still works — it's evaluated lazily at query time:

```ts
static {
  this.addGlobalScope("tenant", query => {
    const tenantId = currentRequestContext().tenantId;
    query.where("tenantId", tenantId);
  });
}
```

Each request gets its own tenant filter without any per-request setup.

### Conditional scopes via `.when()`

When you want to apply a scope only conditionally, pair `.scope()` with `.when()` from the query builder:

```ts
const search = (filters: { onlyActive?: boolean }) =>
  User.query()
    .when(filters.onlyActive, q => q.scope("active"))
    .get();
```

This keeps the conditional in the calling code, not buried inside the scope itself.

## Going further

- **Bypassing globals on a per-query basis** — `withoutGlobalScope` / `withoutGlobalScopes`
- **Soft-delete filtering** — [Delete strategies guide](./delete-strategies.md)
- **Conditional filters at the controller level** — the `.when()` method on the query builder ([reference](../reference/query-builder-api.md#whenv-condition-callback-otherwise))
