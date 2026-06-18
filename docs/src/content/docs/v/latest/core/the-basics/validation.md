---
title: "Validation"
description: Validation in Warlock — authoring seal schemas, attaching them to controllers, the request-type alias, database-aware validators, and ad-hoc validation.
sidebar:
  order: 7
  label: "Validation"
---

Validation in Warlock is **seal schemas attached to handlers, plus the framework's bridge for HTTP, file, and database-aware rules**. You author a schema once with `v.*`, attach it as a property on the controller, and the framework runs it before the handler is ever called. Failures short-circuit with a 400 carrying an `errors` payload. Successes get parked on the request, ready for `request.validated()`.

This page covers the schema surface, how to wire it to a controller, the request-type alias trick, database-aware rules (`unique`, `exists`), file rules, and how to run a schema ad-hoc when you need to validate outside the request lifecycle.

## Mental model

A schema is a runtime object that knows how to validate a value. seal's `v.*` factory produces validators; you compose them into an `ObjectValidator` and assign it to `controller.validation = { schema }`. At request time the framework:

1. Picks the data segments to validate (body + query by default).
2. Runs the schema. If it succeeds, the **transformed** data lands on `request` and the controller runs.
3. If it fails, the framework returns 400 with `{ errors: [...] }` and the controller never runs.

You read the typed result via `request.validated()` — the schema's `Infer` type drives the return type.

```ts
// 1. schema
export const createPostSchema = v.object({
  title: v.string().min(3).max(100),
  body: v.string(),
  publishedAt: v.date().optional(),
});

// 2. controller
export const createPostController: RequestHandler = async (request, response) => {
  const data = request.validated();   // typed as Infer<typeof createPostSchema>

  // ...
};

createPostController.validation = { schema: createPostSchema };
```

## Authoring a schema

Import `v` and `Infer` from **`@warlock.js/seal`** — that's the only home. `@warlock.js/core` does not re-export them.

```ts title="src/app/products/validation/create-product.schema.ts"
import { v, type Infer } from "@warlock.js/seal";

export const createProductSchema = v.object({
  name: v.string().min(3).max(100),
  price: v.number().min(0),
  category_id: v.string(),
  description: v.string().optional(),
});

export type CreateProductSchema = Infer<typeof createProductSchema>;
```

`Infer<typeof schema>` produces the static type from the runtime validator — one source of truth, zero drift.

### The validator surface

The full toolbox lives in `@warlock.js/seal`. Highlights:

#### Primitives

| Factory                | Inferred type            | Notes                                     |
| ---------------------- | ------------------------ | ----------------------------------------- |
| `v.string(msg?)`       | `string`                 | `.min()`, `.max()`, `.email()`, `.url()`, `.pattern()`, `.uuid()`, `.alpha()`, `.alphanumeric()`, `.trim()` |
| `v.email(msg?)`        | `string`                 | shortcut for `v.string().email()`         |
| `v.number(msg?)`       | `number`                 | `.min()`, `.max()`, `.positive()`, `.negative()` |
| `v.int(msg?)`          | `number`                 | integer-only                              |
| `v.float(msg?)`        | `number`                 | floats                                    |
| `v.numeric(msg?)`      | `number`                 | string-or-number coerced to number        |
| `v.boolean(msg?)`      | `boolean`                | accepts `"true"` / `"false"` / `true` / `false` / `0` / `1` |
| `v.date(msg?)`         | `Date`                   | parses ISO strings                        |
| `v.any()`              | `any`                    | accepts anything                          |

#### Composition

| Factory                                   | Inferred type                            | Notes                                                  |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `v.object({ key: validator })`            | `{ key: T }`                             | nested via more `v.object(...)`                        |
| `v.array(validator)`                      | `T[]`                                    | `.minLength()`, `.maxLength()`, `.length()`            |
| `v.tuple([v.string(), v.number()])`       | `[string, number]`                       | fixed-length, position-specific types                  |
| `v.record(validator)`                     | `Record<string, T>`                      | dynamic keys, consistent value type                    |
| `v.union([v.string(), v.number()])`       | `string \| number`                       | try each in order                                      |
| `v.discriminatedUnion("type", [a, b])`    | `A \| B`                                 | routed by discriminator literal                        |
| `v.enum(["draft", "published"])`          | `"draft" \| "published"`                 | tuple form                                             |
| `v.enum(MyEnum)`                          | `MyEnum[keyof MyEnum]`                   | TS enum object                                         |
| `v.literal("active", "archived")`         | `"active" \| "archived"`                 | narrow to literal union                                |
| `v.instanceof(MyClass)`                   | `MyClass`                                | `value instanceof MyClass`                             |
| `v.lazy(() => schema)`                    | `T`                                      | recursive / forward-referenced schemas                 |

#### Modifiers

Chained on any validator:

```ts
v.string().optional()                              // field may be omitted
v.string().nullable()                              // value may be null
v.string().nullish()                               // optional + nullable
v.string().default("anonymous")                    // default if missing/empty
v.string().required()                              // explicit required (default)
v.string().describe("user's display name")         // metadata for OpenAPI

v.string().requiredIf("plan", "premium")           // required when plan === "premium"
v.string().requiredWith("phone")                   // required if phone is present
v.string().requiredWithout("email")                // required if email is missing
v.string().requiredIfEmptySibling("email")         // required if sibling is empty

v.string().refine((value) => value !== "admin", "Reserved username")    // custom validator
```

`refine` is the escape hatch for project-specific rules — runs your function, you return `true` for valid, `false` (or an error message) for invalid.

#### Composing with `v.email`, `v.password`, etc.

Real schemas read top to bottom like a constraint declaration:

```ts title="src/app/auth/validation/login.schema.ts"
import { v, type Infer } from "@warlock.js/seal";

export const loginSchema = v.object({
  email: v.email(),
  password: v.string(),
});

export type LoginSchema = Infer<typeof loginSchema>;
```

A more realistic schema with several constraint types:

```ts title="src/app/auth/validation/reset-password.schema.ts"
import { v, type Infer } from "@warlock.js/seal";

export const resetPasswordSchema = v.object({
  email: v.string().email(),
  code: v.string(),
  newPassword: v.string().min(8),
});

export type ResetPasswordSchema = Infer<typeof resetPasswordSchema>;
```

And with enums + defaults:

```ts title="src/app/projects/validation/create-project.schema.ts"
import { v, type Infer } from "@warlock.js/seal";
import { Status } from "app/shared/utils/enums";

export const createProjectSchema = v.object({
  name: v.string(),
  description: v.string().optional(),
  status: v.enum(Status).optional().default(Status.ACTIVE),
});

export type CreateProjectSchema = Infer<typeof createProjectSchema>;
```

## Typing the controller

The controller pulls the schema's inferred type and uses `RequestHandler<Request<TSchema>>` directly — no separate `*.request.ts` alias file:

```ts title="src/app/products/controllers/create-product.controller.ts"
import type { Request, RequestHandler } from "@warlock.js/core";
import {
  type CreateProductSchema,
  createProductSchema,
} from "../schema/create-product.schema";

export const createProductController: RequestHandler<Request<CreateProductSchema>> = async (
  request,
  response,
) => {
  const data = request.validated();   // typed as CreateProductSchema
  // ...
};
```

For routes behind `authMiddleware`, swap the annotation to `GuardedRequestHandler<TSchema>` from `app/auth/types/guarded-request.type` — `request.user` becomes typed in the body:

```ts title="src/app/leads/controllers/create-lead.controller.ts"
import { type GuardedRequestHandler } from "app/auth/types/guarded-request.type";
import {
  type CreateLeadSchema,
  createLeadSchema,
} from "../schema/create-lead.schema";

export const createLeadController: GuardedRequestHandler<CreateLeadSchema> = async (
  request,
  response,
) => {
  const data = request.validated();
  // request.user is typed too
};
```

Cross-module shared types like `GuardedRequestHandler` live at `app/auth/types/guarded-request.type.ts`. No module needs a `requests/` folder — type-only files belong in `types/`.

## Attaching to a controller

The wiring is a property on the handler function:

```ts
createProductController.validation = {
  schema: createProductSchema,
};
```

That's it. The framework reads the property when binding the route, runs the schema before the handler, and stores the validated data on the request.

### What gets validated

By default the framework validates the **merged body + query**. Route params (`:id`-style) are excluded — the route only matched because they were present, so re-validating them is redundant.

Override with `validating`:

```ts
createProductController.validation = {
  schema: createProductSchema,
  validating: ["body", "query", "params"],     // include params
};
```

Possible values: `"body"`, `"query"`, `"params"`, `"headers"`.

### The error shape

When validation fails, the framework calls `response.failedSchema(result)` which maps the seal `ValidationResult` to the configured payload shape. The default looks like:

```json
{
  "errors": [
    { "input": "name",  "error": "Name is required" },
    { "input": "price", "error": "Price must be at least 0" }
  ]
}
```

Status code defaults to 400. Both the payload shape and status are configurable via `config.get("validation.response")`:

```ts title="src/config/validation.ts"
const validationConfig = {
  response: {
    errors: "errors",       // key holding the array
    inputKey: "input",      // key for the field name
    inputError: "error",    // key for the message
    status: 400,
  },
};

export default validationConfig;
```

For most apps the defaults are right. Override only if you need to match an external API contract.

### Locale-aware error messages

The framework wires seal's translation hook through `@mongez/localization` automatically. Rule messages come from translation keys like `validation.required`, `validation.min`, etc. Attribute names come from `attributes.<fieldName>`.

In `src/locales/en.ts`:

```ts
export default {
  validation: {
    required: "The :input is required.",
    min: "The :input must be at least :min.",
    email: "The :input must be a valid email address.",
  },
  attributes: {
    email: "Email address",
    password: "Password",
  },
};
```

The `:input` placeholder is replaced with the translated attribute name. Errors come out fully localised per the current request's locale.

## Database-aware validators

Two rules ship in `@warlock.js/cascade` and are auto-registered: `unique` and `exists`. Both take a Cascade model class (or a registered model name string) and run a query against the model's table.

### `unique(model, options?)`

The value must NOT already exist in the table.

```ts
import { v, type Infer } from "@warlock.js/seal";
import { User } from "../models/user";

export const createUserSchema = v.object({
  name: v.string(),
  email: v.email().unique(User),
  password: v.string().strongPassword(),
});

export type CreateUserSchema = Infer<typeof createUserSchema>;
```

`unique` runs `User.query().where("email", value).first()` and fails if a row comes back.

Options:

```ts
v.string().unique(User, {
  column: "username",                     // override which column to check
  except: "id",                           // when updating: exclude row by sibling input value
  query: ({ query, value, allValues }) => {
    // extra scoping: only check within the same organization
    query.where("organization_id", allValues.organization_id);
  },
  errorMessage: "That username is taken",
});
```

### `exists(model, options?)`

Inverse — the value MUST already exist in the table. Common for foreign-key fields:

```ts
import { Category } from "app/categories/models/category";

export const createProductSchema = v.object({
  name: v.string(),
  price: v.number().min(0),
  category_id: v.string().exists(Category, { column: "id" }),
});
```

Same options as `unique` (sans `except`). Use `query` to scope to the current organization, owner, etc.

### Request-aware variants

`@warlock.js/core` ships four variants that pull the "current id" or "current user" from the HTTP request store — useful in update controllers where you need "unique except for the row I'm updating":

```ts
v.email().uniqueExceptCurrentId(User);
// excludes WHERE id = request.input("id")

v.email().uniqueExceptCurrentUser(User);
// excludes WHERE id = request.user.id

v.string().existsExceptCurrentId(Category);
v.string().existsExceptCurrentUser(Organization);
```

These only work inside an HTTP request — they read from the framework's request context. For background jobs or non-HTTP code, use the base `unique` / `exists` with an explicit `query` callback.

## File validators

The framework auto-registers `v.file()` for multipart uploads — see [File uploads](../digging-deeper/file-uploads.md) for the full chain. A taste:

```ts
import { type UploadedFile } from "@warlock.js/core";
import { v } from "@warlock.js/seal";

export const uploadSchema = v.object({
  files: v
    .array(
      v
        .file()
        .mimeType(["image/jpeg", "image/png", "image/webp"])
        .maxSize({ size: 50, unit: "MB" })
        .image()
        .maxWidth(4000)
        .maxHeight(4000),
    )
    .maxLength(5),
});

export type UploadSchema = { files: UploadedFile[] };
```

`v.file().image()` narrows to images, `.maxSize({size, unit})` accepts friendly units. Use `v.array(v.file())` for multi-file fields; `maxLength` caps the count.

## Validating outside a request

When you need to validate data that didn't come from an HTTP request — a CLI argument, a webhook payload you re-fetched, a config file — use `validateAll` or seal's `v.validate` directly:

```ts
import { v } from "@warlock.js/seal";

const result = await v.validate(createProductSchema, data);

if (!result.isValid) {
  for (const issue of result.errors) {
    log.warn("import", "row", `${issue.input}: ${issue.error}`);
  }
  return;
}

const product = result.data;   // typed as Infer<typeof schema>
```

`v.validate(schema, data)` returns `{ isValid, data, errors }`. The framework's request middleware is just a thin wrapper over this — same machinery, different driver.

Each entry in `result.errors` is a `{ type, error, input }` object — `type` is the rule that failed (`"required"`, `"minLength"`, …), `input` is the field name, and `error` is the rendered message:

```ts
const result = await v.validate(loginSchema, { email: "nope" });

result.errors;
// → [{ type: "email", input: "email", error: "The email must be a valid email" }, ...]
```

The HTTP layer's `response.failedSchema(result)` reshapes this into `{ [errors]: [{ [inputKey], [inputError] }] }` using the keys from `config.get("validation.response")` — so the wire payload drops `type` by default. When you validate ad-hoc, you get the richer object straight from seal.

If you want the framework's HTTP-layer behaviour (set validated data on a request, return a 400 on failure), call `validateAll`:

```ts
import { validateAll } from "@warlock.js/core";

await validateAll({ schema: createProductSchema, validating: ["body"] }, request, response);
```

You rarely need to call this manually — the framework does it via the validation middleware. Reach for it only when you're building custom request-handling pipelines.

## Patterns

### Optional fields

```ts
v.object({
  name: v.string(),
  nickname: v.string().optional(),                              // may be missing
  bio: v.string().optional().default(""),                       // missing → ""
  pinnedAt: v.date().nullable(),                                // value can be null
  twitterHandle: v.string().nullish(),                          // both
});
```

### Conditional requirements

```ts
v.object({
  email: v.string().email().requiredIfEmptySibling("phone"),
  phone: v.string().requiredIfEmptySibling("email"),
});
// at least one of email/phone must be present
```

```ts
v.object({
  plan: v.enum(["free", "pro", "enterprise"]),
  billingCycle: v.enum(["monthly", "yearly"]).requiredIf("plan", "pro"),
});
// billingCycle only required when plan === "pro"
```

### Custom rule

```ts
v.object({
  username: v.string().refine(
    (value) => !RESERVED_USERNAMES.includes(value),
    "That username is reserved",
  ),
});
```

### Nested objects

```ts
v.object({
  user: v.object({
    name: v.string(),
    address: v.object({
      street: v.string(),
      city: v.string(),
      country: v.string().length(2),
    }),
  }),
});
```

### Arrays of objects

```ts
v.object({
  items: v.array(
    v.object({
      productId: v.string().exists(Product, { column: "id" }),
      quantity: v.int().min(1),
    }),
  ).minLength(1),
});
```

### Discriminated union — different shapes by `type`

```ts
const emailNotification = v.object({
  type: v.literal("email"),
  to: v.string().email(),
  subject: v.string(),
});

const smsNotification = v.object({
  type: v.literal("sms"),
  to: v.string(),
  body: v.string().max(160),
});

const notificationSchema = v.discriminatedUnion("type", [
  emailNotification,
  smsNotification,
]);

type Notification = Infer<typeof notificationSchema>;
// → { type: "email", to: string, subject: string }
//   | { type: "sms",   to: string, body: string }
```

The framework reads the `type` field and validates against the matching branch.

## Gotchas

- **Schemas live in `schema/` — one file per action, exporting both the value and its inferred type.** No separate `requests/<action>.request.ts` alias file. The controller annotation `RequestHandler<Request<TSchema>>` (or `GuardedRequestHandler<TSchema>`) pulls the type directly off the schema's `Infer<>` output.
- **`request.validated()` returns `{}` if no schema ran.** It's only safe to call when the controller has `.validation = { schema }` attached. Otherwise, use `request.all()` or `request.input()`.
- **By default, schemas validate body + query, not params.** Route params are already validated by the route matcher. If you need to validate them too (e.g. coerce `:id` to a number), add `"params"` to `validating`.
- **`unique` / `exists` need the model registered.** Pass the imported model class (`User`), not its name as a string — string forms work only for models registered via `@RegisterModel()`.
- **`uniqueExceptCurrentUser` / etc. only work inside an HTTP request.** They read `request.user` from the context store. For background jobs, use the base `unique` with an explicit `query` callback.
- **Validation failures are 400 by default, but they short-circuit before the handler runs.** Branching on "did the schema pass?" inside the controller is impossible — the controller only runs if validation succeeded.
- **`Infer<>` follows `.optional()` / `.nullable()`.** `v.string().optional()` infers as `string | undefined`. If a field is `.optional().default("x")`, `Infer` keeps it `string | undefined` at the type level even though the runtime value is always a string. Use `.required().default("x")` if you want the type to drop the `undefined`.

## See also

- **[Controllers](./03-controllers.md)** — where `controller.validation = { schema }` is attached.
- **[HTTP request](./http-request.md)** — `request.validated()` and the input surface.
- **[File uploads](../digging-deeper/file-uploads.md)** — `v.file()` validators and multipart handling.
- **[Middleware](./middleware.md)** — validation as the framework's last middleware step.
