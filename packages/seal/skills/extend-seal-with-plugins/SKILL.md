---
name: extend-seal-with-plugins
description: 'Author a custom seal plugin to add validator methods (`.slug`, `.postalCode`, etc) — `SealPlugin` shape, `registerPlugin` lifecycle, TS prototype augmentation. Triggers: `SealPlugin`, `registerPlugin`, `unregisterPlugin`, `hasPlugin`, `getInstalledPlugins`, `StringValidator`, `NumberValidator`, `DateValidator`, `BaseValidator`, `install`, `uninstall`; "how do I add a custom validator method", "write a seal plugin", "extend v.string with .slug", "module augmentation for seal"; typical import `import { StringValidator, registerPlugin, type SealPlugin } from "@warlock.js/seal"`. Skip: built-in primitives — `@warlock.js/seal/pick-seal-primitive/SKILL.md`; bridge typing — `@warlock.js/seal/bridge-standard-schema/SKILL.md`; competing `zod` `.refine`/`.transform`.'
---

# Extend seal with plugins

Seal exposes a plugin system so you can add validator methods without forking the package. A plugin is an object with `name`, optional `version`/`description`, and an `install` function that runs once when the plugin is registered. The standard pattern is to `Object.assign(StringValidator.prototype, { ... })` to graft new methods onto a validator class.

## When to reach for a plugin

- The validator method you want **does not exist** in built-in seal — check [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md) and its method references first.
- The validation is **stable and reusable** across modules — domain-specific formats (IBAN, postal codes, tax IDs, license plates, internal ID schemes).
- You want the **chainable syntax** — `v.string().slug()` reads better than `v.string().pattern(/.../).addMutator(s => slugify(s))` at every call site.

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

The `install` function is where you add methods. Typically you patch a validator class prototype:

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

`uninstall` is optional. Provide it when your plugin needs to clean up — e.g. removing prototype methods for hot-reload scenarios. Most production plugins skip it; methods grafted at boot stay for the process lifetime.

## Registering plugins

```ts
import { registerPlugin, unregisterPlugin, hasPlugin, getInstalledPlugins } from "@warlock.js/seal";

await registerPlugin(slugPlugin);
// console.warn if "slug" is already installed; otherwise install() runs and the plugin is tracked.

hasPlugin("slug");           // → true
getInstalledPlugins();       // → [slugPlugin]

await unregisterPlugin("slug");
// runs slugPlugin.uninstall?.(); removes from registry.
```

`registerPlugin` is async (the `install` function may be async). Await it during boot so the methods are available before the first request.

**Where to register:** the conventional place in a Warlock app is a side-effect file loaded by `warlock.config.ts` — e.g. `src/setup/seal-plugins.ts`:

```ts title="src/setup/seal-plugins.ts"
import { registerPlugin } from "@warlock.js/seal";
import { slugPlugin } from "./plugins/slug-plugin";
import { postalCodePlugin } from "./plugins/postal-code-plugin";

export async function setupSealPlugins() {
  await registerPlugin(slugPlugin);
  await registerPlugin(postalCodePlugin);
}
```

Then call `setupSealPlugins()` in a bootstrap connector. Registering at top-level module scope works too (it's idempotent — duplicates warn and skip), but explicit setup is clearer.

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

After this file is included in the project's `tsconfig.json` (via `include` or a side-effect import), `v.string().slug()` autocompletes and type-checks everywhere.

**Important.** The augmentation has to declare on the **class** (`StringValidator`), not the factory return type. The factory return widens with `& StandardSchemaV1<...>` (see [`@warlock.js/seal/bridge-standard-schema/SKILL.md`](@warlock.js/seal/bridge-standard-schema/SKILL.md)) — augmentations on the intersection don't propagate. Patch the class, augment the class; the factory return picks up the new methods through structural inference.

## Larger example — postal codes per country

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
      postalCode(this: StringValidator, country: keyof typeof PATTERNS, errorMessage?: string) {
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

```ts
// Module augmentation
declare module "@warlock.js/seal" {
  interface StringValidator {
    postalCode(country: "US" | "DE" | "UK" | "EG", errorMessage?: string): StringValidator;
  }
}

// Use site
const addressSchema = v.object({
  country: v.literal("US", "DE", "UK", "EG"),
  postal: v.string().postalCode("DE"),
});
```

## Patterns beyond `StringValidator`

The same approach works on any validator class. Pick the right prototype:

- `StringValidator` — string methods (`.slug`, `.postalCode`, `.licensePlate`).
- `NumberValidator` / `IntValidator` / `FloatValidator` — number methods.
- `DateValidator` — date methods (`.businessDayInCountry("US")`).
- `ArrayValidator` / `ObjectValidator` — structural methods (rarer).
- `BaseValidator` — universal methods (rare — usually a sign you want a separate `v.something()` factory instead).

For a method that creates a **new validator** (not chained from an existing one), expose it as a regular function alongside `v` rather than patching the factory. E.g. export `iban()` from your plugin module that returns a configured `v.string()`.

## Introspection — checking what's loaded

```ts
hasPlugin("slug");                 // boolean
getInstalledPlugins();             // SealPlugin[]
```

Use these in startup diagnostics or in tests that need to assert a plugin is registered before exercising a method that depends on it.

## Things NOT to do

- Don't `Object.assign(BaseValidator.prototype, ...)` for type-specific methods. The method would exist on every validator (`v.boolean().slug()` typechecks but breaks at runtime). Patch the narrowest class that owns the method.
- Don't forget the module augmentation. Without it, the new methods exist at runtime but TS rejects every call site.
- Don't make the plugin's `install` function depend on shared state mutable from elsewhere. Plugins should be idempotent — installing twice (or registering across hot-reloads) should not break anything.
- Don't ship a plugin that overrides a built-in method without a clear reason. If you must, `uninstall` should restore the original — but the better path is a different method name.
- Don't author one plugin per method. Group related methods (e.g. "country-specific validators") into one plugin so the install/uninstall lifecycle is coherent.
