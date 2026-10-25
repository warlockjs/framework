---
title: "warlock agents-md"
description: Generate the app-specific section of AGENTS.md from the booted app — modules, a routes summary with unguarded writes flagged, models, the conventions warlock check enforces, the installed skills and the verify commands — between markers, so hand-written content is never touched. warlock dev keeps it fresh.
sidebar:
  order: 13
  label: "warlock agents-md"
---

`AGENTS.md` is the file coding agents read before they touch a project. Most of what belongs in it about _this_ app — which modules exist, which routes they serve, which are public, which skills apply — is already known to the framework. `warlock agents-md` writes those facts for you, from the same booted registries as [`warlock inspect`](./inspect.md), and `warlock dev` keeps them current.

```bash
warlock agents-md            # print the generated section
warlock agents-md --write    # put it into AGENTS.md (created when missing)
warlock agents-md --json     # { file, status, section }
```

| Flag          | Type    | Description                                                                                      |
| ------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `--write, -w` | boolean | Write the section into `AGENTS.md` between its markers. Creates the file when it does not exist. |
| `--json, -j`  | boolean | Print `{ file, status, section }`. `status` is `created`, `updated`, `unchanged` or `printed`.   |

It boots like `warlock inspect`: every connector boots so routes register, none starts, so no database, cache or socket connection opens and no port binds. Boot output goes to stderr.

## What the section contains

- The app name and version, and the installed `@warlock.js/*` versions.
- **Modules** — every folder under `src/app/`, with how many routes and models each one has.
- **Routes** — counts per method, the mutating routes (`POST`, `PUT`, `PATCH`, `DELETE`) that have no auth guard, and a compact `METHOD path [auth] name` list. Past 60 routes the list stops and points at `warlock inspect --json --section routes`.
- **Models** — model name, table and module.
- **Conventions in force** — the rules `warlock check` enforces (`WL9001`–`WL9012`) and the layout every skill assumes.
- **Skills** — every `SKILL.md` the installed packages ship under `node_modules/@warlock.js/<package>/skills/`, with its first sentence. A package that ships one skill as `skills/SKILL.md` is listed too, under the `name` in its front matter (the package name when it has none).
- **Verify a change** — `warlock check --changed --json`, `warlock inspect --json`, `warlock explain <code>`, `warlock trace` and `warlock mcp`.

The output is deterministic — no timestamps, stable ordering — so regenerating an app that did not change produces the same bytes and nothing is written.

## The markers

The generated section lives between two lines:

```md
# My app

Notes I wrote by hand stay exactly as they are.

<!-- warlock:generated:start -->

...generated facts...
<!-- warlock:generated:end -->

More hand-written notes, also untouched.
```

- Only the bytes between the markers are replaced. Everything before the start marker and after the end marker is kept byte for byte, line endings included (a CRLF file stays CRLF).
- A file without markers gets the section appended at the end, after a blank line.
- A missing file is created with just the section.
- Malformed markers — one without the other, a duplicate, or the end before the start — fail with [`WL7501`](./error-codes.md#wl7501) and nothing is written. Fix them by hand.

## Kept fresh by `warlock dev`

`warlock dev` refreshes the section once the server is up and again after a reload that changes routes or modules. Refreshes are debounced, so saving several files in a row writes once. The refresh creates `AGENTS.md` when it is missing and never touches content outside the markers.

Turn it off in `warlock.config.ts`:

```ts title="warlock.config.ts"
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  devServer: {
    agentsMd: false,
  },
});
```

## From code

The pieces are on `@warlock.js/core/tooling`:

```ts
import { inspectApp, renderAgentsMdSection, writeAgentsMd } from "@warlock.js/core/tooling";

const report = await inspectApp({ sections: ["routes", "models", "packages"] });

console.log(renderAgentsMdSection(report)); // the markdown, without markers
const { status } = writeAgentsMd({ report }); // "created" | "updated" | "unchanged"
```

`upsertGeneratedSection(existing, section)` is the pure marker logic, `listInstalledSkills(cwd)` lists the installed skills, and `createAgentsMdRefresher({ collect })` is the debounced refresher `warlock dev` uses.

## See also

- [`warlock inspect`](./inspect.md) — the full report the section is built from.
- [`warlock check`](./check.md) — the verify command the section points agents at.
