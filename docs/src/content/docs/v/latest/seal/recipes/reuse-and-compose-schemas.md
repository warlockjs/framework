---
title: "Reuse and compose schemas"
sidebar:
  order: 3
  label: "Reuse & compose schemas"
---

You almost never have just one shape for an entity. There's the create body, the update body, the public response, the login payload — all close cousins of one canonical shape. Copy-pasting them is how they drift. Seal gives you a small set of object methods that derive one schema from another, so a single base stays the source of truth.

Every method here returns a **new** `ObjectValidator` (schemas are immutable), and `Infer<>` follows the transformation — the derived type is always correct without a hand-written parallel.

## Start with one base

```ts
import { v, type Infer } from "@warlock.js/seal";

const userSchema = v.object({
  id: v.int(),
  name: v.string().min(2),
  email: v.string().email(),
  password: v.string().min(8),
  role: v.literal("admin", "member").default("member"),
});
```

## The CRUD family from one declaration

```ts
// Create — the client doesn't send the server-assigned id.
const createUser = userSchema.without("id");
// { name; email; password; role? }

// Update — everything optional, but id stays required to know what to patch.
const updateUser = userSchema.partial().requiredFields("id");
// { id; name?; email?; password?; role? }

// Login — only the two fields the endpoint needs.
const loginUser = userSchema.pick("email", "password");
// { email; password }

// Public response — never leak the password.
const publicUser = userSchema.without("password");
// { id; name; email; role? }
```

Four endpoints, one base. Add a field to `userSchema` and it flows everywhere it should.

## The composition methods

### `.pick(...keys)` / `.without(...keys)`

Keep only some fields, or drop some fields. Inverses of each other. Both preserve the original's config (`allowUnknown`, etc.).

```ts
userSchema.pick("email", "password");   // ObjectValidator<{ email; password }>
userSchema.without("id", "password");   // ObjectValidator<{ name; email; role }>
```

### `.partial(...keys?)` / `.requiredFields(...keys?)`

Flip fields to optional, or back to required. Pass specific keys, or none to apply to every field.

```ts
userSchema.partial();                 // every field optional
userSchema.partial("password");       // only password optional
userSchema.partial().requiredFields("id", "email");  // all optional except id + email
```

### `.extend(schemaOrValidator)` — add fields, keep your config

`.extend` bolts extra fields onto a clone and **keeps the original's configuration**. Handy for reusable field bundles like timestamps. If you pass another `ObjectValidator`, only its *schema* is used — its config is ignored.

```ts
const timestamps = v.object({
  createdAt: v.date(),
  updatedAt: v.date(),
});

const userWithAudit = userSchema.extend(timestamps);
// { id; name; email; password; role?; createdAt; updatedAt }
// keeps userSchema's config
```

### `.merge(otherValidator)` — combine fields and config

`.merge` is `.extend`'s heavier sibling: it merges both the schema **and** the configuration, with the *other* validator's config winning. Rules, mutators, transformers, and attribute display names from both are appended.

```ts
const base = v.object({ name: v.string() }).allowUnknown();
const audit = v.object({ createdAt: v.date() }).stripUnknown();

const merged = base.merge(audit);
// fields: { name; createdAt }
// config: stripUnknown() from audit wins over base's allowUnknown()
```

**`.extend` vs `.merge` in one line:** reach for `.extend` when you only want the *fields* from the other shape; reach for `.merge` when you also want its *behaviour*.

## Reusable field validators

Composition isn't only at the object level — individual field validators are values you can `.clone()` and specialize. Because chains are immutable, deriving never mutates the source:

```ts
const baseString = v.string().min(3).max(50);

const username = baseString.clone().alphanumeric().lowercase();
const slug = baseString.clone().slug();

// baseString is untouched — still just min(3).max(50).
```

## Why immutability matters here

A schema you hand to a Cascade `Model` (or store in a module-level constant) is shared. If chaining mutated in place, deriving `updateUser` from `userSchema` would corrupt `userSchema` for every other consumer. Seal's clone-on-write default prevents that — each derivation is a fresh snapshot. You'd only ever opt into the in-place `.mutable` getter when building a schema dynamically and you're sure no one else holds a reference.

## Related

- [Validate a request body](./validate-request-body.md) — where these derived schemas get used
- [Essentials → Structural shapes](../essentials/03-structural-shapes.md) — the object method surface in context
