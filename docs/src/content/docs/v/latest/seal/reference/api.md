---
title: "API reference"
description: Every export from @warlock.js/seal — signature + one example. The thin API surface, grouped by category.
sidebar:
  order: 1
  label: "API"
---

Thin reference. Every exported identifier, grouped by category, with signature and one minimal example. For "how to use this well" guidance, see the [Essentials](../essentials/01-primitives.md) and [Guides](../guides/pick-the-right-primitive.md) sections.

Canonical import:

```ts
import {
  v,
  validate,
  type Infer,
  configureSeal,
  registerPlugin,
  type SealPlugin,
} from "@warlock.js/seal";
```

## Validation entry points

### `v`

The factory object. Every primitive and structural validator comes off `v`.

```ts
const schema = v.object({ email: v.string().email() });
```

Source: `@warlock.js/seal/src/factory/validators.ts`.

### `validate(schema, data, options?)`

```ts
validate<T extends BaseValidator>(
  schema: T,
  data: unknown,
  options?: ValidateOptions,
): Promise<TypedValidationResult<ValidatedOutput<T>>>;

type TypedValidationResult<TData> =
  | { isValid: true; data: TData; errors: ValidationResult["errors"] }
  | { isValid: false; data: undefined; errors: ValidationResult["errors"] };
```

Runs the schema against `data` and returns `{ isValid, data, errors }`. Never throws on bad input. On success `data` is `Infer.Output<T>`; on failure it is `undefined`. A schema typed as bare `BaseValidator`/`ObjectValidator` keeps `data: any`; a typed `v.record(...)` keeps `Record<string, …>`.

```ts
const result = await validate(userSchema, request.body);
if (result.isValid) handle(result.data); // Infer.Output<typeof userSchema>
```

Source: `@warlock.js/seal/src/factory/validate.ts`.

### `ValidateOptions`

```ts
type ValidateOptions = {
  context?: Record<string, any>; // passed through to SchemaContext.rootContext
  translateRule?: TranslateRuleCallback;
  translateAttribute?: TranslateAttributeCallback;
  firstErrorOnly?: boolean;
  // Limits (see `SealConfig`); a value here wins over `configureSeal()` for this call
  maxArrayItems?: number;
  maxRecordKeys?: number;
  maxErrors?: number;
  maxDepth?: number;
};
```

## Primitives (leaf validators)

### `v.string(errorMessage?)`

```ts
v.string(); // type: string
v.string().email();
v.string().url();
v.string().uuid(4);
v.string().min(3).max(50);
```

`url()` accepts every scheme `URL` can parse except the script-capable ones: `javascript:`, `data:`, `vbscript:` and `file:` are refused. Pass `protocols` to accept only the listed schemes (with or without the trailing `:`), which is also how a refused scheme is opted back in:

```ts
v.string().url(); // https://…, mailto:…, myapp://… — not javascript:…
v.string().url({ protocols: ["http", "https"] }); // web links only
v.string().url({ protocols: ["https"] }, "Use an https link");
```

`pattern(regex)` gives the same answer on every call, also for a regex with the `g` or `y` flag (each check starts at index 0).

`urlDecode()` leaves a value with a malformed escape sequence (`%E0%A4%A`) as it was instead of throwing; the other rules then judge the raw value.

### `v.email(emailMessage?, errorMessage?)`

```ts
v.email(); // shortcut for v.string().email()
```

### `v.number(errorMessage?)`

```ts
v.number().min(0).max(100);
```

Only finite numbers pass: `NaN`, `Infinity` and `-Infinity` are refused. The math mutators (`abs()`, `ceil()`, `floor()`, `round()`, `toFixed()`) and `coerce()` convert numbers and numeric strings only; anything else (`"abc"`, `true`, `[7]`, `{}`) reaches the type rule unchanged and fails it.

### `v.int(errorMessage?)`

```ts
v.int().positive(); // rejects 1.5 and negatives
```

### `v.float(errorMessage?)`

```ts
v.float().between(0, 1); // rejects 1 and 0
```

### `v.numeric(errorMessage?)`

```ts
v.numeric().min(0); // accepts "42" and 42
```

### `v.boolean(errorMessage?)`

```ts
v.boolean();
v.boolean().accepted(); // for "on" / "yes" / "1" form values → real boolean
v.boolean().coerce(); // "true"/"1"/1 → true, "false"/"0"/0 → false (query strings)
```

### `v.scalar(errorMessage?)`

```ts
v.scalar(); // type: string | number | boolean
```

### `v.date(errorMessage?)`

```ts
v.date().past();
v.date().defaultNow();
```

### `v.literal(...values)`

```ts
v.literal("admin", "user"); // type: "admin" | "user"
```

### `v.enum(values, errorMessage?)`

```ts
v.enum(["draft", "published"]); // array form
v.enum(StatusEnum); // TS enum object
```

### `v.instanceof(ctor, errorMessage?)`

```ts
v.instanceof(File);
v.instanceof(MyClass);
```

### `v.computed<T>(callback, resultValidator?)`

```ts
v.computed<string>(({ first, last }) => `${first} ${last}`);
```

### `v.managed<T>(callback?, resultValidator?)`

```ts
v.managed<Date>(() => new Date());
v.managed<string>(({ user }) => user.id);
```

### `v.any()`

```ts
v.any(); // type: any
```

Inside an object, `v.any()` values (and unknown keys kept by `.allowUnknown()`) are copied without `__proto__` keys, so a request body cannot set the prototype of the validated output. Data nested more than `maxDepth` levels below the object (256 by default) fails with a `maxDepth` error.

## Structural validators

### `v.object(schema, errorMessage?)`

```ts
v.object({
  email: v.string().email(),
  age: v.int().optional(),
});
```

### `v.array(validator, errorMessage?)`

```ts
v.array(v.string()).minLength(1).maxLength(10);
```

An array without `.maxLength()` (or `.max()`), `.length()` or `.between()` may hold at most `maxArrayItems` items (10,000 by default, see `configureSeal`); a longer one fails with a `maxItems` error before any item is validated. An explicit `.maxLength(n)` replaces the default cap for that schema; `.maxLength(Infinity)` lifts it.

Items are validated 64 at a time. Once `maxErrors` errors are collected (100 by default) no further items are validated, and the list is cut to that length.

### `v.record(valueValidator?, errorMessage?)`

```ts
v.record(v.int()); // type: Record<string, number>
v.record(v.int()).maxKeys(50); // at most 50 keys (JSON Schema: maxProperties)
```

A record without `.maxKeys(n)` may hold at most `maxRecordKeys` keys (10,000 by default); a larger one fails with a `maxKeys` error. `.maxKeys(Infinity)` lifts the cap for that schema. Values are validated in batches under the same `maxErrors` limit as arrays. A `__proto__` key fails with a `forbiddenKey` error.

### `v.tuple(validators, errorMessage?)`

```ts
v.tuple([v.string(), v.int()]); // type: [string, number]
```

### `v.union(validators, errorMessage?)`

```ts
v.union([v.string(), v.int()]); // type: string | number
```

Tries every branch whose type matches, in order; the first that passes wins and its output is returned. When none passes, the closest branch's errors are reported (fewest mismatched literals, then fewest errors, then deepest path) with type `"union"` at their own paths. `errorMessage` replaces them with one error at the union's path.

### `v.discriminatedUnion(key, branches)`

```ts
v.discriminatedUnion("type", [
  v.object({ type: v.literal("a"), x: v.string() }),
  v.object({ type: v.literal("b"), y: v.int() }),
]);
```

### `v.lazy(thunk)`

```ts
v.lazy(() => categorySchema); // for recursive / forward refs
```

## Inference

### `Infer<T>`

```ts
type User = Infer<typeof userSchema>;
```

Alias for `Infer.Input<T>`.

### `Infer.Input<T>`

What the caller is allowed to send (pre-validation). `.optional()`, `.default()`, `.catch()` all mark a key optional here.

### `Infer.Output<T>`

What `result.data` contains (post-validation). `.default()` and `.catch()` guarantee a value, so those keys are required here.

```ts
type In = Infer.Input<typeof schema>;
type Out = Infer.Output<typeof schema>;
```

## Configuration

### `configureSeal(options)`

```ts
configureSeal({
  firstErrorOnly: false,
  translateRule: ({ rule, attributes }) => t(`validation.${rule.name}`, attributes),
});
```

### `getSealConfig()`

```ts
const config = getSealConfig(); // SealConfig
```

### `resetSealConfig()`

```ts
resetSealConfig(); // clear translation hooks + reset firstErrorOnly and the limits to their defaults
```

### `SealConfig`

```ts
type SealConfig = {
  translateRule?: (ruleTranslation: RuleTranslation) => string;
  translateAttribute?: (attributeTranslation: AttributeTranslation) => string;
  firstErrorOnly?: boolean; // default: true
  maxArrayItems?: number; // default: 10000 — arrays without .maxLength(); Infinity lifts it
  maxRecordKeys?: number; // default: 10000 — records without .maxKeys(); Infinity lifts it
  maxErrors?: number; // default: 100 — errors one array or record collects
  maxDepth?: number; // default: 256 — nesting inside an object's output
};
```

The limits bound what one request can cost. Raise them for a schema with `.maxLength(n)` / `.maxKeys(n)`, for one call with the `validate()` options, or for the whole app:

```ts
configureSeal({ maxArrayItems: 50_000, maxErrors: 20 });
```

The limit errors use the rule names `maxItems`, `maxKeys` and `maxDepth`, so they can be translated like any other rule.

Source: `@warlock.js/seal/src/config.ts`.

## Plugin system

### `registerPlugin(plugin)`

```ts
await registerPlugin(slugPlugin);
```

Async. Idempotent — duplicate names warn and skip.

### `unregisterPlugin(name)`

```ts
await unregisterPlugin("slug");
```

Runs the plugin's `uninstall?.()` and removes from the registry.

### `hasPlugin(name)`

```ts
if (hasPlugin("slug")) {
  /* ... */
}
```

### `getInstalledPlugins()`

```ts
const plugins = getInstalledPlugins(); // SealPlugin[]
```

### `SealPlugin`

```ts
type SealPlugin = {
  name: string;
  version?: string;
  description?: string;
  install: (context: PluginContext) => void | Promise<void>;
  uninstall?: () => void | Promise<void>;
};
```

Source: `@warlock.js/seal/src/plugins/plugin-system.ts`.

## Validator classes (for plugin authoring + type narrowing)

These are the underlying classes the factory wraps. You rarely touch them in app code — they're exported for plugin authoring (module augmentation, prototype patching) and for typing slots that accept a specific validator shape.

- `BaseValidator` — root class with `validate`, `toJsonSchema`, chain methods.
- `StringValidator`, `NumberValidator`, `IntValidator`, `FloatValidator`, `NumericValidator`, `BooleanValidator`, `ScalarValidator`, `DateValidator`.
- `LiteralValidator<T>`, `InstanceOfValidator<T>`, `AnyValidator`.
- `ObjectValidator<TSchema>`, `ArrayValidator`, `RecordValidator`, `TupleValidator`.
- `UnionValidator`, `DiscriminatedUnionValidator<K, Branches>`.
- `LazyValidator<T>`.
- `ComputedValidator<TResult>`, `ManagedValidator<TResult>`.

Each lives in its own file under `@warlock.js/seal/src/validators/`.

## Standard Schema

### `schema["~standard"]`

```ts
const result = await schema["~standard"].validate(input);
// → { value } on success, { issues } on failure

const json = schema["~standard"].jsonSchema.input({ target: "openai-strict" });
```

The Standard Schema V1 accessor. See [Bridge Standard Schema guide](../guides/bridge-standard-schema.md).

### `StandardSchemaV1<Input, Output>`

The Standard Schema V1 interface seal implements. Re-exported from `@warlock.js/seal/src/standard-schema/types.ts`.

### `StandardJSONSchemaV1`

Seal's extension of the Standard Schema spec adding JSON Schema accessors.

## JSON Schema

### `schema.toJsonSchema(target?)`

```ts
schema.toJsonSchema("draft-2020-12");
schema.toJsonSchema("draft-07");
schema.toJsonSchema("openapi-3.0");
schema.toJsonSchema("openai-strict");
```

Default target is `"draft-2020-12"`.

### `JsonSchemaTarget`

```ts
type JsonSchemaTarget = "draft-2020-12" | "draft-07" | "openapi-3.0" | "openai-strict";
```

Source: `@warlock.js/seal/src/standard-schema/json-schema.ts`.

## Types

The package exports its type surface from `@warlock.js/seal/src/types/`:

- `Schema` — a `Record<string, BaseValidator>` (the input to `v.object`).
- `SchemaContext` — runtime context passed through validation (siblings, path, configurations).
- `ValidationResult` — `{ isValid, data, errors }`.
- `RuleTranslation`, `AttributeTranslation` — params passed to the translation hooks.
- `Mutator`, `TransformerCallback`, `SimpleTransformerCallback` — data-pipeline shapes.
- `SchemaRule`, `ContextualSchemaRule`, `SchemaRuleOptions` — for custom rule authoring.

Source: `@warlock.js/seal/src/types/index.ts`.

## Related

- [Essentials](../essentials/01-primitives.md) — the daily-use reference.
- [Guides](../guides/pick-the-right-primitive.md) — task-shaped how-tos.
- [Recipes](../recipes/optional-fields.md) — copy-paste patterns.
