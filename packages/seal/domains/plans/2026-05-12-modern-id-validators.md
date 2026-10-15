# 2026-05-12 — Add modern ID-format validators: UUID, CUID, ULID, nanoid

**Status:** completed 2026-05-12 — shipped in commit `fdc5ce6`
**Severity:** S3 (Convenience) — works around with `.pattern(/regex/)` today but every modern app eventually wants the right name
**Estimated effort:** 2 hours — actual: ~45 minutes
**Started:** 2026-05-12
**Context:** Surfaced during competitive-positioning audit on 2026-05-12. See [`domains/seal/design/competitive-positioning.md` § Tier 4 polish](../design/competitive-positioning.md). Zod, Valibot, Yup, Joi all ship at least UUID; seal lags here despite shipping more obscure string rules (`hslColor`, `creditCard`).

## Why

Modern JS apps generate IDs as one of:

- **UUID** — overwhelmingly v4 (random); occasionally v7 (timestamp-ordered for DB indexes); v1/v3/v5 are legacy
- **CUID2** — collision-resistant, sortable, shorter than UUIDs (24 chars), used by Paralleldrive, t3
- **ULID** — 26 chars, base32-encoded, timestamp-ordered, lexicographically sortable (Spec: Crockford base32)
- **nanoid** — 21 chars by default, URL-safe alphabet, used by Supabase, Vercel KV, lots of TS APIs

Today a user has to write `v.string().pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-...$/)` per ID type. Error messages are generic ("must match pattern"). JSON Schema gets the regex but no `format: "uuid"` hint that downstream tools recognize.

Real cost is small — a 50-line PR ships all four — but the *signal* is "seal cares about modern JS" vs "seal feels like a Laravel port from 2018".

## Scope

**In:**

- 4 new rules under `rules/string/`: `uuidRule`, `cuidRule`, `ulidRule`, `nanoidRule`
- 4 corresponding methods on `StringValidator`: `.uuid()`, `.cuid()`, `.ulid()`, `.nanoid()`
- UUID method accepts optional version: `.uuid(v?: 1|3|4|5|6|7)` — defaults to "any valid UUID format" if no version
- CUID method targets **CUID2** by default (the current spec), with a `.cuid({ v: 1 })` escape hatch for legacy CUID v1
- nanoid method accepts optional length: `.nanoid(length?: number)` — defaults to standard 21
- JSON Schema mapping: `format: "uuid"` for UUID (well-recognized), `pattern` fallback for the others (no widely-supported format keyword)

**Out:**

- KSUID — niche, can be added later if a user asks
- nanoid alphabet customization — niche; users with custom alphabets can use `.pattern()`
- Cross-validation with the runtime ID library (e.g. verifying nanoid was generated with the same alphabet) — out of scope; we validate format, not provenance

## Format references

| ID format | Regex (canonical) | JSON Schema |
|---|---|---|
| UUID (any version) | `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` | `format: "uuid"` |
| UUID v4 | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` | `format: "uuid"` + pattern |
| CUID2 | `/^[a-z][a-z0-9]{23}$/` (24 chars total, lowercase) | `pattern: "..."` |
| CUID1 (legacy) | `/^c[a-z0-9]{24,}$/` (variable, starts with c) | `pattern: "..."` |
| ULID | `/^[0-9A-HJKMNP-TV-Z]{26}$/` (Crockford base32, no I/L/O/U) | `pattern: "..."` |
| nanoid | `/^[A-Za-z0-9_-]{N}$/` where N = length (default 21) | `pattern: "..."` |

UUID version-specific regexes adjust the 13th char (version digit) and 17th char (variant nibble). Detail in implementation.

## Implementation sketch

```ts
// rules/string/id-formats.ts (new file)
import { invalidRule, VALID_RULE } from "../../helpers";
import type { SchemaRule } from "../../types";

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_BY_VERSION: Record<number, RegExp> = {
  1: /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  3: /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  5: /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  // 6 and 7 follow same pattern with their version digits
};

export const uuidRule: SchemaRule<{ version?: 1 | 3 | 4 | 5 | 6 | 7 }> = {
  name: "uuid",
  defaultErrorMessage: "The :input must be a valid UUID",
  async validate(value, context) {
    if (typeof value !== "string") return invalidRule(this, context);
    const version = this.context.options.version;
    const pattern = version ? UUID_BY_VERSION[version] : UUID_ANY;
    return pattern.test(value) ? VALID_RULE : invalidRule(this, context);
  },
};

export const cuidRule: SchemaRule<{ version?: 1 | 2 }> = {
  name: "cuid",
  defaultErrorMessage: "The :input must be a valid CUID",
  async validate(value, context) {
    if (typeof value !== "string") return invalidRule(this, context);
    const version = this.context.options.version ?? 2;
    const pattern = version === 1 ? /^c[a-z0-9]{24,}$/ : /^[a-z][a-z0-9]{23}$/;
    return pattern.test(value) ? VALID_RULE : invalidRule(this, context);
  },
};

export const ulidRule: SchemaRule = {
  name: "ulid",
  defaultErrorMessage: "The :input must be a valid ULID",
  async validate(value, context) {
    if (typeof value !== "string") return invalidRule(this, context);
    return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? VALID_RULE : invalidRule(this, context);
  },
};

export const nanoidRule: SchemaRule<{ length?: number }> = {
  name: "nanoid",
  defaultErrorMessage: "The :input must be a valid nanoid",
  async validate(value, context) {
    if (typeof value !== "string") return invalidRule(this, context);
    const length = this.context.options.length ?? 21;
    const pattern = new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
    return pattern.test(value) ? VALID_RULE : invalidRule(this, context);
  },
};
```

`StringValidator` additions:

```ts
public uuid(version?: 1 | 3 | 4 | 5 | 6 | 7, errorMessage?: string) {
  return this.addRule(uuidRule, errorMessage, { version });
}
public cuid(options?: { version?: 1 | 2; errorMessage?: string }) {
  const { errorMessage, version } = options ?? {};
  return this.addRule(cuidRule, errorMessage, { version });
}
public ulid(errorMessage?: string) {
  return this.addRule(ulidRule, errorMessage);
}
public nanoid(length?: number, errorMessage?: string) {
  return this.addRule(nanoidRule, errorMessage, { length });
}
```

JSON Schema in `StringValidator.toJsonSchema()` — extend the format-hint chain:

```ts
} else if (this.rules.some(r => r.name === "uuid")) {
  schema.format = "uuid";
}
// CUID / ULID / nanoid don't have widely-supported format keywords; fall back to pattern
const cuidOpts = getRuleOptions(this.rules, "cuid");
if (cuidOpts) {
  schema.pattern = cuidOpts.version === 1 ? "^c[a-z0-9]{24,}$" : "^[a-z][a-z0-9]{23}$";
}
// ... etc for ulid and nanoid
```

## Tasks

- [ ] Create `rules/string/id-formats.ts` with the four rule exports
- [ ] Export from [rules/string/index.ts](../../../@warlock.js/seal/src/rules/string/index.ts)
- [ ] Add `.uuid() / .cuid() / .ulid() / .nanoid()` methods to [string-validator.ts](../../../@warlock.js/seal/src/validators/string-validator.ts)
- [ ] Extend `StringValidator.toJsonSchema()` format-detection chain
- [ ] Hand-test with one valid + one invalid input per format
- [ ] Smoke-test against real generated IDs: spin up Node REPL, call `crypto.randomUUID()`, validate; same for nanoid via the `nanoid` package if installed

## Hand-test matrix

```ts
// UUID — any version
v.string().uuid()
//   ✓ "550e8400-e29b-41d4-a716-446655440000"
//   ✓ "550E8400-E29B-41D4-A716-446655440000" (case-insensitive)
//   ✗ "not-a-uuid"
//   ✗ "550e8400-e29b-41d4-a716"  (truncated)

// UUID — v4 specifically
v.string().uuid(4)
//   ✓ "550e8400-e29b-41d4-a716-446655440000"  (note 4 in 13th char, 8/9/a/b variant)
//   ✗ "550e8400-e29b-71d4-a716-446655440000"  (v7-shaped)

// CUID2 (default)
v.string().cuid()
//   ✓ "tz4a98xxat96iws9zmbrgj3a"
//   ✗ "Tz4a98xxat96iws9zmbrgj3a"  (uppercase first char)
//   ✗ "abc"                        (too short)

// CUID1 legacy
v.string().cuid({ version: 1 })
//   ✓ "ck123abc456def789ghi012jk"  (starts with c, ≥25 chars)

// ULID
v.string().ulid()
//   ✓ "01ARZ3NDEKTSV4RRFFQ69G5FAV"
//   ✗ "01ARZ3NDEKTSV4RRFFQ69G5FAv"  (lowercase)
//   ✗ "01ARZ3NDEKTSV4RRFFQ69G5FAI"  (I is excluded in Crockford)

// nanoid — default length
v.string().nanoid()
//   ✓ "V1StGXR8_Z5jdHi6B-myT"  (21 chars, URL-safe)
//   ✗ "V1StGXR8_Z5jdHi6B-my"   (20 chars — too short)

// nanoid — custom length
v.string().nanoid(10)
//   ✓ "V1StGXR8_Z"  (10 chars)
//   ✗ "V1StGXR8_Z5jdHi6B-myT" (21 chars)

// JSON Schema
v.string().uuid().toJsonSchema()
// → { type: "string", format: "uuid" }

v.string().cuid().toJsonSchema()
// → { type: "string", pattern: "^[a-z][a-z0-9]{23}$" }
```

## Decisions to lock with Hasan

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | CUID default version (1 or 2)? | **CUID2.** Current spec; CUID1 is officially deprecated by the original author (see [github.com/paralleldrive/cuid2](https://github.com/paralleldrive/cuid2)). Don't make new users learn the old format. |
| 2 | UUID method signature — `.uuid(4)` or `.uuid({ version: 4 })`? | **`.uuid(4)`.** Matches Zod's signature; one-arg case (the common case) reads cleaner. Object form is fine for libraries needing many options; UUID doesn't have many. |
| 3 | Ship KSUID too? | **No, v1.** Niche. Add later if a user asks. |
| 4 | Validate UUID variant nibble (8/9/a/b)? | **Yes, per RFC 4122.** Strict regex catches "looks-like-UUID-but-not-valid" cases. Trivial cost. |
| 5 | Naming — `.uuid()` vs `.guid()` (Yup/Joi style)? | **`.uuid()`.** GUID is the Microsoft-flavoured name; UUID is the spec and the dominant JS-world term. Add `.guid()` as an alias if someone asks. |

## Risks

- **Regex correctness drift** — if a new UUID version ships (v8 in the wild?), the rule won't recognize it. Mitigation: regex test against `crypto.randomUUID()` output in CI when seal grows tests for this.
- **nanoid alphabet customisation users** — anyone using a non-default alphabet falls back to `.pattern()`. Document the limitation; if it becomes a real ask, add `.nanoid({ alphabet: "..." })` later.

## Skills + docs lockstep

After landing:

- `skills/subskills/reference/string.md` — add the four methods to the method reference
- Update `skills/SKILL.md` example if it benefits from showing `.uuid()`
- `domains/seal/docs/recipes/id-validation.md` (new) — short page explaining the four formats, when to reach for which

## Summary

Landed in commit `fdc5ce6`.

**What shipped.** Four new rules in `rules/string/id-formats.ts`:

- `uuidRule` — RFC 4122 strict; optional version restriction (1/3/4/5/6/7) via version-specific regex. Variant nibble (8/9/a/b at position 17) checked.
- `cuidRule` — CUID2 by default (24 chars, lowercase, starts with letter); `{ version: 1 }` opts into legacy CUID1.
- `ulidRule` — 26 chars, Crockford base32 (excludes I/L/O/U).
- `nanoidRule` — URL-safe alphabet (`A-Za-z0-9_-`); default length 21, configurable.

Four matching methods on `StringValidator`: `.uuid(version?, msg?)`, `.cuid({ version?, errorMessage? }?)`, `.ulid(msg?)`, `.nanoid(length?, msg?)`.

**JSON Schema mapping.** UUID maps to `format: "uuid"` (widely supported). CUID/ULID/nanoid fall back to `pattern` since no widely-supported format keyword exists. Patterns reflect the version/length options.

**Decisions locked.** All five decisions adopted as-recommended:
- CUID2 as default (not legacy CUID1)
- Positional `.uuid(4)` signature (not options object)
- No KSUID v1
- Variant nibble checked per RFC 4122
- `.uuid()` (not `.guid()`)

**Verification.** `tsc --noEmit` clean. Hand-tested each method with one valid + one invalid input — UUID v4 distinguishes from v7, CUID2 rejects uppercase first char, ULID rejects excluded letters, nanoid enforces length precisely.

**Skills + docs.** `reference/string.md` gained a new "ID formats" table; `recipes/id-validation.md` ships the full walkthrough with format trade-offs and Cascade-pattern examples.
