# WR-036 — `v.union` of several objects only tries the first object member

- **Package:** `@warlock.js/seal` 5.30.0
- **Classification:** confirmed bug
- **Found:** 2026-10-17, during an app's live acceptance run. Every task created by a non-owner actor failed to
  read back, because its stored actor field was a union of three object shapes.

## Expected

Per the docs, `v.union([...])` "tries each validator in order until one passes". A union of object schemas
should accept a value that matches any member.

## Observed

Only the first object member is tried. Its error is returned even though a later member matches.

```js
import { v, validate } from "@warlock.js/seal";

const owner = v.object({ kind: v.literal("owner"), id: v.literal("__owner__") });
const member = v.object({ kind: v.literal("member"), id: v.string() });

await validate(v.object({ a: v.union([owner, member]) }), { a: { kind: "member", id: "x" } });
// isValid: false — "The kind must be one of the following values: owner"

await validate(v.object({ a: v.discriminatedUnion("kind", [owner, member]) }), { a: { kind: "member", id: "x" } });
// isValid: true
```

## Cause (from reading `esm/rules/core/union.mjs`)

Each member is gated by `matchesType`, and every object member "matches" a plain object. When the first
object member fails, `firstErrorOnly` (default `true`) makes the loop `break` instead of trying the next
member that also matches the type.

## Requested fix

- For a union, try every member whose type matches before reporting failure. `firstErrorOnly` should limit the
  errors reported, not the members tried.
- Report the error of the closest member (or all members' errors when `firstErrorOnly` is false).
- Add a spec with two or more object members, where a non-first member matches.

## Workaround in the app

Use `v.discriminatedUnion("kind", [...])` for unions of objects.
