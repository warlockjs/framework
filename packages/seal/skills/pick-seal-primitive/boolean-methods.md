# `v.boolean()` — method reference

Picking guide is in [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md). Membership rules (`.in`/`.oneOf`) inherited from PrimitiveValidator — see [`@warlock.js/seal/compose-seal-modifiers/SKILL.md`](@warlock.js/seal/compose-seal-modifiers/SKILL.md).

## Strict equality

| Method               | Effect                                             |
| -------------------- | -------------------------------------------------- |
| `.mustBeTrue(msg?)`  | strictly `=== true` (rejects `"yes"`, `1`, `"on"`) |
| `.mustBeFalse(msg?)` | strictly `=== false`                               |

Use these when the field is a real boolean checkbox value — e.g. "agree to terms" must be exactly `true`, not a truthy string.

## Form-style coercion — `accepted` / `declined`

Calling `.accepted()`/`.declined()` (or any conditional variant) opts `v.boolean()` into
form-boolean parsing: a mutator runs before the type rule and converts the accepted set
(`1`, `"1"`, `true`, `"true"`, `"yes"`, `"y"`, `"on"`, `"Yes"`, `"Y"`, `"On"`) to `true` and
the declined set (`0`, `"0"`, `false`, `"false"`, `"no"`, `"n"`, `"off"`, `"No"`, `"N"`,
`"Off"`) to `false`; any other value passes through unchanged and still fails the type rule.
So `v.boolean().accepted()` given `"yes"` is valid **and its output is the real boolean
`true`** — not the original string. Designed for form inputs where a checkbox/radio arrives
as a string. `v.scalar().accepted()` runs the same accepted/declined rule but keeps the raw
value untouched (no boolean type rule, no parsing mutator) — use it when you want the
pass/fail check without normalizing the output.

| Method            | Effect                 |
| ----------------- | ---------------------- |
| `.accepted(msg?)` | value must be accepted |
| `.declined(msg?)` | value must be declined |

## Query-string coercion — `.coerce()`

`.coerce()` (5.10+) is the opt-in for query-string flags: `?active=true` arrives as the
string `"true"`, and bare `v.boolean()` is strict by default — it rejects that string. Add
`.coerce()` when a schema validates `request.query`:

```ts
v.object({ active: v.boolean().coerce() }); // "true" → true, passes
```

It converts _exactly_ `"true"` / `"1"` / `1` → `true` and `"false"` / `"0"` / `0` → `false`.
Case-sensitive, no trimming — anything else (`"yes"`, `"on"`, `"TRUE"`, `""`, `2`) passes
through unchanged and still fails the type rule. That's the line between this and
`accepted()`/`declined()` below: `.coerce()` is for the narrow, exact query-string
serialization; `accepted()`/`declined()` are for broader form-style truthy strings like
`"yes"`/`"on"`. `v.boolean()` does not coerce by default; the output type is unaffected
(`v.boolean().coerce()` still infers `boolean`).

## Conditional variants — accepted

| Method                                | Args                       | Effect                              |
| ------------------------------------- | -------------------------- | ----------------------------------- |
| `.acceptedIf(field, value, msg?)`     | sibling field equals value | must be accepted in that case       |
| `.acceptedUnless(field, value, msg?)` | sibling field equals value | must be accepted unless that's true |
| `.acceptedIfRequired(field, msg?)`    | sibling field is required  | —                                   |
| `.acceptedIfPresent(field, msg?)`     | sibling field is present   | —                                   |
| `.acceptedWithout(field, msg?)`       | sibling field is absent    | —                                   |

## Conditional variants — declined

| Method                                | Args                       | Effect                              |
| ------------------------------------- | -------------------------- | ----------------------------------- |
| `.declinedIf(field, value, msg?)`     | sibling field equals value | must be declined in that case       |
| `.declinedUnless(field, value, msg?)` | sibling field equals value | must be declined unless that's true |
| `.declinedIfRequired(field, msg?)`    | —                          | —                                   |
| `.declinedIfPresent(field, msg?)`     | —                          | —                                   |
| `.declinedWithout(field, msg?)`       | —                          | —                                   |

All conditional variants only run inside `v.object` — sibling resolution silently passes otherwise.

## JSON Schema mapping

- `v.boolean()` → `{ type: "boolean" }`
- `.mustBeTrue()` / `.mustBeFalse()` — not currently emitted (could add `const: true/false` in the future)
- `.accepted()` / `.declined()` and their conditional variants — runtime coercion concerns, not representable
- `.coerce()` — a pre-validation mutator, not representable; the schema still emits `{ type: "boolean" }`

## Common chains

```ts
// Strict consent checkbox
v.boolean().mustBeTrue("You must accept the terms");

// Form-style "remember me" — accepts "on" / true / 1
v.boolean().accepted().optional();

// Cross-field — newsletter must be accepted if subscriptionType = "premium"
v.object({
  subscriptionType: v.string().oneOf(["free", "premium"]),
  newsletter: v.boolean().acceptedIf("subscriptionType", "premium"),
});

// Marketing opt-in — declined unless region is GDPR-exempt
v.object({
  region: v.string(),
  marketingOptIn: v.boolean().declinedUnless("region", "US"),
});

// Query-string flag — ?active=true
v.object({
  active: v.boolean().coerce(),
});
```
