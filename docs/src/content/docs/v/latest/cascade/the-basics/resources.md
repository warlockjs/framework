---
title: "Resources — model to public API"
sidebar:
  order: 6
  label: "Resources"
---

Every Cascade model has a `toJSON()` method, and `JSON.stringify(user)` calls it. By default that returns the model's raw `data` object — every column, including the ones you didn't mean to expose. For HTTP responses that's usually wrong.

This guide covers the ways Cascade lets you shape what flows *out*: the `static toJsonColumns` allow-list, the `static resource` class, and `static hidden` — a guaranteed exclusion that wins over both. All three are Cascade-native — no framework helpers required.

## `toJSON()` is the entry point

`JSON.stringify(user)` is the implicit caller, but `toJSON()` is a method like any other. You can invoke it directly when serialization happens outside JSON:

```ts
const user = await User.find(id);

// Implicit — in any JSON.stringify path (Express res.json, fetch body, etc.)
res.json(user);

// Explicit — when you need the shaped object, not the JSON string
const shaped = user.toJSON();
await cache.set(`user:${user.id}`, shaped);

// Arrays — map over them
const users = await User.query().get();
return users.map(u => u.toJSON());
```

Both routes go through the same `toJsonColumns` / `resource` pipeline described below. Cascade doesn't distinguish between `JSON.stringify` calling `toJSON()` and you calling it yourself.

:::caution — Default serialization is everything

If neither `toJsonColumns` nor `resource` is set, the model serializes its raw `data` object. That's fine for scripts and tests. It's hazardous for API responses — a new column added in a migration suddenly shows up in every response.

:::

## Pattern 1 — `static toJsonColumns`

The simple case. A column allow-list on the model:

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static toJsonColumns = ["id", "name", "email"];
}
```

`toJsonColumns` filters serialization to the listed fields. Anything else in the model's data is dropped from the JSON output.

**Reach for this when** the public shape is a strict subset of columns, with no renames, no formatting, and no computed fields.

**Limitations.** Field names go out exactly as they are on the model. You can't rename `email_address` → `email` for the API, you can't add an `initials` field, and you can't include loaded relations.

## Pattern 2 — `static resource`

When you need to reshape, rename, format, or compute, point the model at a **resource class**. The contract is minimal: a constructor that takes the model's data, and a `toJSON()` method that returns whatever shape you want.

```ts
class UserResource {
  constructor(private data: UserSchema & { id: string | number }) {}

  toJSON() {
    return {
      id: this.data.id,
      displayName: this.data.name,
      contactEmail: this.data.email,
      avatar: this.data.image ?? null,
    };
  }
}

@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static resource = UserResource;
}
```

Now `JSON.stringify(user)` (and `user.toJSON()`) routes through `UserResource`. The model's data goes in; whatever your `toJSON()` returns is what ships.

A few things worth knowing:

- **The data arg is whatever the model holds**, including `id` and any timestamps. Type it as `UserSchema & { id: ... }` (or `Partial<UserSchema>`) for autocomplete inside `toJSON()`.
- **The resource is a plain class.** No inheritance, no decorators, no framework magic. If you want richer ergonomics, you build them on top — Cascade just calls `new YourResource(data).toJSON()`.
- **One default per model.** `static resource` is the shape every `JSON.stringify(user)` produces. Alternate shapes (admin view, list view, search-result view) are explicit constructor calls — see §"Multiple shapes" below.

## Computed and formatted fields

Resources are plain TypeScript — anything you can write in a method, you can return from `toJSON()`:

```ts
class UserResource {
  constructor(
    private data: UserSchema & {
      id: string | number;
      created_at: Date;
      email_verified_at: Date | null;
    },
  ) {}

  toJSON() {
    return {
      id: this.data.id,
      displayName: this.data.name,
      initials: this.data.name
        .split(" ")
        .map(w => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      memberSince: this.data.created_at.getFullYear(),
      isVerified: this.data.email_verified_at !== null,
    };
  }
}
```

Compute fields, format dates, derive booleans, hide nulls — all of it just runs.

## Loaded relations

When you load a relation with `.with(...)`, the related models are stored in `model.loadedRelations`. Cascade composes them into the serialized output **automatically** — but the mechanics matter, so read this carefully:

1. Cascade builds the data object: `{...model.data, organization: org.toJSON(), posts: posts.map(p => p.toJSON()), ...}`. Each related model's own `toJSON()` (and therefore its own resource) is called recursively.
2. Cascade then passes that combined object to your resource's constructor.

So when your `UserResource` sees `this.data`, it already contains `organization` and `posts` as serialized output from `OrganizationResource` and `PostResource`. You don't fetch them yourself — they're just there:

```ts
class UserResource {
  constructor(private data: any) {}

  toJSON() {
    return {
      id: this.data.id,
      displayName: this.data.name,
      // Already shaped by OrganizationResource and PostResource:
      organization: this.data.organization,
      posts: this.data.posts,
    };
  }
}
```

The flow:

```ts
const user = await User.query().with("organization", "posts").find(id);
JSON.stringify(user);
// → {
//     id, displayName,                       ← from UserResource
//     organization: { id, name, ... },       ← from OrganizationResource recursively
//     posts: [{ id, title, ... }, ...],      ← from PostResource recursively
//   }
```

You write the resources once per model; Cascade composes them at serialization time.

## `resourceColumns` — filter what the resource sees

If you only want a subset of columns to reach the resource (e.g., you've got many columns on the model and the resource only needs four), set `static resourceColumns`:

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static resource = UserResource;
  public static resourceColumns = ["id", "name", "email", "image"];
}
```

What it does: Cascade calls `model.only(resourceColumns)` first, then merges loaded relations onto that, then hands it to the resource.

When to reach for it: you want defence-in-depth so that a freshly-added sensitive column doesn't accidentally leak into `toJSON()` even if the developer forgets to update the resource. The resource is the *shape*; `resourceColumns` is the *gate*.

**Distinction from `toJsonColumns`:**

- `toJsonColumns` is the **no-resource** shortcut — Cascade slices and returns directly.
- `resourceColumns` is the **with-resource** input filter — Cascade slices, then hands the sliced data (plus loaded relations) to your resource.

If both `resource` and `toJsonColumns` are set, `resource` wins — `toJsonColumns` is only consulted when there's no resource.

## Pattern 3 — `static hidden`, the guaranteed exclusion

`toJsonColumns` and `resource` are both allow-lists (or shaping code) you maintain by hand. That's fine until someone refactors the resource, or a new column shows up and nobody remembers to keep it out. `static hidden: string[]` is a separate, always-on backstop:

```ts
@RegisterModel()
export class User extends Model<UserSchema> {
  public static table = "users";
  public static schema = userSchema;
  public static hidden = ["password", "resetToken"];
}
```

**What it does:** every field named in `hidden` is stripped from `toJSON()` output, unconditionally — with the raw-`data` default (no `toJsonColumns`/`resource` set), with `toJsonColumns` (hidden wins even if the field is in the allow-list), and from the data object handed to a `resource` class's constructor (so the resource never even sees it, let alone can accidentally return it).

**Default is `[]`.** Declaring `hidden` is opt-in — nothing changes on an existing model until you add fields to the array. But because that default fails open (a model with no `hidden`, no `resource`, no `toJsonColumns` still serializes everything), Cascade logs a **one-time `console.warn` per model** whose schema declares a credential-shaped column — `password`, `passwordHash`, `secret`, `token`, `apiKey`/`api_key`, matched case-insensitively — that isn't covered by `hidden`, `resource`, or `toJsonColumns`. That warning is meant to be acted on: add the field to `hidden` (or confirm your `resource`/`toJsonColumns` already excludes it, which the warning doesn't currently detect for resource-shaped output beyond the raw schema check).

**Reach for `hidden` whenever a field must never reach an API response**, even if you also use `resource` or `toJsonColumns` for everything else — it's the one path that survives a resource refactor, an `AdminUserResource` subclass that forgets to re-exclude it, or a future teammate adding a second resource for a new endpoint.

```ts
// hidden wins regardless of the other two:
public static hidden = ["password"];
public static toJsonColumns = ["id", "name", "password"]; // "password" still dropped
public static resource = UserResource;                     // resource's `this.data.password` is already gone
```

## Choosing between the patterns

| Situation                                | Reach for                                  |
| ---------------------------------------- | ------------------------------------------ |
| Strict subset of columns, no renames     | `toJsonColumns`                            |
| Rename a field                           | `resource`                                 |
| Compute / format a field                 | `resource`                                 |
| Conditionally include a field            | `resource`                                 |
| Include loaded relations in output       | `resource` (automatic composition)         |
| Different shape for different consumers  | Multiple resources, explicit constructor   |
| A field must NEVER serialize, whichever of the above is set | `hidden` |

## Multiple shapes — admin view, list view, etc.

The `static resource` is the **default** shape. For an alternative shape — admin view, list view, summary card — don't try to override the static at request time. Instead, write the alternative resource and call it explicitly:

```ts
class AdminUserResource extends UserResource {
  toJSON() {
    return {
      ...super.toJSON(),
      role: this.data.role,
      lastLoginAt: this.data.last_login_at,
      isActive: this.data.status === "active",
    };
  }
}

// In an admin controller:
const user = await User.find(id);
return new AdminUserResource(user.data).toJSON();
```

A few things to notice:

- Subclassing the default resource is the cheapest way to add fields without re-shaping everything.
- The default `JSON.stringify(user)` still uses `UserResource` — only this controller is opting in to the richer admin shape.
- For lists, map over the result: `users.map(u => new AdminUserResource(u.data).toJSON())`.

## Going further

- **Validation (data flowing IN)** — validation guide; the input counterpart to this output story.
- **Loaded relations and eager loading** — [Relationships essentials](../the-basics/03-relationships.md)
- **Conditional inclusion based on viewer role** — recipe territory. The mechanic is plain TS in `toJSON()`; where you store the policy is your call.
- **Versioned API shapes** (`UserResourceV1`, `UserResourceV2`) — out of scope for the framework; the multi-shape pattern above is enough to build it on top.
