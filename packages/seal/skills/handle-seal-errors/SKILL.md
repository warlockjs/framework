---
name: handle-seal-errors
description: 'Read `ValidationResult` — `isValid`, `errors[]`, `data`. Branch on `error.type`, customize messages, hook translation. Triggers: `ValidationResult`, `ValidationError`, `validate`, `isValid`, `errors`, `data`, `error.type`, `error.input`, `error.error`, `translationParams`, `.attribute`, `SealConfig`; "how to read seal errors", "branch on a specific rule failure", "customize validation error message", "translate seal error", "surface validation errors as 422"; typical import `import { validate, v } from "@warlock.js/seal"`. Skip: modifiers — `@warlock.js/seal/compose-seal-modifiers/SKILL.md`; structural shapes — `@warlock.js/seal/define-structural-shape/SKILL.md`; competing libs `zod` `.safeParse`, `yup` `ValidationError`, `joi`.'
---

# `ValidationResult` — reading errors

`validate(schema, data)` never throws. It returns a `ValidationResult`:

```ts
type ValidationResult = {
  isValid: boolean;
  data: any;             // shape after mutators + transformers (the validated value)
  errors: ValidationError[];
};

type ValidationError = {
  type: string;          // rule type that failed — "required", "email", "min", "string", ...
  error: string;         // resolved message (translated, with attribute substitution)
  input: string;         // input field name — "email" or "address.city"
};
```

Branch on `isValid` first; reach for `errors[]` only when you need to act on a specific failure.

## Basic flow

```ts
import { validate, v } from "@warlock.js/seal";

const schema = v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
});

const result = await validate(schema, input);

if (result.isValid) {
  return result.data;  // typed as the inferred shape (post-transformer)
}

return {
  status: 422,
  body: { errors: result.errors },
};
```

## Branching on a specific rule

```ts
const result = await validate(schema, input);

if (!result.isValid) {
  const emailMissing = result.errors.find(
    e => e.input === "email" && e.type === "required",
  );
  if (emailMissing) {
    return { redirect: "/signup", reason: "no email" };
  }

  const ageInvalid = result.errors.find(
    e => e.input === "age" && (e.type === "int" || e.type === "min"),
  );
  if (ageInvalid) {
    return { error: "Age must be 13 or older" };
  }
}
```

The `type` field is the **stable** identifier — the message is human-facing and may be localized. Branch on `type`, never on the message string.

## Common rule type names

These are the strings you'll see in `error.type`:

The `type` is the rule's own `name` field — not the method you called. Several methods map to one shared rule name (e.g. `.min()` / `.minLength()` on a string both surface as `minLength`; `.sameAs()` surfaces as `equalsField`). The table below lists the actual `type` strings:

| Type | Produced by |
| --- | --- |
| `required`, `present` | `.required()`, `.present()` (note: `.optional()` has no error type — it clears the required rule) |
| `requiredIf`, `requiredWith`, `requiredWithout`, `requiredUnless` | conditional required methods |
| `string`, `number`, `int`, `float`, `boolean`, `scalar`, `object`, `array`, `date` | type guards from `matchesType` |
| `minLength`, `maxLength`, `betweenLength`, `length` | string / array length rules (`.min`/`.max` on a string alias to `minLength`/`maxLength`) |
| `min`, `max`, `betweenNumbers` | number range rules (`.min`/`.max`/`.between` on a number) |
| `email`, `url`, `uuid`, `pattern`, `matches` | string format rules (`.pattern()` → `pattern`) |
| `literal`, `enum`, `in`, `allowedValues`, `notAllowedValues` | value-membership rules (`.oneOf` aliases `in`; `.notIn`/`.forbids` → `notAllowedValues`; `.allowsOnly` → `allowedValues`) |
| `instanceof` | `v.instanceof(Ctor)` |
| `equalsField`, `notEqualsField` | cross-field equality (`.sameAs` → `equalsField`; `.differentFrom` → `notEqualsField`) |
| `minDate`, `maxDate`, `beforeField`, `afterField`, `today`, `past`, `future`, `weekDay`, `weekend`, `businessDay`, `birthday` | date rules (`.min`/`.max` → `minDate`/`maxDate`; `.before`/`.after` → `beforeField`/`afterField`) |

If you write custom rules, the `type` name you set on the rule object is what shows up here. Pick stable, kebab-or-camel-case names — they become a public API.

## Customizing error messages

Two layers:

```ts
v.string().email("Please enter a valid email address").required("Email is required");
//                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^                ^^^^^^^^^^^^^^^^
//                per-rule override                                  per-rule override
```

Each chain method takes an optional `errorMessage` as its last argument. That overrides the rule's `defaultErrorMessage`. Use it when a single rule needs a tailored message in a specific schema.

For project-wide message overrides, hook into the translation layer (the framework calls `resolveTranslation` with the rule context — wire up your own `t()` function via `SealConfig`).

## Translation params

Rules can stash dynamic substitution params on the context. The default messages reference them:

```
"The :input must be at least :min characters"
```

`:input` is the field name (or its translated display name); `:min` and others come from rule-specific metadata. If you need to render the message yourself in a custom UI, the params are available on the rule's context.

For attribute display names ("email" → "Email Address"), use `.attributes({ email: "Email Address" })` on the parent `v.object` or pass via the `validate()` options. The `:input` placeholder picks up the configured display name.

## When to throw

Don't wrap `validate()` in try/catch for *validation* failures — those land in `result.errors`. The only thing that *throws* is a programming bug:

- A rule's callback threw (e.g. you wrote `async validate() { throw new Error(...) }`).
- A transformer threw on output.
- A mutator threw on input.

Those are bugs — fix them. Don't try/catch them in app code as a way to handle bad input.

## At the framework boundary

If you're surfacing seal errors through HTTP / RPC, the typical shape is:

```ts
if (!result.isValid) {
  return reply.code(422).send({
    error: "validation_failed",
    fields: result.errors.map(e => ({
      field: e.input,
      type: e.type,
      message: e.error,
    })),
  });
}
```

Avoid leaking `result.data` back to the client when rejecting — it might contain transformed sensitive fields.

For server-side logs, log `errors[]` with the field paths and rule types; redact values unless you're certain the field isn't sensitive. The `@warlock.js/logger` redaction layer is the right place to enforce that.
