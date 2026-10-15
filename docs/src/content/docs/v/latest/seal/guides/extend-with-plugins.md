---
title: "Extend with plugins"
description: Add custom validator methods — .slug(), .postalCode(), domain-specific formats — via the SealPlugin system and TypeScript module augmentation.
sidebar:
  order: 5
  label: "Extend with plugins"
---

Seal exposes a plugin system so you can add custom validator methods without forking the package. A plugin is an object with `name`, an `install` function, and optional metadata. The install function grafts new methods onto a validator class's prototype.

## When to reach for a plugin

- The method you want **doesn't exist** in built-in seal — check [the primitives reference](../essentials/01-primitives.md) and [API reference](../reference/api.md) first.
- The validation is **stable and reusable** across modules — domain formats (IBAN, postal codes, tax IDs, license plates, internal ID schemes).
- You want the **chainable syntax** — `v.string().slug()` reads better than `v.string().pattern(/.../).addMutator((s) => slugify(s))` at every call site.

**Don't** reach for a plugin when a one-off `.pattern()` would do. The boilerplate (declare module, register on boot) is justified only when you'll call the new method many times.

## The plugin shape

```ts
import type { SealPlugin } from "@warlock.js/seal";

type SealPlugin = {
  name: string;          // unique identifier — duplicates warn and skip install
  version?: string;
  description?: string;
  install: (context: { name: string; version?: string }) => void | Promise<void>;
  uninstall?: () => void | Promise<void>;
};
```

The `install` function is where you add methods. Typically you patch a validator class prototype with `Object.assign`:

```ts
import { StringValidator, type SealPlugin } from "@warlock.js/seal";

export const slugPlugin: SealPlugin = {
  name: "slug",
  version: "1.0.0",
  description: "Adds .slug() — pattern-only slug validation",

  install() {
    Object.assign(StringValidator.prototype, {
      slug(this: StringValidator, errorMessage?: string) {
        return this.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, errorMessage);
      },
    });
  },
};
```

`uninstall` is optional. Provide it when your plugin needs cleanup (hot-reload scenarios, tests). Most production plugins skip it — methods grafted at boot stay for the process lifetime.

## Registering plugins

```ts
import {
  registerPlugin,
  unregisterPlugin,
  hasPlugin,
  getInstalledPlugins,
} from "@warlock.js/seal";

await registerPlugin(slugPlugin);
// Warns and skips if "slug" is already installed; otherwise install() runs.

hasPlugin("slug");           // true
getInstalledPlugins();       // [slugPlugin]

await unregisterPlugin("slug");
// Runs slugPlugin.uninstall?.(); removes from registry.
```

`registerPlugin` is async (the `install` function may be async). Await it during boot so the methods are available before the first request.

The conventional place to register in a Warlock app is a side-effect file loaded by `warlock.config.ts`:

```ts title="src/setup/seal-plugins.ts"
import { registerPlugin } from "@warlock.js/seal";
import { slugPlugin } from "./plugins/slug-plugin";
import { postalCodePlugin } from "./plugins/postal-code-plugin";

export async function setupSealPlugins() {
  await registerPlugin(slugPlugin);
  await registerPlugin(postalCodePlugin);
}
```

Then call `setupSealPlugins()` in a bootstrap connector. Registering at module-top-level scope also works (the registry is idempotent — duplicates warn and skip), but explicit setup is clearer.

## TypeScript — declare the new methods

`Object.assign` on a prototype is invisible to TypeScript. Declare the new methods with module augmentation so call sites compile:

```ts title="src/setup/seal-plugins.types.ts"
import "@warlock.js/seal";

declare module "@warlock.js/seal" {
  interface StringValidator {
    /** Pattern-only slug — `"hello-world"`, not `"Hello World"`. */
    slug(errorMessage?: string): StringValidator;
  }
}
```

Once this file is in your project's `tsconfig.json` `include` (or imported as a side-effect), `v.string().slug()` autocompletes and type-checks everywhere.

**Augment the class, not the factory return.** The factory return widens with `& StandardSchemaV1<...>` (see [Bridge Standard Schema](./bridge-standard-schema.md)). Augmentations on the intersection don't propagate. Patch the class (`StringValidator`), augment the class — the factory return picks up new methods through structural inference.

## A larger example — postal codes per country

```ts
import { StringValidator, type SealPlugin } from "@warlock.js/seal";

const PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(?:-\d{4})?$/,
  DE: /^\d{5}$/,
  UK: /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/i,
  EG: /^\d{5}$/,
};

export const postalCodePlugin: SealPlugin = {
  name: "postal-code",

  install() {
    Object.assign(StringValidator.prototype, {
      postalCode(
        this: StringValidator,
        country: keyof typeof PATTERNS,
        errorMessage?: string,
      ) {
        const pattern = PATTERNS[country];

        if (!pattern) {
          throw new Error(`postalCode: unknown country "${country}"`);
        }

        return this.pattern(pattern, errorMessage ?? `Invalid ${country} postal code`);
      },
    });
  },
};
```

Module augmentation:

```ts
declare module "@warlock.js/seal" {
  interface StringValidator {
    postalCode(
      country: "US" | "DE" | "UK" | "EG",
      errorMessage?: string,
    ): StringValidator;
  }
}
```

Use site:

```ts
const addressSchema = v.object({
  country: v.literal("US", "DE", "UK", "EG"),
  postal: v.string().postalCode("DE"),
});
```

## Patterns beyond `StringValidator`

The same approach works on any validator class. Pick the right prototype:

- `StringValidator` — string methods (`.slug`, `.postalCode`, `.licensePlate`).
- `NumberValidator` / `IntValidator` / `FloatValidator` — number methods.
- `DateValidator` — date methods (e.g. `.businessDayInCountry("US")`).
- `ArrayValidator` / `ObjectValidator` — structural methods (rarer).
- `BaseValidator` — universal methods (rare; usually a sign you actually want a separate factory).

For a method that creates a **new validator** (not chained from an existing one), export a regular function alongside `v` rather than patching the factory. E.g. an `iban()` helper that returns a configured `v.string()`.

## Introspection

```ts
hasPlugin("slug");                 // boolean
getInstalledPlugins();             // SealPlugin[]
```

Use these in startup diagnostics or tests that need to assert a plugin is registered before exercising a dependent method.

## Things to avoid

- **Don't `Object.assign(BaseValidator.prototype, ...)` for type-specific methods.** The method would exist on every validator (`v.boolean().slug()` typechecks but breaks at runtime). Patch the narrowest class that owns the method.
- **Don't forget the module augmentation.** Without it, the new methods exist at runtime but TypeScript rejects every call site.
- **Don't make `install` depend on shared mutable state.** Plugins should be idempotent — installing twice (or registering across hot-reloads) should not break anything.
- **Don't ship a plugin that silently overrides a built-in method.** If you must, `uninstall` should restore the original — but the better path is a different method name.
- **Don't author one plugin per method.** Group related methods (e.g. "country-specific validators") into one plugin so the install/uninstall lifecycle is coherent.

## Related

- [Bridge Standard Schema](./bridge-standard-schema.md) — why you augment the class, not the factory return.
- [API reference](../reference/api.md) — `SealPlugin`, `registerPlugin`, `unregisterPlugin`, `hasPlugin`, `getInstalledPlugins`.
