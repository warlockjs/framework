---
name: warlock-agents-md
description: 'Generate the app-specific section of AGENTS.md from the booted app with `warlock agents-md [--write] [--json]` — modules, a routes summary with unguarded writes flagged, models, the conventions `warlock check` enforces, the installed skills and the verify commands — between `<!-- warlock:generated:start -->` / `<!-- warlock:generated:end -->` markers so hand-written content is never touched; `warlock dev` refreshes it (opt out with `devServer.agentsMd: false`). Triggers: `warlock agents-md`, `AGENTS.md`, `warlock:generated:start`, `renderAgentsMdSection`, `writeAgentsMd`, `upsertGeneratedSection`, `listInstalledSkills`, `createAgentsMdRefresher`, `devServer.agentsMd`, `WL7501`; "give agents the app facts", "keep AGENTS.md up to date", "which skills apply to this app". Skip: the full machine-readable report — the `warlock-inspect` topic; verifying a change — the `warlock-check` topic.'
---

# Warlock — `warlock agents-md`

Write the facts an agent needs about **this** app into `AGENTS.md`, from the booted registries, and keep them current.

```bash
npx warlock agents-md            # print the section
npx warlock agents-md --write    # write it into AGENTS.md (created when missing)
npx warlock agents-md --json     # { file, status, section }
```

It boots like `warlock inspect` (connectors booted, none started — no connection, no port).

## What it writes

Between two marker lines, appended at the end of an existing file without markers:

```md
# Notes written by hand — never touched

<!-- warlock:generated:start -->

## blog 1.2.0 — generated facts

### Modules

| Module | Routes | Models |
...

### Routes

4 route(s): 2 GET, 1 POST, 1 PATCH.
Mutating routes without an auth guard (confirm each is meant to be public): `POST /posts`.
...
<!-- warlock:generated:end -->
```

Sections: app + `@warlock.js/*` versions, modules (`src/app/*`, routes/models per module), routes (counts, unguarded writes, a list capped at 60), models (table, module), conventions in force (`WL9001`–`WL9004` and the layout rules), installed skills (`node_modules/@warlock.js/*/skills/*/SKILL.md`, first sentence each), verify commands. No timestamps: an unchanged app regenerates the same bytes and nothing is written.

## Rules

- Only bytes between the markers change; a CRLF file stays CRLF.
- Malformed markers (one missing, duplicated, end before start) → `WL7501`, nothing written. Fix by hand.
- Put your own notes outside the markers; anything inside is replaced on the next refresh.

## `warlock dev` keeps it fresh

On boot and after reloads that change routes or modules (debounced). Opt out:

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: { agentsMd: false },
});
```

## From code

```ts
import {
  createAgentsMdRefresher,
  inspectApp,
  listInstalledSkills,
  renderAgentsMdSection,
  upsertGeneratedSection,
  writeAgentsMd,
} from "@warlock.js/core/tooling";

const report = await inspectApp({ sections: ["routes", "models", "packages"] });

const section = renderAgentsMdSection(report, { skills: listInstalledSkills(process.cwd()) });
const next = upsertGeneratedSection("# Hand notes\n", section); // pure: returns the new file content

const { status } = writeAgentsMd({ report }); // "created" | "updated" | "unchanged"

const refresher = createAgentsMdRefresher({
  collect: () => inspectApp({ sections: ["routes", "models", "packages"] }),
  debounceMs: 1000,
  onError: (error) => console.warn(error),
});

refresher.schedule(); // debounced
await refresher.flush(); // run now
refresher.dispose();
```

## See also

- The `warlock-inspect` topic — the report the section is built from.
- The `warlock-check` topic — the verify command the section points at.
- The `warlock-conventions` topic — the conventions listed in the section.
