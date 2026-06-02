# `v.boolean()` — method reference

Picking guide is in [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md). Membership rules (`.in`/`.oneOf`) inherited from PrimitiveValidator — see [`@warlock.js/seal/compose-seal-modifiers/SKILL.md`](@warlock.js/seal/compose-seal-modifiers/SKILL.md).

## Strict equality

| Method | Effect |
|---|---|
| `.mustBeTrue(msg?)` | strictly `=== true` (rejects `"yes"`, `1`, `"on"`) |
| `.mustBeFalse(msg?)` | strictly `=== false` |

Use these when the field is a real boolean checkbox value — e.g. "agree to terms" must be exactly `true`, not a truthy string.

## Form-style coercion — `accepted` / `declined`

The "accepted" rules treat `true`, `"yes"`, `"on"`, `1`, `"1"`, `"true"` as accepted. "Declined" treats their counterparts (`false`, `"no"`, `"off"`, `0`, etc.) as declined. Designed for form inputs where a checkbox/radio arrives as a string.

| Method | Effect |
|---|---|
| `.accepted(msg?)` | value must be accepted |
| `.declined(msg?)` | value must be declined |

## Conditional variants — accepted

| Method | Args | Effect |
|---|---|---|
| `.acceptedIf(field, value, msg?)` | sibling field equals value | must be accepted in that case |
| `.acceptedUnless(field, value, msg?)` | sibling field equals value | must be accepted unless that's true |
| `.acceptedIfRequired(field, msg?)` | sibling field is required | — |
| `.acceptedIfPresent(field, msg?)` | sibling field is present | — |
| `.acceptedWithout(field, msg?)` | sibling field is absent | — |

## Conditional variants — declined

| Method | Args | Effect |
|---|---|---|
| `.declinedIf(field, value, msg?)` | sibling field equals value | must be declined in that case |
| `.declinedUnless(field, value, msg?)` | sibling field equals value | must be declined unless that's true |
| `.declinedIfRequired(field, msg?)` | — | — |
| `.declinedIfPresent(field, msg?)` | — | — |
| `.declinedWithout(field, msg?)` | — | — |

All conditional variants only run inside `v.object` — sibling resolution silently passes otherwise.

## JSON Schema mapping

- `v.boolean()` → `{ type: "boolean" }`
- `.mustBeTrue()` / `.mustBeFalse()` — not currently emitted (could add `const: true/false` in the future)
- `.accepted()` / `.declined()` and their conditional variants — runtime coercion concerns, not representable

## Common chains

```ts
// Strict consent checkbox
v.boolean().mustBeTrue("You must accept the terms")

// Form-style "remember me" — accepts "on" / true / 1
v.boolean().accepted().optional()

// Cross-field — newsletter must be accepted if subscriptionType = "premium"
v.object({
  subscriptionType: v.string().oneOf(["free", "premium"]),
  newsletter: v.boolean().acceptedIf("subscriptionType", "premium"),
})

// Marketing opt-in — declined unless region is GDPR-exempt
v.object({
  region: v.string(),
  marketingOptIn: v.boolean().declinedUnless("region", "US"),
})
```
