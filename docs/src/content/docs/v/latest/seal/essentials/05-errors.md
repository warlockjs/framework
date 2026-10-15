---
title: "Errors"
description: ValidationResult shape, reading errors, branching on rule type, customizing messages, the translation hook.
sidebar:
  order: 5
  label: "Errors"
---

`validate(schema, data)` never throws on bad input. It returns a `ValidationResult`:

```ts
type ValidationResult = {
  isValid: boolean;
  data: any;          // validated + reshaped data; matches Infer.Output<>
  errors: {
    type: string;     // rule name that failed — "required", "email", "min", ...
    error: string;    // human-facing message (translated if configured)
    input: string;    // dot-notation field path — "email", "address.city"
  }[];
};
```

Branch on `isValid` first; reach into `errors` only when you need to act on a specific failure.

## Basic flow

```ts
import { validate, v } from "@warlock.js/seal";

const schema = v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
});

const result = await validate(schema, input);

if (result.isValid) {
  return result.data;   // typed as Infer.Output<typeof schema>
}

return {
  status: 422,
  body: { errors: result.errors },
};
```

Three fields on every error:

- **`type`** — the rule name. **This is the stable identifier — branch on it, not on the message.** Common values: `required`, `optional`, `email`, `url`, `uuid`, `min`, `max`, `between`, `length`, `regex`, `literal`, `in`, `oneOf`, `notIn`, `instanceof`, `sameAs`, `requiredIf`, `requiredWith`, `string`, `int`, `float`, `boolean`, `object`, `array`, `date`, `before`, `after`, `today`.
- **`error`** — the human-facing message. If you wired a `translateRule` hook, this is the localized string.
- **`input`** — the field path, dot-notation. For nested objects, looks like `"address.city"`.

## Branching on a specific rule

```ts
const result = await validate(schema, input);

if (!result.isValid) {
  const emailMissing = result.errors.find(
    (error) => error.input === "email" && error.type === "required",
  );

  if (emailMissing) {
    return { redirect: "/signup", reason: "no email" };
  }

  const ageInvalid = result.errors.find(
    (error) => error.input === "age" && (error.type === "int" || error.type === "min"),
  );

  if (ageInvalid) {
    return { error: "Age must be 13 or older" };
  }
}
```

`type` is the stable identifier — it's the rule's registered name and doesn't change between releases without a major bump. The `error` message is for humans (or for translation) and may vary.

## `firstErrorOnly` — one error per field

By default, seal stops at the first error for each field — the result has one error per failed field, not the full list. This keeps response payloads small and the user experience focused.

```ts
import { configureSeal } from "@warlock.js/seal";

// Collect every error
configureSeal({ firstErrorOnly: false });

// Or per-validate-call
const result = await validate(schema, data, { firstErrorOnly: false });
```

For HTTP responses where the client shows errors next to each field, `firstErrorOnly: true` (the default) is usually right. For form-validation UI that highlights every problem at once, switch to `false`.

## Customizing error messages

Two layers — per-rule overrides and the global translation hook.

### Per-rule

Most chain methods take an optional `errorMessage` argument:

```ts
v.string()
  .email("Please enter a valid email address")
  .required("Email is required");
```

That override replaces the rule's default message at this call site only. Reach for it when one rule needs a tailored message in a specific schema.

### Global translation

For project-wide message customization or i18n, wire `translateRule` once via `configureSeal()`:

```ts
import { configureSeal } from "@warlock.js/seal";

configureSeal({
  translateRule: ({ rule, attributes }) => {
    // Hook into your i18n layer — return the localized string.
    return t(`validation.${rule.name}`, attributes);
  },
  translateAttribute: ({ rule, attribute, context }) => {
    // For per-field display names ("email" → "Email Address")
    return t(`validation.attributes.${rule.name}.${attribute}`);
  },
});
```

The `translateRule` callback receives a `RuleTranslation` object with the rule (`name`, `attributes`) and other context. The return value becomes `error.error`.

## Field display names — `.label()`

By default, the error message uses the field key (`email_address` → "The email_address is required"). Override the `:input` placeholder with `.label()` on the field:

```ts
v.object({
  email_address: v.string().label("Email Address"),
});
// → "The Email Address is required"
```

(`.attributes({ ... })` is a different tool — it feeds named values to the translation layer and to cross-field rules such as `matches`, not a field's own `:input`.) Combine with `translateRule` / `translateAttribute` for full i18n.

## When does seal throw?

Seal never throws on **bad input** — bad input lands in `result.errors`. It does throw on **programming bugs**:

- A rule's callback threw (you wrote `async validate() { throw new Error(...) }`).
- A transformer threw on output.
- A mutator threw on input.
- A `v.discriminatedUnion(...)` was misconfigured (missing discriminator, non-literal discriminator, duplicates) — throws at schema-build time.

These are bugs. Fix them. Don't wrap `validate()` in try/catch to "handle bad input" — that's what `result.errors` is for.

## At the framework boundary

Typical HTTP-layer shape for surfacing seal errors:

```ts
if (!result.isValid) {
  return reply.code(422).send({
    error: "validation_failed",
    fields: result.errors.map((error) => ({
      key: error.input,
      rule: error.type,
      message: error.error,
    })),
  });
}
```

A couple of safety habits:

- **Don't leak the original input back to the client.** It can contain passwords or other unredacted fields.
- **Don't leak `result.data` either if you're rejecting.** Even though transformation may have happened, you're saying "this is invalid" — sending the partially-validated shape back is confusing and risks leaking sensitive transformed values.
- **For server logs**, log `errors` with field paths and rule names; redact values unless you're certain the field isn't sensitive. `@warlock.js/logger`'s redaction layer is the right place to enforce that.

## Bridge to Standard Schema

If a consumer expects the [Standard Schema](https://standardschema.dev) issue shape instead of seal's native one, use the `~standard` accessor:

```ts
const result = await schema["~standard"].validate(input);

if ("value" in result) {
  result.value;   // success — the validated data
} else {
  result.issues;  // [{ message, path: [{ key }, ...] }, ...]
}
```

The Standard Schema shape uses `message` (not `error`) and a path-segment array (not a dot-notation string). Use it when integrating with libraries that consume Standard Schema natively (TanStack Form, Conform, LangGraph).

## Related

- [Modifiers](./02-modifiers.md) — `.catch()` swallows errors and substitutes a fallback.
- [Guides → Handle errors](../guides/handle-errors.md) — pattern guide with HTTP / LLM / config-loader examples.
- [Guides → Bridge Standard Schema](../guides/bridge-standard-schema.md) — the `Result<unknown>` issue shape for Standard Schema consumers.
