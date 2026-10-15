---
title: "Custom error messages and i18n"
sidebar:
  order: 5
  label: "Custom error messages"
---

Out of the box seal gives you English messages like `"The email must be a valid email"`. Real apps want their own wording, and often more than one language. Seal has two layers for this: a quick per-rule override for one-off wording, and a translation hook for project-wide control and i18n.

## Layer 1 — per-rule override (the quick one)

Every chain method takes an optional `errorMessage` as its **last** argument. It replaces that rule's default message for this schema only.

```ts
import { v, validate } from "@warlock.js/seal";

const schema = v.object({
  email: v.string().email("Please enter a valid email address"),
  password: v.string().min(8, "Password must be at least 8 characters"),
  name: v.string().required("We need your name"),
});

const result = await validate(schema, { email: "nope", password: "x" });
result.errors;
// [{ type: "email", error: "Please enter a valid email address", input: "email" }]
// (firstErrorOnly defaults to true — one message per call)
```

Reach for this when a single rule in a single schema needs tailored wording. It's the 90% case.

## Layer 2 — the translation hook (project-wide + i18n)

For consistent messages across every schema — and for multiple languages — wire `configureSeal` once at boot. `translateRule` is called for every failing rule and returns the message string:

```ts
import { configureSeal } from "@warlock.js/seal";
import { trans } from "@mongez/localization";

configureSeal({
  translateRule: (ruleTranslation) =>
    trans(`validation.${ruleTranslation.rule.name}`, ruleTranslation.attributes),
  translateAttribute: (attributeTranslation) =>
    trans(
      `validation.attributes.${attributeTranslation.attribute}`,
      attributeTranslation.context.allValues,
    ),
});
```

Now a failing `email` rule looks up `validation.email` in your locale files, a failing `min` looks up `validation.min`, and so on. Swap the active locale and every message follows — no schema changes.

The `ruleTranslation` argument carries everything you need to build a message:

- `ruleTranslation.rule.name` — the rule type (`"email"`, `"min"`, `"required"`).
- `ruleTranslation.attributes` — substitution params: `input` (the field name), `path`, `value`, plus rule-specific values like `min`.

A typical locale entry uses those params:

```jsonc
// en/validation.json
{
  "email": "The :input must be a valid email",
  "min": "The :input must be at least :min characters",
  "required": "The :input field is required"
}
```

`:input` resolves to the field name (or its translated display name — see below); `:min` and friends come from the rule's metadata.

## Friendly field names with `.attributes()`

By default `:input` is the raw key — `"email_address"`, not `"Email Address"`. To give a field a human label, call `.attributes()` on the parent object and resolve it through the `translateAttribute` hook:

```ts
const schema = v
  .object({ email_address: v.string().email() })
  .attributes({ email_address: "Email Address" });
```

`.attributes()` stores the display name on the rule context; the `translateAttribute` hook is what actually swaps it into `:input`. The two work together — `.attributes()` alone (with no translation hook wired) leaves the raw key in the message. Wire the hook once and every `:input` picks up the configured label.

## Per-rule override vs translation hook — which to use

| Situation | Reach for |
| --- | --- |
| One rule in one schema needs custom wording | per-rule `errorMessage` argument |
| Consistent wording for a rule across all schemas | `translateRule` hook |
| Multiple languages | `translateRule` + `translateAttribute` hooks |
| Friendly field labels in messages | `.attributes()` + `translateAttribute` hook |

The two layers compose: a per-rule override wins for that specific call site even when a global `translateRule` is configured, so you can localize globally and still hard-override the odd special case.

## Don't branch on the message — branch on `type`

When you need to react programmatically to a specific failure, switch on `error.type` (the stable rule name), never on `error.error` (the human string, which changes with locale):

```ts
const emailFailed = result.errors.find(
  (failure) => failure.input === "email" && failure.type === "email",
);
```

## Related

- [Handle errors guide](../guides/handle-errors.md) — the full `ValidationResult` surface and `error.type` names
- [Validate a request body](./validate-request-body.md) — turning errors into a 422 response
