# 2026-05-23 — Register custom connectors via `warlock.config.ts`

**Status:** not-started
**Started:** —
**Context:**

- `@warlock.js/core/src/warlock-config/types.ts` — `WarlockConfig` shape; needs a `connectors` field.
- `@warlock.js/core/src/connectors/connectors-manager.ts` — singleton constructor hardcodes the 8 built-ins; only `register()` is public.
- `@warlock.js/core/src/cli/cli-commands.manager.ts > loadPreloaders()` — the moment `warlockConfigManager.load()` resolves; the natural place to register user connectors.
- `@warlock.js/core/skills/add-connector/SKILL.md` — currently claims auto-discovery, which is false. Will be corrected to point at this plan once shipped.
- Today's reality: a file at `src/connectors/<name>.ts` is dead code unless the user manually calls `connectorsManager.register(new MyConnector())` somewhere — and there's no canonical place in the project layout for that call.

## Why now

The connector primitive is half-finished: built-ins register via the manager's constructor, but custom connectors have no documented registration site. The docs surface called it out: the `add-connector` skill hallucinated "auto-discovery from `src/connectors/`" because nothing else made sense to a reader, and there was no real path to describe. Closing the gap unblocks honest docs.

## Design

Add a `connectors` field to `WarlockConfig`:

```ts title="@warlock.js/core/src/warlock-config/types.ts"
export type WarlockConfig = {
  // …existing fields
  connectors?: BaseConnector[];
};
```

Register them in `loadPreloaders()` right after `warlockConfigManager.load()`, before any `connectorsManager.startPhase()` call:

```ts
// @warlock.js/core/src/cli/cli-commands.manager.ts > loadPreloaders()
await warlockConfigManager.load();

connectorsManager.register(...(warlockConfigManager.get("connectors") || []));
```

User-facing shape:

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";
import { QueueConnector } from "./src/connectors/queue.connector";
import { SchedulerConnector } from "./src/connectors/scheduler.connector";

export default defineConfig({
  connectors: [new QueueConnector(), new SchedulerConnector()],
});
```

The user constructs the instances at module top-level. The framework registers them with the singleton manager during preload, before the early-phase boot fires.

## Tasks

- [ ] Add `connectors?: BaseConnector[]` to `WarlockConfig` in `warlock-config/types.ts`
- [ ] Export `BaseConnector` from `@warlock.js/core` if it isn't already (verify)
- [ ] Wire `connectorsManager.register(...(warlockConfigManager.get("connectors") || []))` in `loadPreloaders()` after `warlockConfigManager.load()`
- [ ] Verify timing: registration must complete before `connectorsManager.startPhase(ConnectorLifecyclePhase.Early)` runs
- [ ] Update default-configurations to no-op for connectors (no defaults; user-supplied only)
- [ ] Update `@warlock.js/core/skills/add-connector/SKILL.md` — replace the hallucinated "auto-discovery" section with the real `warlock.config.ts` pattern
- [ ] Update `domains/core/docs/guides/bootstrap-and-connectors.md` accordingly
- [ ] Update `domains/core/docs/recipes/custom-connector.md` accordingly
- [ ] Decide what `src/connectors/<name>.ts` means going forward — keep as the recommended file location (just imported by `warlock.config.ts`), or drop the convention entirely
- [ ] Regenerate `llms.txt` + `llms-full.txt`

## Open items

- **HMR behavior on `warlock.config.ts` change.** Today: the dev server reloads the config and re-runs preload hooks for some changes. We need to confirm what happens when a connector instance changes — does the manager re-`register()` (creating duplicates), or do we need a de-dupe / replace path? Likely need a `connectorsManager.registerOrReplace(name, instance)` to handle dev restarts cleanly.
- **File-location convention.** Keep `src/connectors/<name>.ts` as the recommended path (and have the user import-and-pass in `warlock.config.ts`), or drop the folder convention entirely? I lean keep — it's a clear file-system home for the type even without auto-discovery.

## Summary

(Updated on completion.)
