---
name: data-and-persistence
description: "Project persistence conventions: money, UTC dates, public UUIDs, Cascade models, migrations, indexes, relations and delete strategies. Use when changing stored data or model schemas. Use api-design instead for HTTP envelopes and resource output."
---

# Data & persistence

**Status:** Stable
**Applies to:** Every model, schema, migration, and persisted entity in `src/app/**`.

How we store data so it survives a year of new requirements, a currency conversion bug, and a timezone-aware feature request. Framework mechanics live in the `@warlock.js/cascade` skill — this skill is the **project-level conventions** layered on top.

> **Sub-agent rule:** Before writing any model, schema, or migration, read this file.

---

## 1. Money — integer minor units, always

### 1.1 The rule

- Store money as **integers in the currency's smallest unit** — cents for USD, halalas for SAR.
- Column name carries the unit: `totalCents`, `amountCents`, `feeCents`, `discountCents`.
- A `currency` column lives next to every money column (or once per row if the entity is mono-currency).

For example:

```typescript
// ✅ example cart schema
export const cartSchema = v.object({
  /* ... */
  totalCents: v.int().default(0),
  totalItems: v.int().default(0),
  currency: v.string().default("USD"),
  /* ... */
});
```

### 1.2 Why never floats

```typescript
0.1 + 0.2 === 0.3; // false
1234.567 * 100; // 123456.69999999999
```

Compound a million orders' subtotals across a payout report and you'll be off by enough to matter. Integer cents prevents this entire class of bug.

### 1.3 The AI-pricing exception

A token-pricing model may use a documented decimal or scaled sub-cent unit: AI provider pricing is sub-cent per token (e.g. $0.000002), where integer minor units round to zero. The exception is _only_ AI / token pricing; business money (orders, products, payments, balances, refunds) follows the cents rule.

### 1.4 Display formatting at the edge

Formatting (`$12.99`, `12.99 SAR`) is the resource layer's job — see the `api-design` skill § 5. The model and service work in cents; the resource converts.

---

## 2. Time — UTC at rest, convert at the edge

### 2.1 Storage

- All timestamp columns store **UTC**, full stop.
- The column type is `date()` in the migration; the schema type is `v.date()` returning `Date`.

### 2.2 Naming — `<verb>At`

Time columns end with `At` and describe what happened, in past tense:

| Column         | Meaning                      |
| -------------- | ---------------------------- |
| `createdAt`    | row was created              |
| `updatedAt`    | row was last updated         |
| `syncedAt`     | row was synced from a source |
| `checkedOutAt` | cart was checked out         |
| `abandonedAt`  | cart was marked abandoned    |
| `expiresAt`    | row will become invalid      |

```typescript
// ✅ example cart schema
syncedAt: v.date().optional(),
abandonedAt: v.date().optional(),
checkedOutAt: v.date().optional(),
```

### 2.3 Conversion happens at the response layer

Services and models work in UTC `Date` objects. Timezone conversion (UTC → user's local timezone) happens once, at the resource / response layer, using the authenticated user's preference. Never store timezone-adjusted timestamps.

### 2.4 Date library

The project uses `dayjs` for time arithmetic and formatting (already in dependencies). Never `moment`, never hand-rolled UTC math. The framework's `@mongez/time-wizard` provides typed helpers on top of dayjs — prefer it where available.

---

## 3. IDs

### 3.1 The rule

- **Internal primary keys** may be sequential — they're cheap, indexed, and never leave the database.
- **Any ID that crosses a process boundary** (URL, response body, log line, webhook) is opaque — UUID or nanoid.

### 3.2 Project default

Cascade defaults to sequential `id` values (a NoSQL-generated integer or the SQL primary key). The `model.uuid` getter only stringifies the primary key; it does not generate a UUID. The starter keeps that internal key for relations and authentication and adds a separate public UUID:

```typescript
import { randomUUID } from "node:crypto";
import { v } from "@warlock.js/seal";

export const orderSchema = v.object({
  publicId: v
    .string()
    .uuid()
    .default(() => randomUUID()),
  totalCents: v.int(),
});
```

Add `publicId: string(36).unique()` in `Migration.create(Order, { ... })`; generate it server-side, and omit it from writable client schemas. A default is applied when the field is absent, not on every update. The resource emits `id: ["publicId", "string"]`. Resolve a validated route ID with `Order.findOne({ publicId: id })`, then write through that model instance. `find(id)` and repository `getCached(id)` still target the internal primary key. For an existing application, backfill a unique UUID per row before requiring this column; changing a resource cast to `"string"` does not make a sequential ID opaque.

### 3.3 Why

Sequential keys leak business volume (`/orders/42178` tells anyone you've placed ~42k orders) and invite enumeration attacks (incrementing the path to find someone else's resource). Opaque IDs prevent both.

---

## 4. Audit columns

### 4.1 Framework-managed

Cascade timestamp storage names are driver-dependent: MongoDB defaults to `createdAt` / `updatedAt`, PostgreSQL to `created_at` / `updated_at`. `Migration.create` adds the driver's timestamp columns unless `{ timestamps: false }`; model writes maintain their configured columns. Keep the stored names aligned with the driver or explicitly declare the columns when customizing timestamps. API output keys remain `createdAt` / `updatedAt`: use `["created_at", "date"]` / `["updated_at", "date"]` source-key tuples for a PostgreSQL-backed resource. Do not claim that a camelCase schema key automatically reads a snake_case stored field.

### 4.2 Author tracking

For entities where "who created this" matters (most business entities), add author columns to the resource:

```typescript
// ✅ from ai-model.resource.ts
createdBy: "string",
updatedBy: "string",
deletedBy: "string",
```

These store the user-id of the actor at the time of the action. Wire them in the service:

```typescript
await ordersRepository.create({ ...input, createdBy: user.get("publicId") });
```

### 4.3 What to audit

Every entity that's user-mutable: yes. Read-only reference data (countries, currencies, system enums): no — audit columns are noise there.

---

## 5. Soft-delete vs hard-delete

### 5.1 Default to soft-delete for user-visible entities

Soft-delete keeps the row and sets the configured `deletedAt` column. Actor tracking such as `deletedBy` is app-owned. Cascade does not hide deleted rows automatically: add a global `whereNull("deletedAt")` scope or use the repository's active-read methods when you need active-only results.

### 5.2 Hard-delete for ephemeral data

Use hard-delete for:

- Sessions, OTPs, refresh tokens (expired = gone)
- Cache entries
- Idempotency-key records past their TTL
- GDPR right-to-erasure requests (when triggered)

### 5.3 Mechanics

Configure the delete strategy at the model level — see the `@warlock.js/cascade` skill's `configure-delete-strategy` topic for the framework's per-model knobs (`deleteStrategy: "soft"`, `"permanent"`, or `"trash"`; per-call `destroy({ strategy })`).

### 5.4 Restore is admin-only

If an entity supports restore, expose it through an admin endpoint, never end-user UI (unless the feature is explicitly "trash / undelete" — a deliberate UX, not an accident).

---

## 6. Migrations

### 6.1 Forward-only

Never edit a shipped migration. Once it's on `main`, the only change is a new migration on top.

### 6.2 File location

Migrations live inside the model folder: `src/app/<module>/models/<model>/migrations/<timestamp>-<noun>.migration.ts`. The framework's `npx warlock migrate` discovers them.

### 6.3 Definition shape

```typescript
// ✅ from ai-model.migration.ts
import { arrayText, bool, double, integer, json, Migration, text } from "@warlock.js/cascade";
import { AiModel } from "../ai-model.model";

export default Migration.create(
  AiModel,
  {
    provider: text().notNullable(),
    providerModelId: text().notNullable(),
    name: text().notNullable(),
    context: integer().notNullable(),
    isFree: bool().notNullable(),
    inputPrice: double().notNullable(),
    config: json().nullable(),
    features: arrayText().nullable(),
  },
  {
    unique: [{ columns: ["provider", "providerModelId"] }],
  },
);
```

Column type helpers: `text()`, `integer()`, `double()`, `bool()`, `json()`, `arrayText()`, `date()`. Always declare `.notNullable()` or `.nullable()` explicitly — never leave nullability implicit.

### 6.4 Backfill separately from schema change

Two migrations, not one:

1. Schema change (add column nullable, or add column with default).
2. Backfill (populate the column from existing data).

This keeps each migration short, fast, and safe to revert in stages.

### 6.5 Long-running backfills

If a backfill is going to touch millions of rows, gate it behind a feature flag and run it as a background job — not inside the migration runner. The migration just creates the schema; the backfill is application code.

---

## 7. Indexes

### 7.1 Every query path has a supporting index

- Add an index for a frequently queried foreign key; do not assume declaring a relation adds one.
- Any column you filter or sort on regularly gets an index.
- Composite indexes match query order (`WHERE orgId = ? AND status = ?` → index `(orgId, status)`).

### 7.2 Add the index alongside the query

If a new query is introduced, the index lands in the same PR. Don't push slow queries to production and patch later.

### 7.3 Tooling

Define indexes alongside the migration using column `.index()` / `.unique()` or the migration options. See the `@warlock.js/cascade` skill's `write-migration` topic.

---

## 8. Schema conventions

### 8.1 Column naming — camelCase

New model and database column names use `camelCase`: `createdAt`, `totalCents`, `providerModelId`. Resource output also uses camelCase. For legacy snake_case columns, use source-key tuples in the resource as shown in the `api-design` skill; do not rename a stored column merely by changing the output key.

### 8.2 Foreign keys — `<noun>Id`

`userId`, `organizationId`, `cartId`. Always singular, always `Id` suffix. Pass an explicit `foreignKey` to `@BelongsTo("Name", { foreignKey: "userId" })` when wiring a relation; match the stored column and the model schema.

### 8.3 Booleans — affirmative

`isActive`, `isFree`, `hasShipped`, `wasRefunded`. Never negative (`isNotDeleted`, `isUnverified`) — negative booleans break readability under negation (`!isNotDeleted` reads as a riddle).

### 8.4 Enums — string in the column, enum in the schema

```typescript
status: v.enum(CartStatus).default(CartStatus.ACTIVE),
```

The enum is defined once in `app/<module>/types/<noun>-status.type.ts` and referenced everywhere. Never use raw string literals for status fields outside the type definition.

### 8.5 Defaults

Declare defaults in the schema (`v.string().default("USD")`), not just in the migration. The schema default keeps `Infer<>` clean and gives the service a sensible starting value.

---

## 9. Models — structural rules

### 9.1 File layout

```
src/app/<module>/models/<noun>/
  <noun>.model.ts        ← @RegisterModel() + schema + class + getters
  index.ts               ← re-export
  migrations/
    <timestamp>-<noun>.migration.ts
```

### 9.2 Example model file shape

```typescript
// 1. schema first
export const cartSchema = v.object({/* columns */});
export type CartSchema = Infer<typeof cartSchema>;

// 2. class with decorator
@RegisterModel()
export class Cart extends Model<CartSchema> {
  public static table = "carts";
  public static schema = cartSchema;

  // 3. relations
  @BelongsTo("Organization", { foreignKey: "organizationId" })
  public organization?: Organization;

  @HasMany("CartItem", { foreignKey: "cartId" })
  public items?: CartItem[];

  // 4. typed getters — one per persisted field accessed from app code
  public get totalCents() {
    return this.get<number>("totalCents", 0);
  }
}
```

### 9.3 Typed getters over `.get<T>("field")` at call sites

This is project policy. Every column accessed from application code gets a typed getter on the model. One line beats `cart.get<number>("totalCents")` across N call sites.

### 9.4 Class-level JSDoc for non-obvious domain logic

Explain identity ownership, source-of-truth rules, and persisted snapshots for any model whose semantics are not obvious from its columns.

---

## 10. Review checklist

Before merging a change that touches a model, schema, or migration:

- [ ] Money columns are `integer cents` with `currency` alongside (AI-pricing is the only exception)
- [ ] Time columns end with `At`, store UTC `Date`
- [ ] No timezone-adjusted timestamps in storage
- [ ] IDs exposed in URLs / responses are opaque
- [ ] Audit columns (`createdBy`, `updatedBy`) wired where author tracking matters
- [ ] Soft-delete strategy chosen deliberately, configured via cascade
- [ ] Migration is forward-only, not editing a shipped file
- [ ] Backfill is a separate migration / background job from the schema change
- [ ] Every new query path has a supporting index
- [ ] Column names camelCase, foreign keys `<noun>Id`
- [ ] Booleans are affirmative (`isActive`, never `isNotDeleted`)
- [ ] Enums defined once in `types/`, never repeated as string literals
- [ ] Defaults declared in the schema, not only in the migration
- [ ] Every accessed column has a typed getter on the model
- [ ] Class-level JSDoc on the model if domain semantics aren't obvious
