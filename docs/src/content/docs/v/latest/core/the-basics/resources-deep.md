---
title: "Resources deep dive"
description: Everything on Resource — the field builder fluent API, custom date formats, conditional fields, the boot/extend/transform hooks, arrayOf, lazy circular references, and the output-only rule.
sidebar:
  order: 9
  label: "Resources deep dive"
---

The [resources page](./06-resources.md) covers the field types, the nested-resource pattern, and the model wiring. This page covers what's left — the field builder for fluent configuration, custom date envelopes, conditional fields, the boot/extend/transform hooks, structured array items via `arrayOf`, and the lazy reference escape hatch for circular schemas.

Reach for this page when "id, name, price, image" stops being enough — when you want one field formatted as an ISO string and another as a timestamp envelope, a field that only appears for admins, or a self-referencing tree of comments.

## Two ways to define a resource

The shorthand form — `defineResource()` — covers the bulk of cases. The class form — extending `Resource` with the `@RegisterResource()` decorator — exists for the cases that need hooks.

### Shorthand: `defineResource()`

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

The `defineResource()` factory accepts:

```ts
type DefineResourceOptions = {
  schema: ResourceSchema;
  boot?: (resource?: ResourceContract) => void;
  extend?: (resource?: ResourceContract) => void;
  transform?: (data: Record<string, any>, resource: ResourceContract) => Record<string, any>;
};
```

The hooks (`boot`, `extend`, `transform`) are covered below — most resources don't need them.

### Class form: `Resource` subclass with `@RegisterResource()`

```ts title="src/app/products/resources/product.resource.ts"
import { RegisterResource, Resource } from "@warlock.js/core";

@RegisterResource()
export class ProductResource extends Resource {
  public static schema = {
    id: "string",
    name: "string",
    price: "number",
  };

  protected boot() {
    // runs before transformOutput
  }

  protected extend() {
    // runs after transformOutput
  }
}
```

The `@RegisterResource()` decorator normalizes the schema once at definition time (converts string cast types to pre-built `ResourceFieldBuilder` instances). Skip the decorator and you get per-call normalization — slower for big payloads.

Both forms produce the same runtime behaviour. Pick the shorthand unless you need overridable `boot`/`extend` methods.

## The full schema vocabulary

Every value in `schema` is one of these:

| Form                                    | What it does                                                        |
| --------------------------------------- | ------------------------------------------------------------------- |
| `"string"`                              | Cast type — `String(value)`.                                        |
| `"int"`                                 | Cast type — `parseInt(value)`. `undefined` on `NaN`.                |
| `"float"`                               | Cast type — `parseFloat(value)`. `undefined` on `NaN`.              |
| `"number"`                              | Cast type — `Number(value)`. `undefined` on `NaN`.                  |
| `"boolean"`                             | Cast type — `Boolean(value)`.                                       |
| `"date"`                                | Cast type — full date envelope by default (see [Dates](#dates)).     |
| `"localized"`                           | Pick locale value from `[{ localeCode, value }]` array.             |
| `"url"`                                 | `url(value)` — relative path → full URL.                            |
| `"uploadsUrl"`                          | `uploadsUrl(value)` — full URL into uploads bucket.                 |
| `"storageUrl"`                          | `storage.url(value)` — full URL via current storage disk.           |
| `"object"`                              | Pass through if non-empty plain object.                             |
| `"array"`                               | Pass through if array.                                              |
| `"string[]"`                            | Array of `string` — same for any other cast type.                   |
| `"string?"`                             | Nullable — `null`/`undefined` → `null`, never omitted.              |
| `"string[]?"`                           | Nullable array (combo).                                             |
| `["original_field", "string"]`          | Rename — read `original_field`, output the wire key.                |
| `OtherResource`                         | Nested resource — calls `new OtherResource(value).toJSON()`.        |
| `"self"`                                | Recursive self-reference (single value).                            |
| `"self[]"`                              | Recursive self-reference (array).                                   |
| `lazy(() => OtherResource)`             | Lazy resource — for circular import graphs.                         |
| `(value, resource) => any`              | Resolver function — computed/static value.                          |
| `resource.string()` / `.date()` / ...   | Field builder — fluent API for nullable, default, format, condition. |
| `resource.arrayOf({ ... })`             | Structured array — sub-schema per item.                             |

Suffix order matters: `[]` before `?`. `"string[]?"` is valid; `"string?[]"` is not.

## The field builder — fluent API

For anything beyond a plain cast type, use the builder. You get one inside the class form via `this.string()`, `this.date()`, etc., or you can construct one via `new ResourceFieldBuilder("string")` for inline use in the schema object.

```ts
import { RegisterResource, Resource } from "@warlock.js/core";

@RegisterResource()
export class ProductResource extends Resource {
  public static schema = {
    id: "string",
  };

  protected extend() {
    // Build fields dynamically inside extend()
    this.set("name", this.string("title").nullable().transform(this.get("title")));
  }
}
```

The full builder surface:

| Method                       | What it does                                                           |
| ---------------------------- | ---------------------------------------------------------------------- |
| `string(inputKey?)`           | Builder for string cast.                                              |
| `int(inputKey?)`              | Builder for `parseInt` cast.                                          |
| `float(inputKey?)`            | Builder for `parseFloat` cast.                                        |
| `number(inputKey?)`           | Builder for `Number()` cast.                                          |
| `boolean(inputKey?)`          | Builder for `Boolean()` cast.                                         |
| `date(inputKey?)`             | Builder for date envelope.                                            |
| `localized(inputKey?)`        | Builder for localized value.                                          |
| `url(inputKey?)`              | Builder for `url()` cast.                                             |
| `uploadsUrl(inputKey?)`       | Builder for `uploadsUrl()` cast.                                      |
| `arrayOf(schema)`             | Structured-array schema-within-schema.                                |

A builder has these chainable methods:

| Method                  | What it does                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `.nullable()`           | `null`/`undefined` → `null` in output. Otherwise the field is omitted.         |
| `.array()`              | Map the base type over each element. Same effect as `"<type>[]"` suffix.       |
| `.default(value)`       | Fallback when the input is undefined/null and the field isn't nullable.        |
| `.format(format)`       | Date format string (default `"DD-MM-YYYY hh:mm:ss A"`).                        |
| `.dateOptions(options)` | Customise the date envelope (see [Dates](#dates)).                             |
| `.setInputKey(key)`     | Read from a different key than the output name.                                |
| `.when(condition)`      | Conditional — `condition()` returns true → include, false → use default/null.  |

Wrap a builder up in the schema (it's `ResourceFieldConfig`) — `ResourceFieldBuilder` is exported, so you can `new` it directly:

```ts
import { defineResource, ResourceFieldBuilder } from "@warlock.js/core";

export const ProductResource = defineResource({
  schema: {
    id: "string",
    name: new ResourceFieldBuilder("string").setInputKey("title").default("Untitled"),
    bio: new ResourceFieldBuilder("string").nullable(),
    publishedAt: new ResourceFieldBuilder("date").setInputKey("published_at").dateOptions("iso"),
  },
});
```

In practice this style is rare — most cases fit the plain cast types. The fluent API is what you reach for inside class-form `extend()`/`boot()` hooks, where `this.string(...)` is already on the resource instance.

## Dates — three output shapes

A field of type `"date"` produces an **envelope** by default — an object with multiple representations:

```ts
{
  iso: "2026-05-23T10:30:00.000Z",
  format: "23-05-2026 10:30:00 AM",
  timestamp: 1748000000000,
  humanTime: "2 hours ago",
}
```

The envelope is what consumers usually want — every common representation in one go, no client-side date parsing needed.

To pick a single representation, use the builder with `dateOptions`:

```ts
import { ResourceFieldBuilder } from "@warlock.js/core";

new ResourceFieldBuilder("date").setInputKey("published_at").dateOptions("iso");
// → "2026-05-23T10:30:00.000Z"

new ResourceFieldBuilder("date").setInputKey("published_at").dateOptions("timestamp");
// → 1748000000000

new ResourceFieldBuilder("date").setInputKey("published_at").dateOptions("humanTime");
// → "2 hours ago"

new ResourceFieldBuilder("date").setInputKey("published_at").dateOptions("format");
// → "23-05-2026 10:30:00 AM"

new ResourceFieldBuilder("date").setInputKey("published_at").dateOptions("locale");
// → locale-formatted string
```

Or a custom envelope — pick which keys appear:

```ts
new ResourceFieldBuilder("date").setInputKey("published_at").dateOptions({
  iso: true,
  timestamp: true,
  format: false,
  humanTime: false,
});
// → { iso: "...", timestamp: 1748... }
```

Change the format string:

```ts
new ResourceFieldBuilder("date")
  .setInputKey("published_at")
  .format("YYYY-MM-DD")
  .dateOptions("format");
// → "2026-05-23"
```

The framework uses [`dayjs`](https://day.js.org) internally — the format string follows dayjs conventions.

## Localized fields

Cascade stores localized columns as `[{ localeCode, value }]` arrays. The `"localized"` cast type picks the value matching the request's locale:

```ts
defineResource({
  schema: {
    id: "string",
    name: "localized",
    description: "localized",
  },
});
```

The framework reads `request.locale` (set by the locale middleware) and finds the matching entry. With no locale, returns the first entry's value.

For non-array localized values (already a plain string), it passes through unchanged.

## Nested resources — relations

Point a field at another resource class and the framework wraps the value with `new OtherResource(value).toJSON()`:

```ts
import { defineResource } from "@warlock.js/core";
import { UserResource } from "app/users/resources/user.resource";
import { OrganizationResource } from "app/organizations/resources/organization.resource";

export const ProjectResource = defineResource({
  schema: {
    id: "string",
    name: "string",
    organization: OrganizationResource,
    createdBy: UserResource,
  },
});
```

A single value or an array — both work. The framework checks `Array.isArray` and maps if it is. If the relation isn't loaded on the model, the field is omitted.

A real example from the reference codebase — `ChatResource` mixes nested resources, a self-reference, and plain cast types:

```ts title="src/app/chats/resources/chat.resource.ts"
import { defineResource } from "@warlock.js/core";
import { ContactResource } from "app/contacts/resources/contact.resource";
import { OrganizationResource } from "app/organizations/resources/organization.resource";
import { UnitResource } from "app/units/resources/unit.resource";
import { UserResource } from "app/users/resources/user.resource";

export const ChatResource = defineResource({
  schema: {
    id: "string",
    parent_id: "string",
    type: "string",
    channel: "string",
    title: "string",
    unit_id: "string",
    ai_agent_id: "string",
    organization_id: "string",
    contact_id: "string",
    status: "string",
    started_at: "date",
    closed_at: "date",
    handed_off_at: "date",
    staff_id: "string",
    summary: "string",
    handoff_brief: "string",
    unit: UnitResource,
    organization: OrganizationResource,
    staff: UserResource,
    contact: ContactResource,
    parent: "self",
    created_at: "date",
    updated_at: "date",
  },
});
```

The chat's `parent` is another chat — `"self"` says "use this same resource class to render it." Built-in cycle detection (max depth 10, identity tracking) prevents an infinite loop on `A.parent → B, B.parent → A`.

## Lazy circular references

If two resources need to reference each other and the import graph would be circular, wrap the second one in `lazy(...)`:

```ts
import { defineResource } from "@warlock.js/core";
import { lazy } from "@mongez/reinforcements";

export const OrderResource = defineResource({
  schema: {
    id: "string",
    customer: lazy(() => CustomerResource),  // resolved at toJSON() time, not at import time
  },
});

export const CustomerResource = defineResource({
  schema: {
    id: "string",
    orders: lazy(() => OrderResource),
  },
});
```

By the time `toJSON()` runs, both resources are fully loaded — the lazy resolves to the constructor and the rest of the pipeline behaves exactly like a plain nested resource. Use this only when the import graph really is circular; the plain form is preferred everywhere else.

## Resolver functions — computed fields

Any function in the schema is a resolver. It receives `(value, resource)` and returns the value the output should have:

```ts
defineResource({
  schema: {
    id: "string",
    name: "string",
    price: "number",
    priceWithTax: (price, resource) => {
      const taxRate = resource.get("taxRate") ?? 0;
      return price * (1 + taxRate);
    },
    fullAddress: (_value, resource) => {
      const street = resource.get("street");
      const city = resource.get("city");
      return `${street}, ${city}`;
    },
  },
});
```

The function is bound to the resource instance — `this` works too if you prefer that style. `resource.get(key)` reads any field from the input data (model fields, relations, etc.).

**Resolvers are still output-only.** No service calls, no DB queries — same rule as the rest of the resource. Use them for arithmetic, string composition, picking from a list. Anything heavier belongs in a service before the resource sees the model.

## `arrayOf` — structured array items

When you have an array of objects and want each item shaped without making a whole new resource class, use the `arrayOf` helper. The cleanest spelling is the class form, where `this.arrayOf(...)` and the field builders (`this.string()`, `this.int()`, …) are already on the instance:

```ts
import { RegisterResource, Resource } from "@warlock.js/core";

@RegisterResource()
export class OrderResource extends Resource {
  public static schema = {
    id: "string",
    total: "number",
    lineItems: undefined as any,  // set in boot
  };

  protected boot() {
    (this.constructor as typeof Resource).schema.lineItems = this.arrayOf({
      productName: this.string(),
      quantity: this.int(),
      price: this.float(),
    });
  }
}
```

Or wrap it inline — `arrayOf` is just a tagged object (`{ __type: "arrayOf", schema }`), so you can hand-build it with `ResourceFieldBuilder` instances:

```ts
import { defineResource, ResourceFieldBuilder } from "@warlock.js/core";

export const OrderResource = defineResource({
  schema: {
    id: "string",
    total: "number",
    lineItems: {
      __type: "arrayOf",
      schema: {
        productName: new ResourceFieldBuilder("string"),
        quantity: new ResourceFieldBuilder("int"),
        price: new ResourceFieldBuilder("float"),
      },
    },
  },
});
```

:::caution[`arrayOf` sub-schemas: builders only, output key must equal input key]
The top-level `schema` normalizes bare cast strings (`"string"`, `"int"`) into field builders for you, but an `arrayOf` sub-schema is **not** normalized — so:

- **Use `ResourceFieldBuilder` instances** (or `this.string()` / `this.int()` in the class form), never bare cast strings. A bare `"string"` inside `arrayOf` silently produces empty objects — every item comes out `{}`.
- **The output key must match the item's property name.** Renaming inside `arrayOf` does not work: neither a `["sub_total", "float"]` tuple nor a builder with an input key (`this.float("sub_total")`) resolves correctly — both yield `{}` for that field. If you need a renamed/computed field per item, reach for a dedicated nested `Resource` instead, where the full schema vocabulary (including renames) applies.
:::

`arrayOf` shines when the array items have a simple, same-named shape that's used in exactly one place — making a `LineItemResource` for three fields is overkill. For anything that needs renames, nesting, or reuse, prefer a real `OtherResource` pointed at by the field.

## Conditional fields — `.when(...)`

The builder's `.when(predicate)` runs the predicate before transforming the value. If it returns `false`, the field falls through to the default (or `null` if nullable):

```ts
import { defineResource, ResourceFieldBuilder } from "@warlock.js/core";

export const UserResource = defineResource({
  schema: {
    id: "string",
    name: "string",
    email: new ResourceFieldBuilder("string").when(() => isAdminRequest()),
    privateNotes: new ResourceFieldBuilder("string").when(() => isAdminRequest()).default(""),
  },
});
```

`isAdminRequest()` is a function that reads the request store (or however your app checks roles). When it returns `false`, the field is omitted (or set to `""` for the second one because of `.default`).

This is the right home for "admins see this, regular users don't." Don't reach for `.when` to make field A appear when field B has a value — that's a resolver function's job.

## The boot / extend / transform hooks

The class form gives you three hooks:

```ts
@RegisterResource()
export class ProductResource extends Resource {
  public static schema = {
    id: "string",
    name: "string",
    price: "number",
  };

  protected boot() {
    // Runs once before transformOutput.
    // Use for one-time setup — adding to the schema dynamically.
  }

  protected extend() {
    // Runs after transformOutput.
    // Use for "augment the final output" — add fields that depend on the
    // already-transformed data, or remove fields conditionally.
  }
}
```

`defineResource` exposes the same surface plus a `transform` shorthand:

```ts
export const ProductResource = defineResource({
  schema: {
    id: "string",
    price: "number",
  },
  transform: (data, resource) => {
    if (data.price > 100) {
      data.tier = "premium";
    }
  },
});
```

:::caution[`transform` must mutate `data` — its return value is ignored]
The framework runs `transform.call(this, this.data, this)` and discards whatever you return. Mutate the `data` object directly (as above). Returning a fresh object — `return { ...data, tier }` — silently drops your changes.
:::

Inside the hooks you can read the input via `this.get(key)` / `resource.get(key)`, and write to the output via `this.set(key, value)` / `resource.set(key, value)`.

**The output-only rule still applies inside hooks.** No DB queries, no service calls. Hooks exist to reshape data, not to fetch more of it.

## Wiring the resource to the model

A model declares its default resource via a static property:

```ts title="src/app/products/models/product/product.model.ts"
import { Model, RegisterModel } from "@warlock.js/cascade";
import { type Infer, v } from "@warlock.js/seal";
import { ProductResource } from "../../resources/product.resource";

export const productSchema = v.object({
  name: v.string(),
  price: v.number(),
});

export type ProductSchema = Infer<typeof productSchema>;

@RegisterModel()
export class Product extends Model<ProductSchema> {
  public static table = "products";

  public static schema = productSchema;

  public static resource = ProductResource;
}
```

That single line — `public static resource = ProductResource;` — is the wiring. Every time the framework serializes a `Product` (controller return value, JSON.stringify, nested inside another resource), it runs the model's `data` through `ProductResource.toJSON()`.

You almost never call `new ProductResource(product).toJSON()` by hand. The framework does it during response serialization, transparently.

When you do want to apply a resource manually — say, to a plain object that isn't a model — instantiate it directly:

```ts
const wireShape = new ProductResource(plainObject).toJSON();
```

The constructor accepts a `Model`, a `Resource` (re-wraps it), or a plain object.

## The output-only rule

A resource maps fields. That's it.

It does not load relations. It does not call services. It does not run business logic. It does not reconcile state. If you find yourself reaching for a missing column or computing a side-effect, you've picked the wrong layer — that work belongs in a service before the model reaches the resource, or as a typed getter on the model itself.

This rule exists because resources run during JSON serialization, often inside a list of dozens of records. The moment one resource calls a service, the response time goes from "one query plus map" to "N queries plus map," and the bug lives buried inside the wire layer where nobody looks.

Keep them pure. The hooks (`boot`, `extend`, `transform`) are for **shaping** the output — not for fetching more of it.

## Gotchas

- **Empty objects evaluate to absent.** A field typed `"object"` with `{}` produces `undefined` and is omitted. Use `"object?"` if you need an explicit `null`.
- **Empty arrays of nested resources are dropped.** A `posts: PostResource` field with `[]` is omitted. Use a resolver function that returns `[]` if you need an empty array in the output.
- **Dates produce an envelope, not a string, by default.** If the client wants `"2026-05-23T10:30:00Z"`, use `.dateOptions("iso")` on the builder.
- **Self-references have a max depth of 10** plus identity-based cycle detection on `id` / `_id`. Beyond that, the recursion stops and the field is omitted.
- **Renaming with a tuple takes both** — `["full_name", "string"]` means "read from `full_name`, cast as string, output under whatever the schema key is." The schema key is the wire field; the tuple's first element is the model column.
- **The cast types are exhaustive.** No `"json"`, no `"binary"` — use `"object"` or `"string"` and let the value pass through.
- **`@RegisterResource()` is recommended for class-form resources.** Without it, the schema is normalized lazily on first use — slower, especially for huge response lists.
- **Resolver functions get the input value as their first argument.** When a field has no model column to read (a computed field), pass through the resource: `(_value, resource) => resource.get("a") + resource.get("b")`.

## See also

- **[Resources](./06-resources.md)** — the shape, the everyday types, the model wiring.
- **[Repositories deep dive](./repositories-deep.md)** — the data layer that feeds the resource.
- **[Use-cases deep dive](./use-cases-deep.md)** — the business layer whose output the resource shapes.
- **[Events and hooks](../../cascade/architecture-concepts/events-and-hooks.md)** — Cascade model lifecycle (e.g. `fetched` for pre-serialization enrichment in a service).
