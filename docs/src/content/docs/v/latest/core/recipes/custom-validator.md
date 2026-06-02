---
title: "Custom validator"
description: Add your own seal validation rule — author a `SchemaRule`, register it as a plugin that hangs off `StringValidator.prototype` (or any other), call it with `v.string().myRule(...)` everywhere, and layer async DB or remote-API checks on top.
sidebar:
  order: 4
  label: "Custom validator"
---

Every project ends up with one or two domain-specific validation rules that aren't worth pulling a library for: a slug must be URL-safe, a phone number must validate against a remote service, a coupon code must exist in a cache. Warlock validates with `@warlock.js/seal`, and seal ships a plugin system so you can extend the `v` builder with your own methods. This recipe walks the full pattern: write the rule, register it as a plugin, type-extend the validator prototype, use it in schemas, and the async/DB variants.

We'll build two validators:

1. **`v.string().urlSafeSlug()`** — synchronous, rejects strings that aren't URL-safe.
2. **`v.string().phoneNumber()`** — asynchronous, calls a remote service to verify.

## Step 1 — The anatomy of a rule

A rule is a plain object that implements seal's `SchemaRule` contract:

```ts
import type { SchemaRule } from "@warlock.js/seal";

const myRule: SchemaRule = {
  name: "myRule",
  defaultErrorMessage: "The :input is invalid",
  async validate(value, context) {
    // return VALID_RULE or invalidRule(this, context)
  },
};
```

The fields:

| Field                 | Required | Purpose                                                                                                                |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`                | yes      | Unique identifier. Used in the translation key (`validation.<name>`) and shown in errors.                              |
| `validate`            | yes      | The check itself. Returns a `RuleResult` — `VALID_RULE` or `invalidRule(this, context)`.                              |
| `defaultErrorMessage` | no       | Falls back when no translation is available. Tokens like `:input` are substituted by the framework's i18n layer.       |
| `errorMessage`        | no       | A non-translatable override. The user can pass one at call site too.                                                   |
| `requiresValue`       | no       | If `true`, the rule skips when the value is `undefined`. Defaults to `false`. Most rules want this `true`.             |
| `sortOrder`           | no       | Order in the rule pipeline. Lower runs first. Defaults to insertion order.                                             |

Helpers from `@warlock.js/seal`:

- **`VALID_RULE`** — the singleton "passed" result. Just return it.
- **`invalidRule(this, context)`** — builds the failure result, runs translations, substitutes tokens. Always return what it returns; don't synthesize the failure object yourself.

## Step 2 — Write the slug rule

Synchronous, pure — just a regex check:

```ts title="src/app/shared/validation/rules/url-safe-slug.rule.ts"
import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validates that a string is a URL-safe slug:
 * - lowercase letters, digits, and single hyphens only
 * - no leading/trailing hyphen
 * - no consecutive hyphens
 *
 * @example
 * v.string().urlSafeSlug();
 */
export const urlSafeSlugRule: SchemaRule = {
  name: "urlSafeSlug",
  requiresValue: true,
  defaultErrorMessage:
    "The :input must contain only lowercase letters, digits, and hyphens",
  validate(value, context) {
    if (typeof value === "string" && SLUG_PATTERN.test(value)) {
      return Promise.resolve(VALID_RULE);
    }

    return Promise.resolve(invalidRule(this, context));
  },
};
```

A few notes:

- **`requiresValue: true`** — the rule only runs when the value is present. Combine with `v.string().optional().urlSafeSlug()` to allow `undefined` but reject `"Bad Slug"`.
- **Sync rules return `Promise.resolve(...)`.** The `validate` signature is `async`, so even pure-sync rules wrap their return.
- **`name`** doubles as the translation key. The framework looks up `validation.urlSafeSlug` first; if missing, falls back to `defaultErrorMessage`.

## Step 3 — Register as a plugin

Rules don't live on the validator prototype by default — they live in your plugin module. Register a `SealPlugin` that hangs the method off `StringValidator.prototype`:

```ts title="src/app/shared/validation/plugins/string-extensions.plugin.ts"
import { StringValidator, type SealPlugin } from "@warlock.js/seal";
import { urlSafeSlugRule } from "../rules/url-safe-slug.rule";

declare module "@warlock.js/seal" {
  interface StringValidator {
    urlSafeSlug(errorMessage?: string): StringValidator;
  }
}

export const stringExtensionsPlugin: SealPlugin = {
  name: "stringExtensions",
  version: "1.0.0",
  description: "Adds urlSafeSlug() and other string helpers",
  install() {
    Object.assign(StringValidator.prototype, {
      urlSafeSlug(this: StringValidator, errorMessage?: string) {
        return this.addRule(urlSafeSlugRule, errorMessage);
      },
    });
  },
};
```

Two things to notice:

1. **`declare module` augments the type.** Without this, TypeScript doesn't know `v.string().urlSafeSlug()` exists. The module augmentation tells the compiler the method is now on `StringValidator`. It's a one-line cost for full type safety.
2. **`addRule(rule, errorMessage)` is the canonical way to chain.** It's a method on every validator. The optional second argument is a custom error message — pass it through so users can override per call site.

## Step 4 — Install the plugin at boot

The plugin only does its job when `install()` runs. Call `registerPlugin` once at app boot — `src/app/main.ts` is the right place because it's auto-loaded on startup:

```ts title="src/app/main.ts"
import { registerPlugin } from "@warlock.js/seal";
import { stringExtensionsPlugin } from "./shared/validation/plugins/string-extensions.plugin";

registerPlugin(stringExtensionsPlugin);
```

If you have multiple plugins, register them all here:

```ts title="src/app/main.ts"
import { registerPlugin } from "@warlock.js/seal";
import { phoneNumberPlugin } from "./shared/validation/plugins/phone-number.plugin";
import { stringExtensionsPlugin } from "./shared/validation/plugins/string-extensions.plugin";

registerPlugin(stringExtensionsPlugin);
registerPlugin(phoneNumberPlugin);
```

`registerPlugin` is idempotent — calling it twice with the same name logs a warning and skips. You can't accidentally register the same plugin from two places.

## Step 5 — Use it in a schema

```ts title="src/app/products/schema/create-product.schema.ts"
import { type Infer, v } from "@warlock.js/seal";

export const createProductSchema = v.object({
  name: v.string().min(2).max(120),
  slug: v.string().urlSafeSlug(),
  price: v.number().min(0),
});

export type CreateProductSchema = Infer<typeof createProductSchema>;
```

A `POST /products` with `{ "slug": "Bad Slug" }` now returns `400` with `errors.slug = "The slug must contain only lowercase letters, digits, and hyphens"`. The controller never runs.

## Step 6 — Translation

The default error message is fine for English-only apps. To localize, add an entry to your translation bundle:

```ts title="src/app/shared/utils/locales.ts"
import { groupedTranslations } from "@mongez/localization";

groupedTranslations("validation", {
  urlSafeSlug: {
    en: "The :input must be a URL-safe slug",
    ar: "يجب أن يكون :input صديقًا لعنوان الويب",
  },
});
```

The framework's seal initialization looks up `validation.<rule.name>` automatically (`@warlock.js/core/src/validation/init.ts`). No extra wiring on your end.

## Step 7 — An async / remote-API validator

The slug rule is synchronous. Real-world validators often need to hit an external service or a cache. Here's a phone-number validator that calls a hypothetical lookup service:

```ts title="src/app/shared/validation/rules/phone-number.rule.ts"
import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { validatePhoneNumber } from "../services/validate-phone-number.service";

export type PhoneNumberRuleOptions = {
  countryCode?: string;
};

/**
 * Validates that a value is a real phone number for the given country.
 * Calls an external lookup service — the response is cached for an hour
 * to avoid hammering the API on hot paths.
 *
 * @example
 * v.string().phoneNumber("EG");
 */
export const phoneNumberRule: SchemaRule<PhoneNumberRuleOptions> = {
  name: "phoneNumber",
  requiresValue: true,
  defaultErrorMessage: "The :input must be a valid phone number",
  async validate(value, context) {
    const { countryCode = "US" } = this.context.options;

    if (typeof value !== "string") {
      return invalidRule(this, context);
    }

    const result = await validatePhoneNumber(value, countryCode);

    return result.valid ? VALID_RULE : invalidRule(this, context);
  },
};
```

Where `validatePhoneNumber` is a service you wrote — it can hit any remote API, with retries, caching, and logging. The rule's job is just to call it and translate the result into seal's pass/fail format.

The plugin:

```ts title="src/app/shared/validation/plugins/phone-number.plugin.ts"
import { type SealPlugin, StringValidator } from "@warlock.js/seal";
import { phoneNumberRule } from "../rules/phone-number.rule";

declare module "@warlock.js/seal" {
  interface StringValidator {
    phoneNumber(countryCode?: string, errorMessage?: string): StringValidator;
  }
}

export const phoneNumberPlugin: SealPlugin = {
  name: "phoneNumber",
  install() {
    Object.assign(StringValidator.prototype, {
      phoneNumber(
        this: StringValidator,
        countryCode: string = "US",
        errorMessage?: string,
      ) {
        return this.addRule(phoneNumberRule, errorMessage, { countryCode });
      },
    });
  },
};
```

Note the third argument to `addRule`: a plain object that becomes `this.context.options` inside the rule's `validate` method. That's how you pass options like `countryCode`, `minLength`, or anything else from the call site into the rule body.

Use it:

```ts title="src/app/users/schema/update-profile.schema.ts"
import { type Infer, v } from "@warlock.js/seal";

export const updateProfileSchema = v.object({
  phone: v.string().phoneNumber("EG"),
});

export type UpdateProfileSchema = Infer<typeof updateProfileSchema>;
```

## Step 8 — DB-aware rules — the `unique` / `exists` shape

Warlock's `unique` and `exists` validators (from `@warlock.js/cascade`) follow the same pattern as the rules above, but they also accept a `query` callback that gets the Cascade query builder so you can scope the check:

```ts
v.string().unique("Product", {
  query: ({ query, allValues }) => {
    query.where("organizationId", allValues.organizationId).where("deleted_at", null);
  },
});
```

To build a DB-aware rule yourself, take the same shape:

```ts title="src/app/coupons/validation/rules/coupon-active.rule.ts"
import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { Coupon } from "app/coupons/models/coupon";

export const couponActiveRule: SchemaRule = {
  name: "couponActive",
  requiresValue: true,
  defaultErrorMessage: "The :input is not an active coupon",
  async validate(value, context) {
    if (typeof value !== "string") {
      return invalidRule(this, context);
    }

    const coupon = await Coupon.first({ code: value, active: true });

    return coupon ? VALID_RULE : invalidRule(this, context);
  },
};
```

```ts title="src/app/coupons/validation/plugins/coupon.plugin.ts"
import { type SealPlugin, StringValidator } from "@warlock.js/seal";
import { couponActiveRule } from "../rules/coupon-active.rule";

declare module "@warlock.js/seal" {
  interface StringValidator {
    couponActive(errorMessage?: string): StringValidator;
  }
}

export const couponPlugin: SealPlugin = {
  name: "coupon",
  install() {
    Object.assign(StringValidator.prototype, {
      couponActive(this: StringValidator, errorMessage?: string) {
        return this.addRule(couponActiveRule, errorMessage);
      },
    });
  },
};
```

Now `v.string().couponActive()` runs the database lookup as part of validation.

## Step 9 — One-shot custom rules with `.refine`

If a rule is only used in one place and doesn't deserve a plugin, use seal's built-in `.refine` callback:

```ts
const checkoutSchema = v.object({
  totalCents: v.number().refine((value) => {
    if (value < 100) {
      return "Order total must be at least $1.00";
    }
  }),
});
```

`.refine` returns `undefined` for "passed" and a string error message for "failed." It's a one-method-call shortcut for the case where you don't need to share the rule across schemas. Use it when the logic is local and won't grow; reach for the plugin pattern the moment you find yourself copy-pasting.

## Where to file the files

The conventions:

```
src/app/shared/validation/
  rules/
    url-safe-slug.rule.ts        ← the SchemaRule export
    phone-number.rule.ts
  plugins/
    string-extensions.plugin.ts  ← registers method(s) on validator prototype
    phone-number.plugin.ts
```

Domain-specific rules (`couponActive`) live in the module that owns them (`src/app/coupons/validation/`), not in `shared`. Cross-cutting rules (URL slug, phone, postal code) go in `shared/`.

Auto-loaded `main.ts` registers everything at boot:

```ts title="src/app/main.ts"
import { registerPlugin } from "@warlock.js/seal";
import { couponPlugin } from "./coupons/validation/plugins/coupon.plugin";
import { phoneNumberPlugin } from "./shared/validation/plugins/phone-number.plugin";
import { stringExtensionsPlugin } from "./shared/validation/plugins/string-extensions.plugin";

registerPlugin(stringExtensionsPlugin);
registerPlugin(phoneNumberPlugin);
registerPlugin(couponPlugin);
```

## Gotchas

- **`declare module` is not optional.** Without the module augmentation, TypeScript sees `v.string().urlSafeSlug()` as a type error even though it runs fine. Always add the `declare module` block in the plugin file.
- **`Object.assign(Prototype, {...})` mutates the prototype.** Two plugins that both register `urlSafeSlug` will overwrite each other — the second one wins. Pick distinct names.
- **`requiresValue: true` is the right default.** Skip it and your rule runs on `undefined` values too; the typical validation surface assumes "optional fields skip rules they don't apply to."
- **Async rules should be `await`-safe but not slow.** Validation runs on every request — if your phone-number lookup takes 2s, that's the floor for every request. Cache aggressively.
- **Don't throw inside `validate`.** A thrown error propagates as a 500. Always return `invalidRule(this, context)` for validation failures, even for malformed inputs.
- **Plugin registration is global.** `registerPlugin(myPlugin)` mutates the seal singleton. There's no per-request plugin scope.
- **`addRule(rule, errorMessage, options)` order matters.** The error message is the second arg (or `undefined` to use the default); options are the third arg. Easy to swap if you're skimming.

## See also

- [Validation guide](../the-basics/validation.md) — the seal validator surface in full, including DB-aware rules
- ``validate-input` skill` — schema authoring, attaching to controllers, `request.validated()`
- [Add a CRUD module](./add-a-crud-module.md) — the place these schemas usually plug in
