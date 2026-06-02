---
name: validate-input
description: 'Author seal schemas, attach them to controllers via `controller.validation = { schema }`, infer types via `Infer<typeof schema>`, and layer DB-aware (`unique`/`exists`) and file validators on top. Triggers: `v.object`, `v.string`, `v.email`, `Infer`, `controller.validation`, `.unique`, `.exists`, `uniqueExceptCurrentId`, `request.validated`; "validate a request body", "attach a schema to a controller", "DB-aware unique rule", "infer schema types"; typical import `import { v, type Infer } from "@warlock.js/seal"`. Skip: schema authoring foundations — `@warlock.js/seal/seal-basics/SKILL.md`; controller wiring — `@warlock.js/core/create-controller/SKILL.md`; file rules deep-dive — `@warlock.js/core/upload-file/SKILL.md`; competing libs `zod`, `joi`, `yup`, `class-validator`.'
---

# Warlock — validate a request

Validation is a three-file pattern: a seal schema, a `Request<Schema>` type alias, and the controller that attaches the schema via a static property. If validation fails, the framework returns a 400 with an `errors` payload — your handler never runs.

## The shape

```ts title="src/app/products/schema/create-product.schema.ts"
import { v, type Infer } from "@warlock.js/seal";

export const createProductSchema = v.object({
  name: v.string().min(2).max(120),
  price: v.number().min(0),
  sku: v.string().unique("Product"),
});

export type CreateProductSchema = Infer<typeof createProductSchema>;
```

```ts title="src/app/products/controllers/create-product.controller.ts"
import type { Request, RequestHandler } from "@warlock.js/core";
import { type CreateProductSchema, createProductSchema } from "../schema/create-product.schema";
import { createProductService } from "../services/create-product.service";

export const createProductController: RequestHandler<Request<CreateProductSchema>> = async (
  request,
  response,
) => {
  const product = await createProductService(request.validated());

  return response.successCreate({ product });
};

createProductController.validation = {
  schema: createProductSchema,
};
```

Two pieces, always:

1. **Schema file in `schema/`** — exports both the value (`createProductSchema`) and the inferred type (`CreateProductSchema`). One file, one source of truth.
2. **Controller typed as `RequestHandler<Request<TSchema>>`** (or `GuardedRequestHandler<TSchema>` for auth'd routes) — pulls `TSchema` from the schema file and `controller.validation = { schema }` registers it with the framework.

No separate `*.request.ts` alias file. `RequestHandler<Request<TSchema>>` types `request.validated()` directly off the schema's inferred type.

Scaffold with `yarn warlock generate.controller <module>/<action> --with-validation`. If the scaffolder emits a `requests/<action>.request.ts` file, delete it — the inline pattern is the convention.

## The `v.*` factory surface

From `@warlock.js/seal` — **always import from seal directly**. `@warlock.js/core` does not re-export `v`/`Infer`.

| Factory                            | Output type                  | Common chain                                     |
| ---------------------------------- | ---------------------------- | ------------------------------------------------ |
| `v.string(msg?)`                   | `string`                     | `.min(n)`, `.max(n)`, `.length(n)`, `.pattern(re)`, `.email()`, `.url()`, `.oneOf([...])`, `.trim()`, `.lowercase()`, `.uppercase()` |
| `v.email(msg?)`                    | `string`                     | (alias of `v.string().email()`)                  |
| `v.number(msg?)`                   | `number`                     | `.min(n)`, `.max(n)`, `.positive()`              |
| `v.numeric(msg?)`                  | `number` (accepts numeric strings) | same                                        |
| `v.int(msg?)`                      | `number` (integer)           | same                                             |
| `v.float(msg?)`                    | `number`                     | same                                             |
| `v.boolean(msg?)`                  | `boolean`                    | —                                                |
| `v.date(msg?)`                     | `Date`                       | —                                                |
| `v.array(inner, msg?)`             | `T[]`                        | `.minLength(n)`, `.maxLength(n)`                 |
| `v.object(shape, msg?)`            | `{ ... }`                    | —                                                |
| `v.record(value, msg?)`            | `Record<string, T>`          | —                                                |
| `v.tuple([a, b, c], msg?)`         | `[A, B, C]`                  | —                                                |
| `v.union([a, b], msg?)`            | `A | B`                      | —                                                |
| `v.discriminatedUnion(key, [...])` | `A | B` (tagged)             | each branch must be `v.object({ key: v.literal(...) })` |
| `v.enum([...] | EnumObj, msg?)`    | literal union                | —                                                |
| `v.literal(...values)`             | exact literals               | —                                                |
| `v.instanceof(Ctor, msg?)`         | `Ctor` instances             | —                                                |
| `v.lazy(() => schema)`             | recursive/forward refs       | —                                                |
| `v.file(msg?)`                     | `UploadedFile`               | `.image()`, `.accept(exts)`, `.mimeType(types)`, `.minSize(n)`, `.maxSize(n)`, `.minWidth(n)`, `.maxWidth(n)` — see [`upload-file`](../upload-file/SKILL.md) |
| `v.computed(callback)`             | derived value                | —                                                |
| `v.managed(callback)`              | framework-injected value     | —                                                |

Universal modifiers from `BaseValidator`: `.optional()`, `.nullable()`, `.default(value)`, `.catch(value)`. Note: **there is no `v.url(...)`** at factory level — use `v.string().url(...)`.

## Inferring the type

```ts
import { v, type Infer } from "@warlock.js/seal";

const updateProductSchema = v.object({
  name: v.string().min(2).optional(),
  price: v.number().min(0).optional(),
});

// Input type — what the caller may send (optional fields are `?`)
type UpdateProductInput = Infer<typeof updateProductSchema>;
// → { name?: string; price?: number }

// Output type — what comes out after validation (defaults applied)
type UpdateProductOutput = Infer.Output<typeof updateProductSchema>;
```

The bare `Infer<T>` is the input shape (what the client sends). `Infer.Output<T>` is what's available after validation and transformation. For most service signatures, `Infer<typeof schema>` is what you want.

## Database-aware rules

The DB validators come from two plugins: base `unique`/`exists` (registered by `@warlock.js/cascade`) and request-aware `…ExceptCurrentId`/`…ExceptCurrentUser` (registered by `@warlock.js/core`). All four chain onto scalar validators:

```ts
import { v } from "@warlock.js/seal";
import { Product } from "../models/product";
import { Category } from "../../categories/models/category";

export const createProductSchema = v.object({
  // Reject if any Product row has the same SKU
  sku: v.string().unique(Product),

  // Reject if no Category row exists with this id
  category_id: v.string().exists(Category, { column: "id" }),
});

export const updateProductSchema = v.object({
  // Reject if any *other* Product row has the same SKU (skip the current one)
  sku: v.string().uniqueExceptCurrentId(Product),
});
```

The signatures (from `@warlock.js/cascade/src/validation/plugins/database-rules-plugin.ts`):

```ts
.unique(Model: ChildModel | string, options?: {
  column?: string;        // defaults to the field key
  except?: string;        // sibling input key whose value to !=
  query?: ({ query, value, allValues }) => Promise<void>;
  errorMessage?: string;
})

.exists(Model: ChildModel | string, options?: {
  column?: string;
  query?: ({ query, value, allValues }) => Promise<void>;
  errorMessage?: string;
})
```

`uniqueExceptCurrentId` reads `request.input("id")` automatically — designed for `PATCH /resource/:id` endpoints where the current row should be allowed to "match itself."

For an ad-hoc query that the basic options can't express, pass a `query` callback that mutates the query builder before `first()`:

```ts
v.string().unique(Product, {
  column: "sku",
  query: async ({ query, allValues }) => {
    query.where("organization_id", allValues.organization_id);
  },
});
```

## File rules

`v.file()` returns a `FileValidator` (from `@warlock.js/core/src/validation/validators/file-validator.ts`). Chain size, mime, and image rules:

```ts
import { v } from "@warlock.js/seal";

const uploadAvatarSchema = v.object({
  avatar: v
    .file()
    .image()
    .maxSize({ unit: "MB", size: 5 })
    .mimeType(["image/jpeg", "image/png", "image/webp"]),
});
```

Full file chain: `.image()`, `.accept(extensions)`, `.mimeType(types)`, `.pdf()`, `.excel()`, `.word()`, `.minSize(n)`, `.maxSize(n)`, `.minWidth(px)`, `.maxWidth(px)`, `.minHeight(px)`, `.maxHeight(px)`. See [`upload-file`](../upload-file/SKILL.md) for the full upload flow.

## What the framework sends on failure

The framework calls `response.failedSchema(result)` which sends `400` with the shape configured under `validation.response` (defaults shown):

```jsonc
// 400 Bad Request
{
  "errors": [
    { "input": "email", "error": "The email must be a valid email" },
    { "input": "password", "error": "The password must be at least 6 characters" },
  ]
}
```

The key names (`errors`, `input`, `error`) come from `config.get("validation.response")` — change them globally if your wire format differs.

## Scoping what's validated

By default the validator merges `request.body + request.query` (everything but route params) and validates the merged object. To narrow:

```ts
createProductController.validation = {
  schema: createProductSchema,
  validating: ["body"], // skip query string
};
```

Allowed values: `"body"`, `"query"`, `"params"`, `"headers"`. Useful when query-string filters share keys with body fields and you only want body-side rules.

## Ad-hoc validation (outside a controller)

For background jobs, CLI commands, or anywhere outside the HTTP path, call `validateAll` directly (or `v.validate(schema, data)` for a raw seal result):

```ts
import { v } from "@warlock.js/seal";

const result = await v.validate(createProductSchema, untrustedInput);

if (!result.isValid) {
  // result.errors is the same shape the controller pipeline emits
  throw new Error("invalid input: " + JSON.stringify(result.errors));
}

const clean = result.data; // typed via Infer.Output<>
```

`v.validate(schema, data)` returns `{ isValid, data, errors }` — same shape used inside the framework.

## Common patterns

### Login schema

```ts title="src/app/auth/schema/login.schema.ts"
import { v, type Infer } from "@warlock.js/seal";

export const loginSchema = v.object({
  email: v.email(),
  password: v.string(),
});

export type LoginSchema = Infer<typeof loginSchema>;
```

### Optional fields with defaults

```ts
const filterSchema = v.object({
  page: v.int().min(1).default(1),
  limit: v.int().min(1).max(100).default(15),
  status: v.string().oneOf(["active", "archived"]).optional(),
});
```

`Infer<typeof filterSchema>` makes `page`, `limit`, `status` all optional from the caller's view. `Infer.Output<typeof filterSchema>` makes `page` and `limit` required (default applied) but keeps `status` optional.

### Discriminated union

```ts
const emailNotification = v.object({
  type: v.literal("email"),
  to: v.email(),
});

const smsNotification = v.object({
  type: v.literal("sms"),
  phone: v.string(),
});

export const notificationSchema = v.discriminatedUnion("type", [
  emailNotification,
  smsNotification,
]);

type Notification = Infer<typeof notificationSchema>;
// → { type: "email"; to: string } | { type: "sms"; phone: string }
```

### Selective validation per route group

```ts
createProductController.validation = {
  schema: createProductSchema,
};

updateProductController.validation = {
  schema: updateProductSchema,
  validating: ["body"], // params (id) handled by the controller
};
```

## Gotchas

- **`v.url(...)` does not exist on the factory.** Use `v.string().url(...)`. Same goes for any other rule that's not in the table above — check `BaseValidator` / `StringValidator` first.
- **`.optional()` and `.required()` are not symmetric.** `.optional()` brands the field as absent-allowed. `.required()` clears the optional flag *and* replaces any prior required rule — read seal's `BaseValidator` source if you need conditional required.
- **`uniqueExceptCurrentId` reads `request.input("id")`.** It only works inside an HTTP context — useless in CLI/job code.
- **`request.validated()` is empty until the framework runs validation.** If you forgot the `controller.validation = { schema }` line, `validated()` returns `{}` (or the input from `setValidatedData` if you set it manually). Always pair the schema with the assignment.
- **Import `v`/`Infer` from `@warlock.js/seal`.** Core does not re-export them — `@warlock.js/seal` is the canonical and only home.
- **DB rules trigger queries on every validation pass.** For high-throughput endpoints, prefer enforcing uniqueness at the DB layer (`UNIQUE` index) and catch the conflict in the controller.

## See also

- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — how the schema attaches and how `request.validated()` reads.
- [`upload-file/SKILL.md`](../upload-file/SKILL.md) — `v.file()` and how it interacts with multipart uploads.
- [`send-response/SKILL.md`](../send-response/SKILL.md) — the 400 helper used internally by `failedSchema`.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — `Request<Schema>` type-alias convention.
