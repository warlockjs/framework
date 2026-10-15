# 2026-05-12 — Relation decorators (`@BelongsTo`, `@HasOne`, `@HasMany`, `@BelongsToMany`)

**Status:** proposed
**Owner:** Hasan
**Type:** breaking API replacement — no migration, package unreleased
**Surfaced by:** decorator-API design conversation, 2026-05-12

## Problem

Today, relations are declared in two places:

```ts
@RegisterModel()
class User extends Model {
  static relations = {
    organization: belongsTo("Organization"),
    posts: hasMany("Post"),
  };

  organization?: Organization;
  posts?: Post[];
}
```

The name `organization` is written **twice** — once in the relations object, once as a property. Relation type and field type sit apart. The duplicate-name problem is real: rename one and forget the other and nothing complains until runtime.

## What ships

Four class-member decorators, applied to the field declaration:

```ts
@RegisterModel()
class User extends Model {
  @BelongsTo("Organization") organization?: Organization;
  @HasOne("Profile") profile?: Profile;
  @HasMany("Post") posts?: Post[];
  @BelongsToMany("Group") groups?: Group[];
}
```

One declaration per relation. Name appears once. Relation type and field type co-located.

### Decorator semantics

- **TC39 stage 3** (matches the migrated `@RegisterModel`). Single signature shape across all four.
- Each decorator runs once per field, captures the relation config, and registers it into the owning class's `relations` static map via `context.addInitializer` (which fires after the class body fully evaluates so the registration is on the **class**, not the instance).
- Field initializer is left untouched at runtime — the decorator's job is metadata registration, not value assignment.

### Signature

```ts
function BelongsTo(model: string, options?: BelongsToOptions): FieldDecorator;
function HasOne(model: string, options?: HasOneOptions): FieldDecorator;
function HasMany(model: string, options?: HasManyOptions): FieldDecorator;
function BelongsToMany(model: string, options?: BelongsToManyOptions): FieldDecorator;
```

`model` is the string-name registry key (matches the `@RegisterModel({ name })` value, defaults to class name). String form is mandatory — no class refs — to keep the no-circular-imports invariant the registry already established.

Options inline, second arg. No three-arg overloads.

### Convention-based defaults

Each decorator infers sensible defaults from the relation name + model name, configurable globally via Cascade config:

| Relation | Default foreign key | Default local key | Default pivot table |
|---|---|---|---|
| `@BelongsTo("Organization")` on `organization?` | `organization_id` (snake-cased model + `_id`) | `id` | — |
| `@HasOne("Profile")` | owning model's snake-name + `_id` on the related (e.g. `user_id`) | `id` | — |
| `@HasMany("Post")` | owning model's snake-name + `_id` on the related | `id` | — |
| `@BelongsToMany("Group")` | local: owning `_id`; foreign: related `_id` | `id` on both | alphabetical join of the two model snake-names (e.g. `group_user`) |

Configurable via `src/config/database.ts`, mirroring the existing `modelOptions` / `migrationOptions` shape — a new top-level `relationOptions` block on `ConnectionOptions`:

```ts
const databaseConfigurations: ConnectionOptions<...> = {
  // ...existing fields
  modelOptions: {
    namingConvention: "snake_case", // already exists — drives FK casing
    // ...
  },
  migrationOptions: { /* existing */ },
  relationOptions: {
    foreignKeySuffix: "_id",                                // default "_id"
    pivotTableNamingOrder: "alphabetical" | "owner_first",  // default "alphabetical"
  },
};
```

Two notes on what's **not** a separate config knob:

- **Foreign-key case** (snake vs camel) **derives from `modelOptions.namingConvention`** — if the model uses `snake_case` columns, the inferred FK is `organization_id`; if `camelCase`, `organizationId`. Adding a separate `foreignKeyCase` would let users desync the two and produce broken column names. Not a feature.
- **Per-model overrides** stay where they always have — explicit `{ foreignKey: "org_id" }` in the decorator options wins over any convention.

Convention defaults are **inspectable** at runtime via `Model.relationConfig(name)` — useful when an error message says "column `organization_id` not found" and the user wants to know where that name came from.

### Static `relations` field

Stays on `Model` as `public static relations: Record<string, RelationDefinition>`. Decorator initializers write into it. Everything downstream (`with()`, the relation loader, `verifyRegisteredRelations`, the pivot ops, etc.) keeps reading from the same map. **No internal-API churn.**

### Helper functions removed

`hasMany()`, `hasOne()`, `belongsTo()`, `belongsToMany()` in `@warlock.js/cascade/src/relations/helpers.ts` are **deleted**. Package is unreleased — clean removal, no deprecation.

## Migration

No codemod needed since:
- All current uses are in your own `src/app/` + `@warlock.js/create-warlock/templates/`.
- Pattern is mechanical search-and-replace inside each `static relations = { ... }` block:
  - `name: belongsTo("X", opts)` → `@BelongsTo("X", opts) name?: X;`
  - `name: hasMany("Y", opts)` → `@HasMany("Y", opts) name?: Y[];`
  - etc.
- The decorator emits identical metadata into `static relations` — no runtime semantics change.

Update [template files](@warlock.js/create-warlock/templates/warlock/src/app/) at the same time so new scaffolds use the new shape.

## Decorator implementation outline

```ts
function makeRelationDecorator(type: RelationType) {
  return (model: string, options?: AnyRelationOptions) =>
    function <T>(_value: undefined, context: ClassFieldDecoratorContext<T>) {
      if (context.kind !== "field") {
        throw new Error(`@${type} can only be applied to fields — got "${context.kind}".`);
      }

      const relationName = String(context.name);

      context.addInitializer(function (this: T) {
        const ModelClass = (this as any).constructor as typeof Model;
        // Mutate the static map; addInitializer fires once per class
        // because it's the *class field* initializer path, run on the
        // prototype side via TC39 stage 3 semantics.
        registerRelationOnClass(ModelClass, relationName, { type, model, options });
      });
    };
}

export const BelongsTo     = makeRelationDecorator("belongsTo");
export const HasOne        = makeRelationDecorator("hasOne");
export const HasMany       = makeRelationDecorator("hasMany");
export const BelongsToMany = makeRelationDecorator("belongsToMany");
```

**Open question:** TC39 stage 3 class field decorators run their initializer **once per instance** — not once per class — because field initializers are instance-level. That's wrong for relation metadata, which is class-level. Two paths:

- **(a) Use class-level deduplication** inside `registerRelationOnClass` — check `ModelClass.relations[name]` first, skip if already registered. Cheap but ugly (runs per instance, no-ops after first).
- **(b) Use `accessor` decorators** instead of bare field decorators — these have richer context but still instance-bound. Same fix needed.
- **(c) Use a class-level decorator that scans pre-declared fields** — defeats the per-field ergonomic.
- **(d) Move registration to a static-block emitted by the decorator** — requires class decorator augmentation, not field decorator.

Spike `(a)` first; it's the simplest path that probably just works. If perf is a concern (registration scan on every instance construction) escalate to (d).

## Out of scope

- **Typed relation names** flowing into `with()` / `pivot()`. Deferred — TS gymnastics with TC39 stage 3 decorators are non-trivial. Track in a follow-up plan.
- **Class-ref support** (`@BelongsTo(Organization)` instead of `@BelongsTo("Organization")`). Strings stay mandatory to preserve the no-circular-imports invariant.
- **Auto-property-type inference** — TypeScript decorators don't inform property types. `organization?: Organization` annotation stays explicit.
- **Eager-load defaults** (e.g. `@BelongsTo("Organization", { eager: true })`) — current `with()` semantics unchanged; eager-load story belongs in its own design pass.
- **Pivot decorator** (`@Pivot`). Killed in the design conversation — `model.pivot("relation")` namespace replaces it.

## Effort

A focused day:

1. Implement four decorators + shared `makeRelationDecorator` factory (~80 LOC).
2. Decide registration path (open question above) — spike, pick, lock.
3. Delete `helpers.ts` exports.
4. Migrate `src/app/**` models + `@warlock.js/create-warlock/templates/**` models (mechanical).
5. Update the module-skill scaffold ([.agent/skills/module-skill/SKILL.md:220](.agent/skills/module-skill/SKILL.md:220)) so the generator emits decorator-style relations.
6. Smoke-test against `verifyRegisteredRelations()` at boot.

No test churn beyond the model-registry tests in `@warlock.js/cascade/tests/unit/model/` — those will need new fixtures matching the decorator shape.

## When this ships

- Update cascade docs (relations guide + getting-started installation) to use the decorator form.
- Update `domains/cascade/plans/2026-05-06-docs-rewrite/` outlines that reference `static relations = {}` syntax.
- Delete this plan file.

## Open questions

1. **Class-level vs instance-level registration** (see implementation outline). My pick: option (a), dedupe inside `registerRelationOnClass`. Reason: simplest, no decorator-spec gymnastics, idempotent so dedupe is safe. Tradeoff: runs once per instance instead of once per class — measurable on hot construction paths but probably noise in real apps.

2. **Convention config location.** Locked: `src/config/database.ts` under a new `relationOptions` block on `ConnectionOptions`, alongside the existing `modelOptions` / `migrationOptions`. Foreign-key casing derives from `modelOptions.namingConvention` (no separate `foreignKeyCase` knob — would let users desync casing from columns).

3. **`@BelongsToMany` pivot-table-name convention.** Alphabetical join of the two model snake-names is the Laravel default (`group_user`, not `user_group`). My pick: match Laravel, configurable to `owner_first` for teams that prefer explicit ordering. Tradeoff: alphabetical is unintuitive at first glance.

4. **What does `@HasMany` infer about the related model's foreign-key column?** It's `<owner_snake>_<suffix>` on the related. But what if the owner's `@RegisterModel({ name })` differs from the class name? Use the registry name (since that's what string refs use), not the class name. Worth locking now so the rename case is unambiguous.

5. **Decorator placement check.** Throw with a clear message if `@BelongsTo` is applied to anything except a field — same defensive pattern as `@RegisterModel`'s `context.kind !== "class"` check. Cheap, prevents footgun.
