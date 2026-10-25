# AGENTS.md

> This file is the single source of truth for instructions given to AI coding
> agents working in this project. Tool-specific files (`CLAUDE.md`,
> `.gemini/GEMINI.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, …)
> are **derived** from this file by
> [agent-kit](https://github.com/hassanzohdy/agent-kit). Edit **this** file, then
> run `npm run skills:sync` (or `npx agent-kit sync`) to regenerate them — never edit
> the derived files directly.

## Project overview

This is a [Warlock.js](https://warlock.js.org) application — a full-stack
TypeScript, Node.js framework: APIs plus server-rendered React pages. The
framework and its companion libraries ship under the `@warlock.js/*` scope
(`core`, `web`, `cascade`, `cache`, `seal`, `auth`, `logger`, `fs`,
`scheduler`, …). API code lives under `src/app/**`, organized one module per
domain noun; pages, layouts and the document root live under `src/web/**` (the
`warlock-js-web` skill covers them).

## Skills come first — read them before anything else

**Before you work out how any package or framework feature works, read the
matching skill.** Skills are the authoritative, maintained source of truth for how
to use this project's packages and conventions. They are short and task-focused.

Whenever you need to know how to use a package (`@warlock.js/*`, `@mongez/*`) or
how to do a task (write a controller, define a model, add a migration, validate
input, cache, schedule a job, …), follow this order **strictly**:

1. **Read the relevant `SKILL.md` first.** Match the package name or the task to a
   skill's `name` / `description` / triggers, load that skill, and follow it.
2. **Only if no skill matches**, fall back to the package's own
   types / source / README under `node_modules/<pkg>`.
3. **The public internet is the last resort, not the first.** Do not web-search
   for how a `@warlock.js/*` or `@mongez/*` API works while a skill for it exists —
   the skill is more current and project-correct than anything online.

**Do not reverse-engineer how a package works by grepping for similar or existing
source files and copying their usage before you have checked the skills.** Existing
code can be outdated, mid-refactor, or simply wrong; the skill is the contract.
The rule is: **skill first, source second, web last.**

## Where skills live

- **Project conventions** — hand-authored skills in this repo's `skills/`
  directory (architecture, code standards, API design, etc. — listed below).
- **Package skills** — how to use each installed `@warlock.js/*` / `@mongez/*`
  package. These are synced from `node_modules` into your agent's skills
  directory on every install (Claude Code → `.claude/skills/`, Cursor →
  `.cursor/skills/`, GitHub Copilot → `.github/skills/`, Codex → `.codex/skills/`,
  and the equivalent directory for other agents).

If a skill you expect is missing, run `npm run skills:sync` (it also runs
automatically on `postinstall`).

## Available project skills (`skills/`)

- **api-design** — HTTP conventions: response envelopes, status codes, pagination,
  typed controllers, resources, and routes.
- **code-standards** — TypeScript style: `interface` (contracts) vs `type` (data),
  access modifiers on every class member, no `any`, single-responsibility files
  with the documented naming suffixes, JSDoc on the public surface.
- **web-code-standards** — `src/web/**` feature boundaries, page/setup ownership, components, hooks, CSS, locales, and accessible browser rendering.
- **data-and-persistence** — modeling, storing, and migrating data with
  `@warlock.js/cascade` (money as integer minor units, migrations, indexes).
- **module-boundaries** — how modules under `src/app/**` relate; one domain noun
  per module; what may import what.
- **security-baseline** — input validation at every boundary via `@warlock.js/seal`
  schemas, authentication, and secrets handling.
- **observability-and-resilience** — structured logging, retries, timeouts, and
  avoiding N+1 work.
- **testing-strategy** — Vitest test pyramid with co-located `*.unit.spec.ts` unit files and `*.test.ts` integration files.
- **git-workflow** — conventional commits, branching, PRs, and CI gates.

## Commands

- `npm run dev` — start the dev server (`warlock dev`)
- `npm run build` — type-check then build for production (`tsc && warlock build`)
- `npm run start` — start the production server (`warlock start`)
- `npm run migrate` / `npm run migrate.fresh` / `npm run migrate.list` — run migrations
- `npm run seed` — run database seeders
- `npm run lint` / `npm run format` / `npm run tsc` — lint and format with the selected toolchain, and type-check (`tsc --noEmit`)
- `npx warlock check` — verify a change: typecheck, lint, the affected tests and the framework's conventions in one report (`--changed` for only what changed); run it after every change and loop until it exits 0
- `npm run skills:sync` — re-sync skills from `node_modules` and regenerate the
  derived per-agent files from this `AGENTS.md`

## Code style

Follow the `code-standards` skill for all
TypeScript — read it before writing or reviewing any `.ts` / `.tsx`. In short:
`interface` for contracts and `type` for data shapes, no `any`, access modifiers
on every class member, single-responsibility files with the documented naming
suffixes, and JSDoc on the public surface. The bar is senior-level clean code, not
"it compiles."

## Boundaries

- Respect **module-boundaries** — do not reach across module internals.
- Never weaken the **security-baseline** — always validate input at boundaries.
- `npx warlock check` enforces these rules whichever linter the project uses:
  pass `request.validated()` (never `request.all()`) to queries and services
  (`WL9005`), give every POST/PUT/PATCH/DELETE route auth middleware or an
  explicit `public: true` (`WL9006`), wrap request-supplied redirect targets in
  `safeRedirect()` (`WL9007`), keep raw emails, tokens and request bodies out of
  logs (`WL9008`) and bound regexes that run on request input (`WL9009`). Each
  problem carries its fix; `npx warlock explain <CODE>` prints it again.
- Follow **git-workflow** for commits and branches; do not commit or push unless
  explicitly asked.
- When you are unsure how a package or feature works, **stop and read its skill**
  rather than guessing from other files or the web.

## Schema & model conventions (read before writing a model or schema)

Three things that trip everyone up on a fresh app:

- **Seal fields are REQUIRED by default.** `v.string()` is already required —
  omitting `.required()` does NOT make a field optional. Use `.optional()` to
  make one optional. `.required()` still exists (it lets you set a custom "this
  field is required" message), but it is redundant on a plain field, so the
  generated code and these docs don't use it.
- **Declare server-set foreign keys on the MODEL schema.** A controller that
  sets a column the client doesn't send (e.g. `authorId: request.locals.user.id`) must
  still have that column declared on the model's seal schema
  (`authorId: v.number()`), or `Model.create()` rejects it as an unknown key.
  The client-facing request schema and the model schema are separate, so this
  does not let a client send the FK.
- **Read model data with `get()` / `toJSON()`, never `model.field`.** A model
  instance does not expose its columns as direct properties — `post.title` is
  `undefined` at runtime and a type error. Use `post.get("title")`, or
  `post.toJSON()` in a page loader (resources are the serialization gate).

## This app (generated)

`warlock dev` rewrites everything between the two markers below from the
running app — modules, routes, models, installed skills and the commands to
verify a change. Edit outside the markers; turn it off with
`devServer.agentsMd: false` in `warlock.config.ts`.

<!-- warlock:generated:start -->

Run `npx warlock dev` (or `npx warlock agents-md --write`) to fill this section.

<!-- warlock:generated:end -->
