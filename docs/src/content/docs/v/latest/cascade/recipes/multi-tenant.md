---
title: "Multi-tenant scoping"
sidebar:
  order: 7
  label: "Multi-tenant scoping"
---

Keep tenant A's data out of tenant B's queries — automatically, on every model. Combines a `@warlock.js/context` context for the current tenant id with a Cascade global scope that injects `WHERE tenantId = ?` on every query.

This recipe uses the **shared-database** pattern — one physical database, separated by a `tenantId` column. For the per-tenant-database alternative, see the [Multi-database guide](../digging-deeper/multi-database.md).

## The tenant context

Cascade already builds on `@warlock.js/context` for async-local-storage. Use the same primitive for tenant routing — one less library, one consistent pattern across the framework:

```ts
import { Context } from "@warlock.js/context";

type TenantStore = {
  tenantId: string;
};

class TenantContext extends Context<TenantStore> {
  public buildStore(): TenantStore {
    return { tenantId: "" };
  }
}

export const tenantContext = new TenantContext();
```

That's the whole context. `Context` from `@warlock.js/context` gives you `.run()`, `.get()`, `.set()`, `.hasContext()` — no `AsyncLocalStorage` boilerplate to write.

A tiny helper for the require-or-throw case:

```ts
export function requireTenant(): string {
  const tenantId = tenantContext.get("tenantId");

  if (!tenantId) {
    throw new Error("No tenant context set");
  }

  return tenantId;
}
```

## The request middleware

```ts
import { tenantContext } from "./tenant-context";

export async function tenantMiddleware(request, response, next) {
  const tenantId = resolveTenantId(request);

  if (!tenantId) {
    return response.status(400).json({ error: "Tenant unknown" });
  }

  return tenantContext.run({ tenantId }, () => next());
}
```

`resolveTenantId` is your app's call — subdomain, JWT claim, header, whatever your auth carries.

## The scope helper

Every multi-tenant model gets a global scope that filters by the current tenant, plus an `onCreating` listener that stamps the tenant id on every insert:

```ts
import type { ChildModel, Model } from "@warlock.js/cascade";
import { tenantContext, requireTenant } from "./tenant-context";

export function tenantScoped<TModel extends Model>(ModelClass: ChildModel<TModel>) {
  ModelClass.addGlobalScope("tenant", (query) => {
    const tenantId = tenantContext.get("tenantId");

    if (!tenantId) {
      return;
    }

    query.where("tenantId", tenantId);
  });

  ModelClass.events().onCreating((model) => {
    if (!model.has("tenantId")) {
      model.set("tenantId", requireTenant());
    }
  });
}
```

Read side and write side:

- **Read side** — every query gets `WHERE tenantId = ?` injected. Forgetting the filter is no longer possible.
- **Write side** — every insert without a `tenantId` gets one stamped on. `requireTenant()` throws if the call wasn't inside `tenantContext.run`, so you can't silently create an orphan row.

The scope **fails open** when there's no tenant in context. That gap is reserved for the admin escape hatch below.

## Wiring it up

```ts
import { tenantScoped } from "./tenant-scoped";
import { Project } from "app/projects/models/project/project.model";
import { Task } from "app/tasks/models/task/task.model";
import { Comment } from "app/comments/models/comment/comment.model";

export function setupTenantScoping() {
  tenantScoped(Project);
  tenantScoped(Task);
  tenantScoped(Comment);
}
```

Call this once at boot. Now every `Project.query()`, `Task.find(id)`, `Comment.create({...})` is tenant-safe.

## The admin escape hatch

Platform admins, support tools, and cross-tenant analytics need a way out. Run the callback in a fresh context with no tenant id — the scope above bails out when the id is missing:

```ts
export function withoutTenant<T>(callback: () => Promise<T>): Promise<T> {
  return tenantContext.run({ tenantId: "" }, callback);
}

export async function adminListAllProjects() {
  return withoutTenant(() => Project.query().get());
}
```

Most apps add an audit hook around `withoutTenant` so every cross-tenant access leaves a trail. See the [audit trail recipe](./audit-trail.md).

## Tenant-aware uniqueness

`v.email().unique("User")` is global by default. Make it tenant-scoped with the `query` callback:

```ts
email: v.email().unique("User", {
  query: ({ query }) => query.where("tenantId", requireTenant()),
}),
```

Now the same email can exist in tenant A and tenant B without colliding.

## Going further

- **`@warlock.js/context`** — the context primitive Cascade and the rest of the framework build on
- **Global scopes in full** — [Scopes guide](../digging-deeper/scopes.md)
- **Per-tenant database isolation** (when soft isolation isn't enough) — [Multi-database guide](../digging-deeper/multi-database.md)
- **Auditing cross-tenant access** — [Audit trail recipe](./audit-trail.md)
- **Database-aware validators** — [Validation guide](../the-basics/validation.md)
