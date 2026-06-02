---
title: "Validate an HTTP request body"
sidebar:
  order: 1
  label: "Validate a request body"
---

This is the bread-and-butter job: a request lands, you need to know the body is shaped the way you expect *before* you touch the database. Seal makes this a three-line move — define the schema once, run `validate`, and branch on the result. No exceptions to catch, no manual field-poking.

## The whole flow

```ts
import { v, validate, type Infer } from "@warlock.js/seal";

const createUserSchema = v.object({
  name: v.string().min(2).max(80),
  email: v.string().email(),
  age: v.int().min(13).optional(),
  role: v.literal("admin", "member").default("member"),
});

// The type for your handler — derived from the schema, never hand-written.
type CreateUserBody = Infer.Output<typeof createUserSchema>;
// { name: string; email: string; age?: number; role: "admin" | "member" }

async function createUser(rawBody: unknown) {
  const result = await validate(createUserSchema, rawBody);

  if (!result.isValid) {
    return { status: 422, body: { errors: result.errors } };
  }

  const data = result.data as CreateUserBody;
  // data is clean: email is a valid email, role defaulted to "member" if omitted.
  const user = await db.users.create(data);

  return { status: 201, body: user };
}
```

That's the entire pattern. Everything below is detail you can reach for when you need it.

## Why `Infer.Output` and not bare `Infer`

The body the *caller sends* and the body you *act on after validation* are subtly different types:

- **Before validation** (`Infer.Input`, the bare `Infer<>` default) — `role` is optional, because the caller is allowed to omit it.
- **After validation** (`Infer.Output`) — `role` is guaranteed present, because `.default("member")` filled it in.

For the data you pass to `db.users.create(...)`, you want `Infer.Output` — it reflects the post-default reality. Use bare `Infer<>` (= `Infer.Input`) for the type you document the endpoint with.

## Shaping the 422 response

`result.errors` is an array of `{ type, error, input }`. Map it to whatever shape your API contract wants:

```ts
if (!result.isValid) {
  return {
    status: 422,
    body: {
      message: "Validation failed",
      fields: result.errors.map((failure) => ({
        field: failure.input,   // "email", or a nested path like "address.city"
        rule: failure.type,     // "email", "required", "min" — the stable identifier
        message: failure.error, // human-facing, already translated if you wired i18n
      })),
    },
  };
}
```

Branch on `failure.type` — never on the message string. The message is for humans and may be localized; the `type` is the stable rule name and is safe to switch on.

## Collecting every error, not just the first

By default seal stops at the first failing rule per field (`firstErrorOnly: true`). For a form where you want to surface *all* problems at once, flip it globally at boot:

```ts
import { configureSeal } from "@warlock.js/seal";

configureSeal({ firstErrorOnly: false });
```

Now a single `validate()` returns every failing rule across every field — ideal for rendering a full form-error summary.

## Rejecting unexpected keys

By default extra keys are silently dropped from `result.data` — the output only ever contains keys you declared. If you want to actively reject a body that carries unknown keys (strict API contracts), that behaviour is already the safe default: unknown keys never reach your handler.

If instead you want to *forward* unknown keys untouched (a passthrough envelope), opt in with `.allowUnknown()`:

```ts
const envelope = v.object({
  type: v.literal("user.created", "user.updated"),
  payload: v.object({}).allowUnknown(),  // forward whatever the producer sent
}).allowUnknown();
```

## Don't reuse one schema for create and update

A create body and an update body are different shapes — update usually makes everything optional and drops the server-assigned `id`. Don't copy-paste; derive. See [Reuse and compose schemas](./reuse-and-compose-schemas.md) for the `.partial()` / `.pick()` / `.without()` moves that build a whole CRUD family from one base.

## Related

- [Reuse and compose schemas](./reuse-and-compose-schemas.md) — build create / update / login schemas from one base
- [Coerce query params](./coerce-query-params.md) — when the input arrives as strings (query strings, form-encoded)
- [Custom error messages](./custom-error-messages.md) — per-rule overrides and i18n
- [Handle errors guide](../guides/handle-errors.md) — the full `ValidationResult` surface
