---
title: "Prompt registry"
description: ai.prompts — one process-wide registry of named, versioned systemPrompt(...) builders keyed by name@version, with meta() identity, merge() composition, define / tag / diff / export / import, and a unified deterministic-plus-judge validate(). ai.prompt is now a thin facade over it.
sidebar:
  order: 7
  label: "Prompt registry"
---

`ai.prompts` is the **single, process-wide registry** of named, versioned system prompts. Each entry is a `systemPrompt(...)` builder keyed by `name@version`, so the same name can hold many versions side by side and a call site resolves a prompt by `name`, by `name@version`, or by a pinned tag — never by re-typing the text.

A prompt joins the registry the moment it carries a name: `ai.systemPrompt(input, { name })` (or any `.meta({ name })` rename) **auto-registers** in `ai.prompts`. From there `ai.prompts.get(name)` / `.resolve(name)` reads it back, `systemPrompt().merge(name)` folds it into a new prompt, and `validate(name)` lints it.

> **Migrating from `ai.prompt()`?** The old `ai.prompt(options?)` registry still works but is now a [thin facade](#aiprompt-the-facade) over `ai.prompts`. New code should use `ai.prompts` directly.

## Registering a prompt

The natural path is just to name a `systemPrompt` — naming auto-registers it:

```ts
import { ai } from "@warlock.js/ai";

// Auto-registers as `support@1`.
const support = ai.systemPrompt("You are senior support for {{product}}.", {
  name: "support",
  version: "1",
  required: ["product"],
});

ai.prompts.has("support");        // true
ai.prompts.list();                // ["support"]
ai.prompts.versions("support");   // ["1"]
```

`version` defaults to the next integer for that name when omitted, so a second named build of `support` lands at `support@2`. Registering a `name@version` that already exists throws `InvalidRequestError` — **unless** the content is byte-identical (idempotent re-registration is allowed, a silent overwrite is not).

You can also register an existing builder explicitly, or bulk-register many versions of one name with `define`:

```ts
ai.prompts.register(support);     // explicit; returns the manager for chaining

ai.prompts.define("triage", [
  { version: "1", template: "Classify: {{ticket}}" },
  { version: "2", template: [ai.persona("You are a triage router."), ai.instruction("Classify: {{ticket}}")] },
]);
```

A `define` entry's `template` is a raw string (wrapped into one instruction block) or an explicit ordered block list (used verbatim). Versions register oldest-first in array order.

`ai.prompts.create(input?, meta?)` is a documented alias of `ai.systemPrompt` — it builds a prompt the same way, and a `meta.name` auto-registers it — so prompt authoring reads identically right beside `ai.prompts.get(...)`.

## Resolving — `get`, `resolve`, tags

`get(name, versionOrTag?)` returns the registered `SystemPrompt` builder; `resolve(name, versionOrTag?, placeholders?)` renders it to its final string in one call. With no selector, both pick the **latest** version (highest insertion order — derived from an internal counter, never `Date.now()`, so it's deterministic across same-tick registrations).

```ts
ai.prompts.get("support");                    // latest builder
ai.prompts.get("support", "1");               // a specific version
ai.prompts.get("support@1");                  // inline name@version form

ai.prompts.resolve("support", undefined, { product: "Warlock" });
// "You are senior support for Warlock."
```

Drop a resolved builder straight into an agent — `get` already returns the `systemPrompt` the agent accepts:

```ts
const agent = ai.agent({
  model: openai.model({ name: "gpt-4o" }),
  systemPrompt: ai.prompts.get("support"),
  placeholders: { product: "Warlock" },
});
```

### Pinning a tag

`tag(name, tag, version)` pins a moving label to a fixed version; the tag then resolves through `get` / `resolve` / the inline `name@tag` form. Re-pinning moves it:

```ts
ai.prompts.tag("support", "production", "1");

ai.prompts.resolve("support@production", undefined, { product: "Warlock" });
// renders support@1 — repin to "2" later without touching call sites
```

An unknown name, version, or tag throws `InvalidRequestError` everywhere it's resolved.

## `validate()` — deterministic check + optional judge

`ai.prompts.validate(target, options?)` is the **one** validator. It accepts a registered name (or `name@selector`), a `SystemPromptContract` instance, or a raw prompt string.

It **always** runs the deterministic placeholder check: every `{{key}}` with no inline default that is neither supplied (`options.placeholders`) nor declared (`options.declare`, plus the prompt's own `meta.required`) is listed in `missing`, and `ok` is `true` **iff `missing` is empty**.

```ts
const report = await ai.prompts.validate("support", {
  placeholders: { product: "Warlock" },
});

report.ok;       // true — every required placeholder is accounted for
report.missing;  // []
```

When `options.judge` is a model, it **also** runs a Nova-safe LLM-as-judge quality pass over a clarity / role / output-format rubric. The judge is advisory: it returns a `score` (0–1) and `issues`, **never throws**, and degrades to an `issues` note (leaving `score` undefined) on any failure — so a flaky judge can never flip `ok`.

```ts
const report = await ai.prompts.validate("support", {
  placeholders: { product: "Warlock" },
  judge: openai.model({ name: "gpt-4o-mini" }),
});

report.ok;      // deterministic verdict — unaffected by the judge
report.score;   // 0..1 quality, or undefined if the judge degraded
report.issues;  // advisory findings
```

To skip the model call on a re-validation of the same prompt with the same judge, pass a `judgeCache` (a structural `{ get, set }` — any `@warlock.js/cache` `CacheDriver` satisfies it) on the factory or per call. It's a pure no-op seam, so `@warlock.js/cache` stays an optional peer:

```ts
const prompts = ai.prompts; // or a fresh `prompts({ judgeCache })`
await ai.prompts.validate("support", { judge, judgeCache: myCacheDriver });
```

`systemPrompt().validate(options?)` is the per-builder sugar — exactly `ai.prompts.validate(this, options)`. See [Write system prompts](./write-system-prompts#validate-this-prompt).

## `diff` — compare two versions

`diff(name, from, to)` returns a block-level diff (blocks matched positionally): `added`, `removed`, `changed`, and an `identical` flag — so a prompt change is reviewable in CI before it ships.

```ts
const delta = ai.prompts.diff("support", "1", "2");
delta.identical; // false
delta.changed;   // [{ from: { type, text }, to: { type, text } }, ...]
```

## `export` / `import` — portable snapshots

`export()` serializes the whole registry to a portable JSON snapshot — every name, its versions (flattened to `{ type, text }` blocks), pinned tags, and carried `description` / `required` metadata. `import(snapshot)` rehydrates it (same duplicate / idempotency rule), restoring pinned tags. Use it to seed a worker, ship a prompt pack, or round-trip prompts through version control.

```ts
const snapshot = ai.prompts.export();     // { prompts: [{ name, versions: [...] }, ...] }
freshManager.import(snapshot);            // same names, versions, tags
```

## Isolated registries

`ai.prompts` is the process-wide default — auto-registered named prompts land here. When you need an isolated store (a parallel test suite, a multi-tenant slice), build your own with the `prompts(options?)` factory; it never shares state with the default:

```ts
import { prompts } from "@warlock.js/ai";

const tenantPrompts = prompts({ judgeCache: myCacheDriver });
```

## `ai.prompt` — the facade

`ai.prompt` still exists for the previous registry API, and the options form (`ai.prompt({ prompts: [...] })`) still returns an **isolated** legacy registry with its unchanged methods (`.register()`, `.add()`, `.resolve()`, `.validate()`, `.sync()`, …).

> ⚠ **Breaking change.** `ai.prompt` is now a **thin facade** over `ai.prompts` — the unified `name@version` manager is the single prompt store. Code that relied on `ai.prompt()` returning a brand-new private registry on every bare call should move to `ai.prompts` (the shared store) or construct an explicit isolated registry. The isolated `ai.prompt({ … })` options form is unchanged.

## When to reach for the registry

- Inline `systemPrompt: "..."` is fine for a one-off agent.
- Reach for `ai.prompts` when a prompt is **shared across agents**, **evolves over versions** you keep resolvable, needs **required-key enforcement**, or you want to **lint / grade / diff** prompt changes in CI before they ship.

Pair `validate()` with [`agent.eval`](../best-practices/evaluation-and-datasets) for a two-layer quality gate: lint the prompt text, then measure the resulting behaviour against a dataset.

## Related

- [Write system prompts](./write-system-prompts) — the `SystemPrompt` builder, `.meta()` identity, and registry-aware `.merge()`.
- [Evaluation and datasets](../best-practices/evaluation-and-datasets) — grade the *behaviour* a prompt produces, not just the text.
- [Run agent](./run-agent) — where a resolved prompt is consumed.
</content>
</invoke>
