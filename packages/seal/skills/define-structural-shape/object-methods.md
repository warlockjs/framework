# `v.object({...})` — method reference

Picking guide for structural validators is in [`@warlock.js/seal/define-structural-shape/SKILL.md`](@warlock.js/seal/define-structural-shape/SKILL.md). For field-level chaining (`.required` / `.optional` / `.attribute`), see [`@warlock.js/seal/compose-seal-modifiers/SKILL.md`](@warlock.js/seal/compose-seal-modifiers/SKILL.md).

## Schema composition

These return a new `ObjectValidator` with a transformed schema. The TypeScript inference follows correctly — `Infer<>` reflects the post-composition shape.

### `.extend(schemaOrValidator)` — add fields, keep config

```ts
const baseUser = v.object({
  name: v.string(),
  email: v.string().email(),
}).allowUnknown();

const adminUser = baseUser.extend({
  role: v.string().oneOf(["admin", "superadmin"]),
});
// adminUser type: { name; email; role } — keeps allowUnknown()
```

Accepts a plain schema object **or** another `ObjectValidator` (only its schema is used — config is ignored). Use for reusable field collections (e.g. timestamp fields).

### `.merge(otherValidator)` — combine, override config

```ts
const base = v.object({ name: v.string() }).allowUnknown();
const audit = v.object({
  createdAt: v.date(),
  updatedAt: v.date(),
}).stripUnknown();

const merged = base.merge(audit);
// type: { name; createdAt; updatedAt }
// config: stripUnknown() from audit (overrides base's allowUnknown)
```

`.merge` combines schemas **and** configurations — the other validator wins. Rules, mutators, transformers, and attribute display names from both validators are appended.

### `.pick(...keys)` — keep only specified fields

```ts
const fullUser = v.object({
  id: v.int(),
  name: v.string(),
  email: v.string().email(),
  password: v.string(),
});

const loginSchema = fullUser.pick("email", "password");
// type: { email; password }
```

Returns `ObjectValidator<Pick<TSchema, K>>`. Keeps original config (`allowUnknown`, etc.).

### `.without(...keys)` — drop specified fields

```ts
const updateSchema = fullUser.without("id");
// type: { name; email; password }
```

Returns `ObjectValidator<Omit<TSchema, K>>`. Inverse of `.pick`. Keeps original config.

### `.partial(...keys?)` — mark fields optional

```ts
fullUser.partial()                // every field becomes optional
fullUser.partial("password")      // only `password` becomes optional
```

Walks the schema and applies `.optional()` to each named field (or all if no keys given). `Infer<>` makes those keys optional.

### `.requiredFields(...keys?)` — mark fields required

```ts
const partialUser = fullUser.partial();    // all optional
const updateUser = partialUser.requiredFields("id", "email");
// id and email are required again, others stay optional
```

Inverse of `.partial`.

## Unknown-keys policy

By default, extra keys in input are silently dropped from `data` (no error, no forward).

| Method | Effect |
|---|---|
| `.allowUnknown(allow = true)` | extra **direct-child** keys forward as-is |
| `.stripUnknown()` | explicit drop (mutator-based — affects `data` shape) |
| `.allow(...keys)` | whitelist specific extras to forward without validation |

`.allowUnknown()` only affects direct children — nested objects keep their own policies. For a fully permissive object including nested children, set `.allowUnknown()` on each level.

## Object-level mutators

| Method | Args | Effect |
|---|---|---|
| `.trim(recursive?)` | default `true` | recursively trim string values across the object |

For per-field mutators, attach on the field validator instead.

## Cross-field rules — context

The cross-field methods (`.sameAs`, `.requiredIf`, `.requiredWith`, etc.) are **field-level**, not object-level — you call them on the field validator inside `v.object`. The object validator's job is to hand them the parent context so sibling resolution works:

```ts
v.object({
  password: v.string(),
  passwordConfirm: v.string().sameAs("password"),
})
```

If you call cross-field rules outside a `v.object`, sibling resolution silently passes — there's nobody to compare against.

## `Infer<>` semantics

```ts
Infer<typeof userSchema>
// { reqField: T; optField?: T }
```

- Required fields → required keys
- `.optional()` fields → optional keys (`?:`)
- `.omit()` / `.exclude()` fields → dropped from the inferred type
- `v.computed<T>()` / `v.managed<T>()` → present as `T` in inferred output (they produce values)

## Common chains

```ts
// User CRUD trio from one base
const baseUser = v.object({
  id: v.int(),
  name: v.string(),
  email: v.string().email(),
  password: v.string(),
});

const createUser = baseUser.without("id");
const updateUser = baseUser.partial().requiredFields("id");
const loginUser = baseUser.pick("email", "password");

// Reusable timestamps
const timestamps = v.object({
  createdAt: v.date(),
  updatedAt: v.date(),
});

const userWithAudit = baseUser.extend(timestamps);

// Permissive container that forwards extras
const eventEnvelope = v.object({
  type: v.literal("user.created", "user.updated"),
  payload: v.object({}).allowUnknown(),
}).allowUnknown();

// Confirmation pattern with omit
const signupSchema = v.object({
  password: v.string().strongPassword(),
  passwordConfirm: v.string().sameAs("password").omit(),
  email: v.string().email(),
});
// Infer<> = { password; email } — passwordConfirm omitted from output
```
