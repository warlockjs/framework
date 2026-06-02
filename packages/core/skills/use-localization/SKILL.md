---
name: use-localization
description: 'Multi-locale translations via `groupedTranslations` (declare keys), `t()` / `request.t()` / `request.trans()` (look up), `request.getLocaleCode()` (detect locale from headers/query), `getLocalized` (pick the right value from a localized-array column). Triggers: `groupedTranslations`, `t`, `request.t`, `request.trans`, `request.transFrom`, `request.getLocaleCode`, `request.setLocaleCode`, `getLocalized`; "add a translation key", "resolve a localized error message", "detect request locale", "pick the right per-locale column value"; typical import `import { t, getLocalized } from "@warlock.js/core"`. Skip: resource output — `@warlock.js/core/define-resource/SKILL.md`; module scaffold — `@warlock.js/core/create-module/SKILL.md`; competing libs `i18next`, `react-intl`, raw `@mongez/localization`.'
---

# Warlock — translate keys + pick localized values

Two related but distinct jobs:

1. **Translation keys** — string identifiers like `"products.notFound"` mapped to per-locale strings (`en`, `ar`, ...). Used for error messages, response copy, anything that needs to render differently per locale.
2. **Localized columns** — a model column that stores `[{ localeCode: "en", value: "Hello" }, { localeCode: "ar", value: "مرحبا" }]`. Used for content that varies by locale (product names, article titles).

Both pivot on **the request's locale** — auto-detected from headers / query string, defaulting to a config value.

## The shape

```ts
// 1. Declare keys (auto-loaded from src/app/<module>/utils/locales.ts)
import { groupedTranslations } from "@mongez/localization";

groupedTranslations("products", {
  notFound: { en: "Product not found", ar: "المنتج غير موجود" },
  created:  { en: "Product created",  ar: "تم إنشاء المنتج" },
});

// 2. Look up in a controller / service
import { t } from "@warlock.js/core";

throw new ResourceNotFoundError(t("products.notFound"));
// or via the request:
return response.success({ message: request.t("products.created") });

// 3. Pick a value from a localized-array column
import { getLocalized } from "@warlock.js/core";

const name = getLocalized(product.get("name_translations"));
// → reads the current request's locale, returns the matching value
```

## Declaring translations — `groupedTranslations`

Every module owns its translation namespace under `src/app/<module>/utils/locales.ts`. The file is auto-loaded at boot — you don't import it from anywhere; the framework picks it up via the module loader.

```ts title="src/app/products/utils/locales.ts"
import { groupedTranslations } from "@mongez/localization";

groupedTranslations("products", {
  notFound:    { en: "Product not found",      ar: "المنتج غير موجود" },
  outOfStock:  { en: "Product out of stock",   ar: "المنتج غير متوفر" },
  created:     { en: "Product created",         ar: "تم إنشاء المنتج" },
  updated:     { en: "Product updated",         ar: "تم تحديث المنتج" },
  deleted:     { en: "Product deleted",         ar: "تم حذف المنتج" },
});
```

The first arg is the **group name** (matches the module's URL slug by convention). Lookup keys are dot-joined: `products.notFound`, `products.created`. Within a group, every key needs the same locale set — if you ship `en` for `notFound`, ship it for everything else too.

You can also import `groupedTranslations` from `@warlock.js/core` (it's re-exported). Both imports work; the project's seed file uses `@mongez/localization` directly. Either is fine.

### Placeholders

```ts
groupedTranslations("products", {
  outOfStock: {
    en: "Product :name is out of stock (current: :count)",
    ar: "المنتج :name غير متوفر (الكمية: :count)",
  },
});

// Lookup:
t("products.outOfStock", { name: "Pen", count: 0 });
// → "Product Pen is out of stock (current: 0)"
```

Placeholders use the `:name` syntax. The lookup helper substitutes them from the second argument.

## Looking up translations — `t()`, `request.t()`, `request.trans()`

Three calls, same job, slightly different reachability:

```ts
// 1. Top-level helper — works inside or outside a request.
//    Inside a request: uses request's locale.
//    Outside: uses the global default locale.
import { t } from "@warlock.js/core";

t("products.notFound");
t("products.outOfStock", { name: "Pen", count: 0 });

// 2. On the request object — explicit, scoped to that request.
request.t("products.notFound");

// 3. Alias for request.t — same behavior.
request.trans("products.notFound");
```

All three lookups go through `@mongez/localization`'s `trans()` under the hood, with the locale pulled from the request context (or the global default).

### Locale on a specific lookup

```ts
request.transFrom("ar", "products.notFound");
// → "المنتج غير موجود" regardless of request's actual locale
```

Use when you want a value in a specific locale — e.g. sending a notification to a user whose preferred locale differs from the current request's.

## Locale detection — `request.getLocaleCode()`

The framework reads the locale from the incoming request in this order:

1. **`translation-locale-code` header** (first priority).
2. **`locale` header**.
3. **`locale` query string param**.
4. **Default** — `config.key("app.localeCode")` falling back to `"en"`.

```ts
const locale = request.getLocaleCode();
// → "en" | "ar" | whatever the caller asked for
```

Configure the default:

```ts title="src/config/app.ts"
export default {
  localeCode: "en",                       // app-wide default
  // ...
};
```

### Setting the locale programmatically

```ts
request.setLocaleCode("ar");
```

After this, every `request.t(...)` and `getLocalized(...)` in the same request returns Arabic. Useful for user-preference overrides (e.g. "this user has set their language to ar in their profile — switch the request's locale on auth").

## Localized columns — `getLocalized`

When a column stores per-locale values as an array:

```ts
// Schema (Seal):
name_translations: v.array(
  v.object({
    localeCode: v.string(),  // "en", "ar", ...
    value: v.string(),
  })
),

// Stored row (DB):
{
  name_translations: [
    { localeCode: "en", value: "Hello World" },
    { localeCode: "ar", value: "مرحبا" },
  ],
}
```

Pick the right one for the current request:

```ts
import { getLocalized } from "@warlock.js/core";

const name = getLocalized(product.get("name_translations"));
// → "Hello World" if request locale is "en"
// → "مرحبا" if request locale is "ar"
```

### Signature

```ts
getLocalized(
  values: LocalizedObject[],
  localeCode?: string,
  key = "value",
): unknown;
```

- **`values`** — the localized-array column.
- **`localeCode`** *(optional)* — pin to a specific locale. Defaults to the current request's locale (reads via `useRequestStore()`).
- **`key`** *(default `"value"`)* — which property of the matched entry to return. Use a different key if your localized objects store the value under a different name.

```ts
const slug = getLocalized(product.get("slug_translations"), undefined, "value");
const tagline = getLocalized(product.get("name_translations"), "fr");  // force French
```

### Use inside a resource for clean per-locale responses

```ts title="src/app/products/resources/product.resource.ts"
import { defineResource, getLocalized } from "@warlock.js/core";

export const ProductResource = defineResource({
  schema: {
    id: "string",
    name: function (_value, resource) {
      return getLocalized(resource.get("name_translations"));
    },
    description: function (_value, resource) {
      return getLocalized(resource.get("description_translations"));
    },
  },
});
```

The `localized` cast (`name: "localized"`) handles the common case directly — reach for a `getLocalized` resolver only when the stored key differs from the output key or you need a fallback.

The wire response always returns the right locale string — no caller-side branching needed.

## Patterns

### Translated error in a service

```ts title="src/app/products/services/get-product.service.ts"
import { ResourceNotFoundError, t } from "@warlock.js/core";
import { productsRepository } from "../repositories/products.repository";

export async function getProductService(id: string) {
  const product = await productsRepository.find(id);
  if (!product) throw new ResourceNotFoundError(t("products.notFound"));
  return product;
}
```

The error's message is locale-aware — the `inject-request-context` middleware catches the error and the response carries the translated string.

### Translated response message in a controller

```ts
export const createProductController: GuardedRequestHandler<CreateProductSchema> = async (
  request,
  response,
) => {
  const product = await createProductService(request.validated());
  return response.success({
    message: request.t("products.created"),
    product,
  });
};
```

### Per-locale product names with a localized column

```ts
import { v } from "@warlock.js/seal";

export const productSchema = v.object({
  // ...
  name_translations: v.array(
    v.object({
      localeCode: v.string(),
      value: v.string(),
    }),
  ),
  // ...
});

// Create:
await Product.create({
  name_translations: [
    { localeCode: "en", value: "Pen" },
    { localeCode: "ar", value: "قلم" },
  ],
});

// Read (via a resource that uses getLocalized):
// → response includes "name": "Pen" for en, "قلم" for ar
```

### Caller overrides locale via query string

```bash
GET /products/42?locale=ar
```

`request.getLocaleCode()` returns `"ar"` — every `request.t(...)` and resource-output `getLocalized` returns Arabic. No app code changes required.

## Gotchas

- **Locales files are auto-loaded — don't import them.** `src/app/<module>/utils/locales.ts` is picked up by the module loader on boot. Importing it manually causes double-registration warnings.
- **Group names should match module URL slugs.** `groupedTranslations("products", ...)` for the `/products` module. Mismatch breaks the convention but doesn't throw.
- **Every key needs every locale.** If a key is missing for the active locale, the lookup falls back to the key string itself (`"products.notFound"` literally appears in the response). Always ship all locales together when adding a key.
- **`t()` outside a request uses the global default.** `Application.environment === "test"` or background jobs without a request context get the configured `app.localeCode`, not whatever the most recent request used.
- **`getLocalized` returns `undefined` if no entry matches.** Empty `name_translations` arrays, missing-locale arrays, or `undefined` columns all surface as `undefined`. Check at the read site or set a default in the resource: `getLocalized(values) ?? "n/a"`.
- **`request.getLocaleCode()` populates `_locale` on first read.** The second call returns the cached value. Calling `setLocaleCode` after the first read overrides cleanly.
- **The `t()` helper is exported from `@warlock.js/core`.** Don't import `trans` from `@mongez/localization` directly inside controllers/services — `t()` adds request-context awareness on top.
- **Placeholders are case-sensitive.** `:name` does NOT match `:Name`. The translation string must spell the placeholder exactly as you pass it.

## See also

- [`send-response/SKILL.md`](../send-response/SKILL.md) — error helpers that pair with translated messages (`response.notFound({ error: t("...") })`).
- [`define-resource/SKILL.md`](../define-resource/SKILL.md) — using `getLocalized` inside resource output for clean per-locale responses.
- [`create-module/SKILL.md`](../create-module/SKILL.md) — the `utils/locales.ts` file is part of the generated module scaffold.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — `utils/locales.ts` is auto-loaded; the suffix is mandatory.
