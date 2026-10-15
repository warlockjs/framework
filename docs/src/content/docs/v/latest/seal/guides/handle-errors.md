---
title: "Handle errors"
description: Pattern guide — reading ValidationResult, branching on rule type, custom messages, i18n via translateRule, HTTP-422 shape.
sidebar:
  order: 6
  label: "Handle errors"
---

`validate(schema, data)` returns a `ValidationResult` — never throws on bad input. This guide walks the common error-handling patterns.

## The shape (refresher)

```ts
type ValidationResult = {
  isValid: boolean;
  data: any;          // validated + reshaped data; matches Infer.Output<>
  errors: {
    type: string;     // rule name — "required", "email", "min", ...
    error: string;    // human-facing message (translated if configured)
    input: string;    // dot-notation field path — "email", "address.city"
  }[];
};
```

Full reference in [Essentials → Errors](../essentials/05-errors.md). This guide focuses on the patterns you'll write at call sites.

## Pattern 1 — HTTP 422 response

The most common pattern. Validate the body, return 422 with the error array on failure:

```ts
import { v, validate } from "@warlock.js/seal";

const createUserSchema = v.object({
  email: v.string().email(),
  password: v.string().min(8),
  name: v.string().min(2),
});

async function createUserHandler(request, reply) {
  const result = await validate(createUserSchema, request.body);

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

  const user = await createUser(result.data);
  return reply.code(201).send(user);
}
```

Two safety habits:

- **Don't echo the original input back** — it may contain passwords or other unredacted fields.
- **Don't send `result.data` on a rejection** — even though some validation succeeded, you're responding "invalid", and partial data leaks confuse the client.

## Pattern 2 — Branching on a specific failure

For business logic that reacts to specific failures (redirect, fallback flow, special error code):

```ts
const result = await validate(loginSchema, request.body);

if (!result.isValid) {
  const emailMissing = result.errors.find(
    (error) => error.input === "email" && error.type === "required",
  );

  if (emailMissing) {
    return reply.code(400).send({ error: "email_required", redirect: "/signup" });
  }

  const passwordTooShort = result.errors.find(
    (error) => error.input === "password" && error.type === "min",
  );

  if (passwordTooShort) {
    return reply.code(400).send({ error: "password_too_short", minLength: 8 });
  }

  // Generic fallback
  return reply.code(422).send({ errors: result.errors });
}
```

Branch on `error.type` (the stable rule name), never on `error.error` (the human message — translatable, may change).

Common values for `error.type`:

| Rule | Source |
| --- | --- |
| `required`, `present`, `optional` | `.required()`, `.present()`, `.optional()` |
| `requiredIf`, `requiredWith`, `requiredWithout`, `requiredUnless` | conditional required methods |
| `string`, `number`, `int`, `float`, `boolean`, `scalar`, `object`, `array`, `date` | type guards |
| `min`, `max`, `between`, `length` | range / length rules |
| `email`, `url`, `uuid`, `regex` | string format rules |
| `literal`, `enum`, `in`, `oneOf`, `notIn`, `forbids`, `allowsOnly` | membership rules |
| `instanceof` | `v.instanceof(Ctor)` |
| `sameAs`, `notSameAs` | cross-field equality |
| `before`, `after`, `today`, `weekDay`, `weekend`, `businessDay` | date rules |

Custom rules use whatever `name` you set on the rule object — pick stable, kebab-or-camel-case names since they become a public API.

## Pattern 3 — First error only vs collect everything

By default, seal stops at the first error per field. Switch globally or per-call:

```ts
import { configureSeal } from "@warlock.js/seal";

// Globally
configureSeal({ firstErrorOnly: false });

// Per-call
const result = await validate(schema, data, { firstErrorOnly: false });
```

Default `firstErrorOnly: true` is right for HTTP responses where the client shows one error next to each field. Switch to `false` for form-validation UI that highlights every problem at once.

## Pattern 4 — Custom messages per call site

Each chain method takes an optional `errorMessage`:

```ts
v.object({
  email: v.string()
    .email("Please enter a valid email address")
    .required("Email is required"),
  password: v.string()
    .min(8, "Password must be at least 8 characters"),
});
```

Reach for this when *one rule in one schema* needs a tailored message. For project-wide message customization, use the translation hook.

## Pattern 5 — i18n via `translateRule`

Wire the translation hook once at boot:

```ts
import { configureSeal } from "@warlock.js/seal";
import { trans } from "@mongez/localization";

configureSeal({
  translateRule: ({ rule, attributes }) =>
    trans(`validation.${rule.name}`, attributes),

  translateAttribute: ({ rule, attribute, context }) =>
    trans(
      `validation.attributes.${rule.name}.${attribute}`,
      context.allValues,
    ),
});
```

After this, every `error.error` is the localized string. The hook receives:

- `rule.name` — the rule type (`"email"`, `"min"`, …).
- `attributes` — substitution params from the rule (`:input`, `:min`, etc.).

For per-field display names ("email_address" → "Email Address"), use `.label()` on the field:

```ts
v.object({
  email_address: v.string().label("Email Address"),
});
// "The Email Address is required" instead of "The email_address is required"
```

`.label()` controls that field's `:input` placeholder. (`.attributes({ ... })` is a different tool — it supplies named values to the translation layer and cross-field rules such as `matches`.) Combine with `translateRule` / `translateAttribute` for full i18n.

## Pattern 6 — Rescue with `.catch()` instead of branching

For LLM output, third-party APIs, config files — anywhere the cost of a wrong value is lower than the cost of failure — push error handling into the schema with `.catch()`:

```ts
const config = v.object({
  retries: v.int().min(0).catch(3),
  region: v.string().in(["us", "eu"]).catch("us"),
  features: v.array(v.string()).catch([]),
});

await validate(config, badInput);
// Always { isValid: true } — invalid fields rescued
```

For observability:

```ts
v.string().uuid().catch((errors, originalInput) => {
  log.warn(`bad uuid: ${JSON.stringify(originalInput)}`, { errors });
  return ANONYMOUS_USER_ID;
});
```

`.catch()` is leaf-only in v1 — container validators (`v.object`, `v.array`, …) don't run the catch hook on their own outcome. To rescue a whole-container failure, wrap the call in try/catch.

## Pattern 7 — Logging without leaking data

For server-side logging, log errors with field paths and rule names; redact values unless you're certain the field isn't sensitive:

```ts
if (!result.isValid) {
  logger.warn("validation_failed", {
    path: request.url,
    errors: result.errors.map((error) => ({
      input: error.input,
      type: error.type,
      // Don't log error.error — may contain reflected values
    })),
  });

  return reply.code(422).send({ errors: result.errors });
}
```

`@warlock.js/logger`'s redaction layer is the right place to enforce field-level redaction policies project-wide.

## When seal *does* throw

Seal never throws on bad input. It throws on programming bugs:

- A rule's callback threw.
- A transformer threw on output.
- A mutator threw on input.
- `v.discriminatedUnion(...)` was misconfigured (throws at schema-build time, not at validate-time).

These are bugs. Fix them — don't wrap `validate()` in try/catch as a way to "handle bad input".

## Related

- [Essentials → Errors](../essentials/05-errors.md) — full reference.
- [Compose modifiers](./compose-modifiers.md) — `.catch()` and `.attributes()` in context.
- [Bridge Standard Schema](./bridge-standard-schema.md) — the cross-library issue shape (`{ message, path: [{ key }, ...] }`).
