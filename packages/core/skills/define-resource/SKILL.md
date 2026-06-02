---
name: define-resource
description: 'Map model fields to wire-shape via `defineResource()` or `Resource` subclasses. Output-only — never put business logic, hydration, or reconciliation in a resource. Triggers: `defineResource`, `Resource`, `RegisterResource`, `toJSON`, `"self"`, `"localized"`, `"uploadsUrl"`; "shape an API response", "nest related resources", "rename a field on output", "self-referential tree resource"; typical import `import { defineResource } from "@warlock.js/core"`. Skip: localized columns — `@warlock.js/core/use-localization/SKILL.md`; URL casting — `@warlock.js/core/build-url/SKILL.md`; controller side — `@warlock.js/core/create-controller/SKILL.md`; competing libs `@nestjs/swagger` `@ApiProperty`, `class-transformer`, hand-rolled DTO mappers.'
---

# Warlock — define a resource

A resource is a one-way mapper: model in, wire-shape out. Pick the fields the API exposes, cast each to a wire type, and let the framework normalize the schema at definition time. Resources do not own logic.

## The shape

```ts title="src/app/<module>/resources/<entity>.resource.ts"
import { defineResource } from "@warlock.js/core";

export const ProductResource = defineResource({
  schema: {
    id: "string",
    name: "string",
    price: "float",
    created_at: "date",
  },
});
```

Invoke with a model or plain object and serialize:

```ts
const json = new ProductResource(product).toJSON();
```

The class returned by `defineResource` is constructed with `new`. `toJSON()` returns a plain object — pass that into a `response.<helper>()`.

## Two patterns

**`defineResource({...})`** — the project default. Used in every `src/app/*/resources/*.resource.ts`. Returns a `Resource` subclass with `schema` pre-normalized once at definition time.

**`class extends Resource`** — only when you need to override `boot()` or `extend()` with non-trivial logic that doesn't fit the `defineResource` hooks. Decorate with `@RegisterResource()` so the schema gets normalized:

```ts
import { RegisterResource, Resource } from "@warlock.js/core";

@RegisterResource()
export class ProductResource extends Resource {
  public static schema = {
    id: "string",
    name: "string",
    price: "float",
  };
}
```

Default to `defineResource`. Reach for a subclass only when a hook would be uglier as an inline arrow.

## Cast types

| Cast        | Source                  | Output                                        |
| ----------- | ----------------------- | --------------------------------------------- |
| `string`    | any                     | `String(value)`                               |
| `number`    | any                     | `Number(value)` (NaN → `undefined` or `null`) |
| `int`       | any                     | `parseInt(value)`                             |
| `float`     | any                     | `parseFloat(value)`                           |
| `boolean`   | any                     | `Boolean(value)`                              |
| `date`      | `Date` / ISO string     | configurable object (format/iso/timestamp/humanTime) |
| `localized` | `LocalizedObject[]`     | string for the request's locale               |
| `url`       | path                    | absolute URL via `url()` helper               |
| `uploadsUrl`| path                    | absolute URL under the uploads prefix         |
| `storageUrl`| path                    | absolute URL via `storage.url(...)`           |
| `object`    | any object              | passes through if non-empty object            |
| `array`     | any                     | passes through if array                       |

### Suffix modifiers

- `[]` — declares the field as an array. Each element is cast with the base type. `"string[]"` maps to `string[]`.
- `?` — nullable. When the source value is `null`/`undefined`, the field is `null` in the output instead of being dropped.
- Combined: `"string[]?"` — nullable array of strings. Order is fixed: `[]` first, then `?`.

```ts
schema: {
  tags: "string[]",          // array of strings
  bio: "string?",            // nullable string
  scores: "number[]?",       // nullable array of numbers
}
```

Without `?`, undefined/null values are omitted from the output entirely.

## Renaming fields

Use a `[inputKey, castType]` tuple to map an internal field to a different output key:

```ts
schema: {
  displayName: ["name", "string"],
  joinedAt: ["created_at", "date"],
}
```

The output object will have `displayName` and `joinedAt`; the model is read by the source key on the left of the tuple.

## Nested resources

Reference another resource constructor directly. Works for single objects and arrays — the field's runtime shape decides:

```ts
import { defineResource } from "@warlock.js/core";
import { OrganizationResource } from "app/organizations/resources/organization.resource";

export const UserResource = defineResource({
  schema: {
    id: "string",
    name: "string",
    organization: OrganizationResource,
  },
});
```

If `user.organization` is a single object, you get a nested object. If it's an array, you get an array of nested objects. The framework branches on `Array.isArray` at transform time.

For cyclic resource graphs (A embeds B embeds A), wrap the cross-reference in `lazy(() => ...)` from `@mongez/reinforcements`. Without it, ESM module-init order can leave one side's binding as `undefined` when the other side's schema captures it — the first `.toJSON()` then explodes.

```ts title="src/app/books/resources/book.resource.ts"
import { lazy } from "@mongez/reinforcements";
import { defineResource } from "@warlock.js/core";
import { AuthorResource } from "app/authors/resources/author.resource";

export const BookResource = defineResource({
  schema: {
    id: "string",
    title: "string",
    author: lazy(() => AuthorResource),
  },
});
```

`lazy()` captures the binding without reading it; both modules finish evaluating, then the binding is read at serialize-time when both resources are fully defined. Reference implementation in the project: `src/app/examples/resources-circular/` — a working `AuthorResource` ↔ `BookResource` smoke demo with single embed, array embed, and back-reference cases.

## Self-references

A node that embeds itself uses the `"self"` / `"self[]"` markers:

```ts
schema: {
  id: "string",
  name: "string",
  parent: "self",       // single self-reference
  children: "self[]",   // array of self-references
}
```

The framework tracks visited identities and caps recursion at depth 10 so cyclic data (`A.parent → B`, `B.parent → A`) doesn't infinite-loop.

## Localized fields

Models that store i18n as an array of `{ localeCode, value }` use the `localized` cast. The request's locale (from `useRequestStore().request.locale`) picks the right entry:

```ts
schema: {
  title: "localized",
}
```

If no locale is set on the request, the first entry wins as a fallback.

## Date output options

Default date cast emits an object — `{ format, timestamp, humanTime, iso }`. To shape output globally use the static `parsedSchema` field after defining, or override via a subclass. For most APIs, the default is fine.

## Computed fields (resolver functions)

Schema entries can be functions for fields the model doesn't store directly. The function receives `(value, resource)` bound to the resource instance:

```ts
schema: {
  id: "string",
  fullName: function (_value, resource) {
    return `${resource.get("first_name")} ${resource.get("last_name")}`;
  },
}
```

Keep resolvers trivial. Anything beyond string-glue belongs in a service or a model accessor — the resource is the wrong place for logic.

## Hooks (defineResource)

`defineResource` accepts three hooks. Use sparingly:

```ts
export const ChatResource = defineResource({
  schema: { id: "string", title: "string" },
  boot(resource) {
    // before transform
  },
  extend(resource) {
    // after transform — mutate resource.data
  },
  transform(data, resource) {
    // final pass — mutate `data` in place; the return value is ignored
    data.slug = String(data.title).toLowerCase();
  },
});
```

`transform` runs inside `extend()` as `transform.call(this, this.data, this)` — the framework discards whatever it returns, so you must mutate the passed `data` object directly. Returning a fresh object silently drops your changes.

Hooks are an escape hatch. If you find yourself running queries or reconciling state inside a hook, stop — that work belongs in a service or in a `prepare-*` step before the resource is constructed.

## Attaching to a model

Models reference their default resource via a static `resource` field. Repositories and other helpers can then serialize without importing the resource:

```ts
// src/app/products/models/product/product.model.ts
import { Model, RegisterModel } from "@warlock.js/cascade";
import { ProductResource } from "app/products/resources/product.resource";

@RegisterModel()
export class Product extends Model {
  public static resource = ProductResource;
}
```

This is convention, not a framework requirement. Controllers/services that import the resource explicitly work the same way.

## Output-only rule

Resources map fields. They do not:

- run database queries
- hydrate compact stored shapes into wire shapes
- reconcile state across records
- emit events
- call services

If a wire field requires hydration (e.g. compact stored blocks → full wire blocks), run a `hydrate-*.service.ts` against the model before the resource is constructed. The resource stays a pure mapper.

This is the single most-violated rule in the project. Don't push work into resource hooks because it's convenient — it makes resources untestable and couples wire output to side effects.

## Common patterns

### Flat shape

```ts
export const FaqResource = defineResource({
  schema: {
    id: "string",
    question: "object",
    answer: "object",
    status: "string",
    created_at: "date",
  },
});
```

### Belongs-to + array relations

```ts
export const ChatMessageResource = defineResource({
  schema: {
    id: "string",
    content: "string",
    user: UserResource,
    attachments: UploadResource,
    chat: ChatResource,
    created_at: "date",
  },
});
```

`attachments` is an array on the model — the framework auto-maps each element through `UploadResource`.

### Self-referential tree

```ts
export const CommentResource = defineResource({
  schema: {
    id: "string",
    body: "string",
    parent: "self",
    replies: "self[]",
  },
});
```

## Gotchas

- **Don't put logic in resources.** Reconciliation/hydration belongs in services. Resources break when they grow logic.
- **`defineResource` returns a class, not a function.** Use `new XResource(model).toJSON()`. Forgetting `new` returns `undefined`.
- **Nested resource value `undefined`/`null` is dropped** unless the parent field uses `?` suffix on a cast type. Nested resource constructors don't accept `?` directly — return `null` from a resolver if you need an explicit null.
- **Tuple form `[inputKey, castType]` only accepts string cast types**, not nested resource constructors. For relations, key the output by the same field name as the model.
- **`localized` reads `useRequestStore().request.locale`**. Outside a request context (jobs, CLI), the first entry wins as a fallback.
- **Schema normalization is one-shot.** Mutating `static schema` after definition doesn't propagate. Re-run `Resource.normalizeSchema(...)` if you really need that.

## See also

- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — the output-only rule and where logic actually lives.
- [`build-restful/SKILL.md`](../build-restful/SKILL.md) — wiring a resource into a CRUD pipeline.
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — calling `new XResource(record).toJSON()` from a controller.
