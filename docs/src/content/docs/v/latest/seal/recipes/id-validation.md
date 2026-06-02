---
title: "Validating modern ID formats — UUID, CUID, ULID, nanoid"
sidebar:
  order: 8
  label: "ID validation"
---

Modern apps generate IDs as one of:

- **UUID** — RFC 4122, 36 chars with hyphens. v4 (random) is most common; v7 (timestamp-ordered) is gaining ground for database indexes
- **CUID2** — 24 chars, lowercase, collision-resistant, sortable — used by Paralleldrive, t3
- **ULID** — 26 chars, base32-encoded, timestamp-ordered, lexicographically sortable
- **nanoid** — 21 chars by default, URL-safe alphabet, ubiquitous in TS APIs (Supabase, Vercel KV, etc.)

Until 2026-05-12, seal expected you to validate these with `.pattern(/regex/)`. Now there are dedicated methods with proper format hints in JSON Schema and clearer error messages.

## UUID

```ts
v.string().uuid()        // any RFC 4122 UUID — versions 1, 3, 4, 5, 6, 7
v.string().uuid(4)       // restrict to v4 (random) only
v.string().uuid(7)       // restrict to v7 (timestamp-ordered)
```

Strict by RFC 4122 — the variant nibble (8/9/a/b at position 17) is checked, so "looks-like-UUID-but-not-valid" inputs are rejected.

**JSON Schema:** `{ type: "string", format: "uuid" }` — widely recognised by OpenAPI tooling and AJV.

**Common version choices:**
- `.uuid(4)` — random, no information leakage, the default for most apps
- `.uuid(7)` — timestamp-ordered, plays nicely with B-tree DB indexes (sorted-friendly inserts)
- No-argument `.uuid()` — accepts any version; useful when ingesting IDs you didn't generate

## CUID

```ts
v.string().cuid()                  // CUID2 (current spec — 24 chars, lowercase, starts with letter)
v.string().cuid({ version: 1 })    // legacy CUID1 (starts with "c", ≥25 chars)
```

Default is **CUID2** because CUID1 is officially deprecated by its original author ([github.com/paralleldrive/cuid2](https://github.com/paralleldrive/cuid2)). Only pass `{ version: 1 }` for legacy data — new apps should use CUID2 or one of the alternatives below.

**JSON Schema:** falls back to `pattern: "^[a-z][a-z0-9]{23}$"` (CUID2) — no widely-supported `format` keyword exists for CUID.

## ULID

```ts
v.string().ulid()  // 26 chars, Crockford base32
```

Crockford base32 excludes the letters I, L, O, U to avoid ambiguity with 1/0. The regex enforces the full 26-char form including the time component (10 chars) and randomness component (16 chars).

**JSON Schema:** falls back to `pattern: "^[0-9A-HJKMNP-TV-Z]{26}$"`.

**Why ULID over UUID?** Timestamp-ordered, sortable as strings, shorter, no hyphens (URL-safe by default). Less standard than UUID — most ecosystems treat UUID as the lingua franca, so ULIDs are best for internal-only IDs.

## nanoid

```ts
v.string().nanoid()         // standard 21-char nanoid
v.string().nanoid(10)       // custom length (10 chars)
v.string().nanoid(64)       // longer for higher collision resistance
```

URL-safe alphabet: `A-Za-z0-9_-`. Default length 21 gives ~2^126 possibilities — comparable collision resistance to UUID v4. Length is configurable per the nanoid library's convention.

**JSON Schema:** pattern with the explicit length, e.g. `pattern: "^[A-Za-z0-9_-]{21}$"`.

**Limitation.** Custom alphabets aren't supported — if your nanoids use a different alphabet (digits-only, no symbols, etc.), drop to `.pattern(/your-regex/)` directly.

## Combining with other rules

ID validators compose like any other rule:

```ts
v.string().uuid(4).required()                    // required UUID v4
v.string().ulid().optional()                     // optional ULID
v.string().nanoid().describe("Public share id")  // with description
v.string().uuid().sameAs("parent_id")            // cross-field equality check

// In a schema
const userSchema = v.object({
  id: v.string().uuid(4),
  email: v.string().email(),
  publicShareId: v.string().nanoid(12).optional(),
  parentId: v.string().uuid().nullable(),
});
```

## Cascade model patterns

For Cascade models, the typical ID column uses the framework's chosen format. Common patterns:

```ts
// UUID v4 primary keys (matches PG's gen_random_uuid())
const userSchema = v.object({
  id: v.string().uuid(4),
  email: v.string().email(),
  // ...
});

// CUID2 for public-facing IDs (collision-resistant, sortable)
const orderSchema = v.object({
  id: v.string().uuid(7),               // internal UUID v7 (timestamp-ordered)
  publicId: v.string().cuid(),          // outward-facing CUID2
  // ...
});

// nanoid for short share-links
const shareSchema = v.object({
  token: v.string().nanoid(10),         // short URL token
  // ...
});
```

## Choosing between formats

| Need | Reach for |
| --- | --- |
| Maximum ecosystem compatibility | `v.string().uuid(4)` — every tool understands UUID |
| Timestamp-ordered, B-tree friendly | `v.string().uuid(7)` — UUID v7 (RFC 9562) |
| Shorter than UUID, sortable | `v.string().ulid()` |
| Short URL tokens, share links | `v.string().nanoid(10)` |
| Modern alternative, no Postgres bloat | `v.string().cuid()` — CUID2 |
| Internal-only opaque IDs | `v.string().nanoid()` |

UUID v4 remains the safest default for cross-system compatibility. Reach for the others when you have a specific reason (ordering, brevity, URL-safety).

## Related

- [Essentials → Primitives](../essentials/01-primitives.md) — `v.string()` chain methods
- [Guides → Pick the right primitive](../guides/pick-the-right-primitive.md) — when to reach for which
