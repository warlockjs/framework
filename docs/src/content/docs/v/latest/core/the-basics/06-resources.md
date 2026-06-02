---
title: "Resources"
description: The output mapper — turn a model (with relations and dates and localized blobs) into a clean, predictable JSON payload. The wire shape every endpoint sends.
sidebar:
  order: 8
  label: "Resources"
---

A resource in Warlock is a small mapper that turns a model into a wire-shaped JSON object. Field by field, it declares what the consumer sees and how it's typed. Nothing else.

The reason resources exist as a primitive: models change shape with every migration, relations land lazily, dates are stored as `Date` objects but consumers want ISO strings or timestamps, localized fields are arrays in the database but a single string on the wire. Without a layer to mediate, every controller ends up reshaping models inline — inconsistent payloads, duplicated date logic, leaked internal columns. The resource is the one place where "model field" becomes "wire field," and once it's declared, every endpoint that emits that model gets the same shape for free.

This page covers the shape, the field types, nested resources for relations, and how the framework calls your resource automatically. Conditional fields, the `transform` hook, lazy circular references, doc generation, and the `arrayOf` schema-within-a-schema live in [`resources-deep.md`](./resources-deep.md).

## The output-only rule

A resource maps fields. That's the whole job.

It does not load relations. It does not call services. It does not run business logic. It does not reconcile state. If you find yourself wanting to fetch a missing column or compute a side-effect inside a resource, you've picked the wrong layer — that work belongs in a service before the model reaches the resource, or as a typed getter on the model itself.

This rule exists because resources run during JSON serialization, often inside a list of dozens of records. The moment one resource calls a service, the response time goes from "one query plus map" to "N queries plus map," and the bug lives buried inside the wire layer where nobody looks. Keep them pure.

## The shape

The shorthand form — `defineResource()` — covers 95% of cases:

```ts title="src/app/products/resources/product.resource.ts"
import { defineResource } from "@warlock.js/core";

export const ProductResource = defineResource({
  schema: {
    id: "string",
    name: "string",
    price: "number",
    description: "string",
    image: "uploadsUrl",
    created_at: "date",
    updated_at: "date",
  },
});
```

Each key is the wire field name. Each value is the cast type — a string from a fixed set, a nested resource class, or a more elaborate config covered below.

The class form gives you the same thing with hooks for the rarer cases:

```ts title="src/app/products/resources/product.resource.ts"
import { RegisterResource, Resource } from "@warlock.js/core";

@RegisterResource()
export class ProductResource extends Resource {
  public static schema = {
    id: "string",
    name: "string",
    price: "number",
  };
}
```

The `@RegisterResource()` decorator normalizes the schema once at definition time — the runtime path stays fast. `defineResource()` does the same normalization for you, no decorator needed.

## Where it lives

One file per resource under the module's `resources/` folder, named `<entity>.resource.ts` (singular):

```
src/app/products/resources/
  product.resource.ts
```

The exported value is PascalCase + `Resource` suffix: `ProductResource`, `FaqResource`, `UserResource`.

## Field types

A field type is a string — these are the values the framework understands:

| Type          | What it does                                                    | Output example                       |
| ------------- | --------------------------------------------------------------- | ------------------------------------ |
| `"string"`    | Coerce via `String(value)`                                      | `"hello"`                            |
| `"int"`       | `parseInt(value)` — drops to `undefined` on `NaN`               | `42`                                 |
| `"float"`     | `parseFloat(value)` — drops to `undefined` on `NaN`             | `19.99`                              |
| `"number"`    | `Number(value)` — drops to `undefined` on `NaN`                 | `42` or `19.99`                      |
| `"boolean"`   | `Boolean(value)`                                                | `true`                               |
| `"date"`      | Run through dayjs — full date envelope by default               | `{ format, timestamp, humanTime, iso }` |
| `"localized"` | Pick the value matching the request locale from a `[{ localeCode, value }]` array | `"Hello"`             |
| `"url"`       | Pass through `url()` — turns a relative path into a full URL    | `"https://example.com/foo"`          |
| `"uploadsUrl"`| Pass through `uploadsUrl()` — full URL into the uploads bucket  | `"https://cdn.example.com/u/foo.jpg"`|
| `"storageUrl"`| Pass through `storage.url()` — full URL via the current storage disk | `"https://s3.../foo.jpg"`       |
| `"object"`    | Pass through if the value is a non-empty plain object           | `{ key: "value" }`                   |
| `"array"`     | Pass through if the value is an array                           | `[1, 2, 3]`                          |

Two suffixes modify the base type:

| Suffix  | Meaning                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- |
| `"[]"`  | Field is an array — the base type is applied to each element. `"string[]"` is an array of strings.   |
| `"?"`   | Nullable — `null` and `undefined` produce `null` in the output (otherwise the field is omitted).     |

Combined: `"string[]?"` is a nullable array of strings. Order matters — `[]` before `?`.

```ts
defineResource({
  schema: {
    id: "string",
    tags: "string[]",         // → ["tag-a", "tag-b"]
    bio: "string?",           // → null if absent (key still present)
    images: "uploadsUrl[]",   // → ["https://cdn/.../a.jpg", "https://cdn/.../b.jpg"]
  },
});
```

If a field has no value and is not marked nullable, it's omitted from the output. That keeps payloads tight by default.

## Renaming an input key

When the wire name doesn't match the model column, declare a tuple — `[inputKey, castType]`:

```ts
defineResource({
  schema: {
    id: "string",
    fullName: ["full_name", "string"],    // model.full_name → wire.fullName
    avatar: ["profile_image", "uploadsUrl"],
  },
});
```

The first element is the column to read from the model; the second is the cast. Useful for snake-case → camelCase translation on the way out.

## Nested resources — for relations

When a relation is loaded on the model, point the field at the related resource class. The framework recursively calls its `toJSON()`:

```ts title="src/app/projects/resources/project.resource.ts"
import { defineResource } from "@warlock.js/core";
import { OrganizationResource } from "app/organizations/resources/organization.resource";
import { UserResource } from "app/users/resources/user.resource";

export const ProjectResource = defineResource({
  schema: {
    id: "string",
    name: "string",
    description: "string",
    organization: OrganizationResource,   // belongsTo Organization
    createdBy: UserResource,              // belongsTo User (via `created_by`)
    created_at: "date",
  },
});
```

The framework reads `model.organization` (the loaded relation), wraps it with `new OrganizationResource(value).toJSON()`, and inlines the result. If the relation wasn't loaded, the field is omitted.

The same field works for both single relations and arrays — if the value is an array, the framework maps over each element:

```ts
defineResource({
  schema: {
    id: "string",
    attachments: UploadResource,    // hasMany — also works
  },
});
```

This is exactly the production shape from the reference codebase — the same `ChatMessageResource` field works whether `attachments` is one upload or twenty.

## Self-references — recursive trees

For trees (replies to messages, sub-categories), use the `"self"` and `"self[]"` markers:

```ts
defineResource({
  schema: {
    id: "string",
    title: "string",
    parent: "self",          // single self-reference
    children: "self[]",      // array of self-references
  },
});
```

The framework recurses using the same resource class, with built-in cycle detection (max depth of 10, plus identity tracking via `id` / `_id`) so a circular `parent → child → parent` pair can't lock the renderer.

## Wiring the resource to the model

A model declares its resource via a static property:

```ts title="src/app/projects/models/project/project.model.ts"
import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/seal";
import { ProjectResource } from "../../resources/project.resource";

export const projectSchema = v.object({
  name: v.string(),
  description: v.string().optional(),
});

export type ProjectSchema = Infer<typeof projectSchema>;

@RegisterModel()
export class Project extends Model<ProjectSchema> {
  public static table = "projects";

  public static schema = projectSchema;

  public static resource = ProjectResource;
}
```

That single line — `public static resource = ProjectResource;` — is the wiring. From this point on, every time the framework serializes a `Project` (controller return, JSON.stringify, nested inside another resource), it runs through `ProjectResource` automatically.

You almost never call `new ProjectResource(project).toJSON()` by hand. The framework does it for you:

```ts title="src/app/projects/controllers/list-projects.controller.ts"
import type { RequestHandler } from "@warlock.js/core";
import { projectsRepository } from "../repositories/projects.repository";

export const listProjectsController: RequestHandler = async (request, response) => {
  const { data: projects, pagination } = await projectsRepository.list(request.all());

  return response.success({ projects, pagination });
};
```

`projects` is an array of `Project` model instances. The framework calls `toJSON()` on each as it serializes the response body, which in turn runs `ProjectResource`. The controller doesn't import the resource. The repository doesn't either. The wiring sits once on the model.

If you DO want to apply a resource manually — say, to a plain object that isn't a model — instantiate it directly:

```ts
const wireShape = new ProjectResource(plainObject).toJSON();
```

Same constructor accepts a `Model`, a `Resource` (re-wraps it), or a plain object.

## Picking which columns to serialize

The model exposes two opt-in knobs around `toJSON()`:

```ts
@RegisterModel()
export class Product extends Model<ProductSchema> {
  public static table = "products";
  public static schema = productSchema;

  public static resource = ProductResource;

  // Optional: limit the model.data fed to the resource to these columns only
  public static resourceColumns = ["id", "name", "price", "image"];

  // Used only when `resource` is unset — picks a subset of model.data
  public static toJsonColumns = ["id", "name"];
}
```

`resourceColumns` is a pre-filter — the model passes only these columns (plus loaded relations) to the resource. Useful when a wide model holds internal columns you never want to leak.

`toJsonColumns` is the no-resource fallback — if `resource` is undefined, the model serializes with these columns only. Most apps don't need it; declaring a resource is cleaner.

## A real example end-to-end

The actual `faqs` resource from the reference codebase — fifteen lines, complete:

```ts title="src/app/faqs/resources/faq.resource.ts"
import { defineResource } from "@warlock.js/core";

export const FaqResource = defineResource({
  schema: {
    id: "string",
    question: "object",
    answer: "object",
    organization_id: "string",
    project_id: "string",
    created_by: "string",
    updated_by: "string",
    status: "string",
    last_summarized_at: "date",
    metadata: "object",
  },
});
```

The model wires it on:

```ts title="src/app/faqs/models/faq/faq.model.ts"
@RegisterModel()
export class Faq extends Model<FaqSchema> {
  public static table = "faqs";
  public static schema = faqSchema;
  public static resource = FaqResource;
}
```

And from there, every controller that returns FAQs gets the same wire shape:

```ts title="src/app/faqs/controllers/list-faqs.controller.ts"
return response.success({ faqs, pagination });
```

No `.toJSON()` call. No `new FaqResource(...)`. The framework runs the resource the moment the response serializes.

## Gotchas

- **Resources are output-only — keep them pure.** No service calls, no DB queries, no reconciliation. If a field needs computed data, compute it before the model gets to the resource (in a service) or expose it as a model accessor.
- **Unmapped relations are dropped.** If a relation is loaded on the model but not declared in the schema, it doesn't appear in the output. Add the field explicitly — silent dropping is the default.
- **Empty objects are treated as absent.** A field typed `"object"` with `{}` produces `undefined` (and is therefore omitted). Use `"object?"` if you need an explicit `null` in the payload.
- **Dates produce an envelope, not a string.** Default `"date"` output is `{ iso, format, timestamp, humanTime }` — not a string. If you want just the ISO string, use the builder form covered in [`resources-deep.md`](./resources-deep.md).
- **Nested resources need the relation loaded first.** Pointing at `OrganizationResource` only works if the model has `organization` populated (via `with` on the query or a `@BelongsTo` getter that's been resolved). Resources don't lazy-load.

## See also

- **[`resources-deep.md`](./resources-deep.md)** — field builders for fluent typing, the `transform`/`boot`/`extend` hooks, `arrayOf` for structured array items, lazy circular references, conditional fields with `.when(...)`, custom date formats.
- **[Repositories](./05-repositories.md)** — where the data comes from before it reaches the resource.
- **[Events and hooks](../../cascade/architecture-concepts/events-and-hooks.md)** — Cascade model lifecycle, including `fetched` events where you might enrich data before serialization.

## Next

Continue to **[`digging-deeper/`](../digging-deeper/mail.md)** for the deep dives on individual subsystems, or jump to the **[`recipes/`](../recipes/add-a-crud-module.md)** if you'd rather see end-to-end patterns.
