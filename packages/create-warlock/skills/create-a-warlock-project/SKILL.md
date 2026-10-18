---
name: create-a-warlock-project
description: "Create a Warlock project with the canonical scaffold, package selection, and project conventions."
---

# create-warlock — scaffold a new project

`create-warlock` builds a fresh Warlock.js project: it copies the `warlock` template, substitutes the project name, wires the chosen database driver into `.env` (or, when you opt out with `--db=none`, removes `src/config/database.ts`), derives `agent-kit` targets into the generated project, then delegates every optional package install to the project's own `warlock add` so dependency versions are never duplicated by the scaffolder.

## The shape

```bash
# Default: choose API-only or full-stack web, then a database unless a DB flag already answered it
npx create-warlock my-app

# Fully headless — one command scaffolds the whole app, no prompts at all
npx create-warlock my-app --yes --db=postgres --features=test,redis --ai=ai-openai

# The one structural fork
npx create-warlock my-web-app --yes --stack=web

# No database at all
npx create-warlock my-api --yes --no-db --features=test

# The full long-form wizard, one prompt at a time
npx create-warlock --interactive
```

The first positional argument is the project name; it also becomes the directory created under the current working directory. If that directory already exists, the command aborts — it never overwrites.

## Three modes

1. **Default (a TTY, no `--yes`, no `--interactive`)** — asks the project name (if not already given), API-only or full-stack web (`--stack`), then a database unless `--db` or `--no-db` already supplied it. The stack is the only choice that changes the generated app's shape.
2. **`--yes` (or no TTY at all — CI, a script, an agent harness)** — fully headless. Every answer comes from a flag or its default; nothing is ever prompted, and stdin is never read.
3. **`--interactive` (alias `--customize`)** — the full long-form wizard: project name, package manager, database driver, features, AI providers, lint/format toolchain, git, JWT — one prompt after another, exactly like earlier `create-warlock` releases.

**Without a terminal, `--yes` is not required.** When stdin is not a TTY — CI, a
script, a container, an agent harness — the scaffolder does not try to prompt,
regardless of which of the three modes was requested. If the flags already
answer everything it needs, it simply scaffolds. Prompting is the fallback,
not the precondition.

Only a question that genuinely cannot be answered stops the run, and in practice
that is just the project name, the one required answer with no default:

```
A project name is required and no terminal is available to ask for one. Pass it as
the first argument or --name=<name>. Non-interactive flags: --yes, --pm=<npm|yarn|pnpm>,
--db=<driver>|--no-db, --features=<list>, --ai=<list>, --lint=<oxc|eslint>, --git|--no-git, --jwt|--no-jwt.
```

## After scaffolding: the decisions summary

Because almost every choice defaults silently, `create-warlock` prints what it
decided right after scaffolding, e.g.:

```
Using npm · database: none · lint: oxc · agent-kit targets: claude
Features: none
  change these — package manager: --pm, database: --db/--no-db, agents: --agents,
  features: --features, ai: --ai, lint: --lint, git: --git/--no-git, jwt: --jwt/--no-jwt — or
  re-run with --interactive for the full wizard.
```

## Flags

| Flag                           | Takes value | Default                                                             | Purpose                                                                                                                |
| ------------------------------ | ----------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `<positional>` / `--name`      | yes         | — (required)                                                        | Project name + target directory.                                                                                       |
| `--stack`                      | yes         | `api`                                                               | `api` or `web` — the structural choice; `web` seeds the `web` feature by default.                                      |
| `--db`                         | yes         | `mongodb`                                                           | Database driver key (`mongodb`, `postgres`, or `none`).                                                                |
| `--no-db`                      | no          | —                                                                   | Opt out of a database — shorthand for `--db=none`.                                                                     |
| `--pm`                         | yes         | inferred (`npm_config_user_agent` / system)                         | Package manager — must be one of `npm` / `yarn` / `pnpm` / `bun`; anything else is rejected before scaffolding starts. |
| `--features`                   | yes (CSV)   | none, or `["web"]` when `--stack=web` and `--features` is not given | Comma-separated optional feature keys. An explicit `--features` always wins over the `--stack` default.                |
| `--lint`                       | yes         | `oxc`                                                               | `oxc` (Oxlint/Oxfmt) or `eslint` (ESLint/Prettier, deprecated); unknown or missing values fail before writes.          |
| `--ai`                         | yes (CSV)   | none                                                                | Comma-separated AI provider keys (auto-pulls `@warlock.js/ai`).                                                        |
| `--agents`                     | yes (CSV)   | `claude`                                                            | Comma-separated `agent-kit` targets — see below.                                                                       |
| `--git` / `--no-git`           | no          | off                                                                 | Initialize a Git repo (`git init` + `main` branch + initial commit).                                                   |
| `--jwt` / `--no-jwt`           | no          | off                                                                 | Generate JWT secrets via the project's `jwt` script.                                                                   |
| `--yes` / `-y`                 | no          | off                                                                 | Fully headless mode.                                                                                                   |
| `--interactive`, `--customize` | no          | off                                                                 | Restore the full long-form wizard.                                                                                     |

With `--pm=pnpm`, the scaffold reads `pnpm --version` and records install-script
approvals (esbuild, and Sharp when the `image` feature is selected) where that
version reads them: `allowBuilds` in `pnpm-workspace.yaml` on pnpm 10.26+, 11
and 12; that file plus `onlyBuiltDependencies` on 10.5–10.25; and, before 10.5,
no workspace file (those versions reject one without `packages:`) but
`pnpm.onlyBuiltDependencies` in `package.json`. An explicit existing denial is
retained. If selected feature dependencies do
not install, JWT generation is skipped and reported rather than retried through
the package manager.

Value flags accept either `--db=postgres` or `--db postgres`. Unknown `--pm` / `--db` / `--features` / `--ai` / `--agents` / `--lint` values fail fast before any write or install.

`--help`/`-h` and `--version`/`-v` short-circuit before anything else — no prompt, filesystem write, or network call, and `--help` wins even over a positional project name. `--version` prints the installed `create-warlock` version. `--help` lists every flag above together with its default.

## `--agents` and agent-kit targets

`--agents` picks which `agent-kit` targets the generated project derives
docs/skills for (written into the scaffolded `package.json`'s `agentKit.targets`
when it differs from the default). The default, `claude`, is a tiny built-in
fallback that always works — even fully offline. Any other target
(`cursor`, `codex`, `kiro`, `copilot`, `antigravity`, `opencode`, `amp`,
`goose`, …) is validated against the list published at
https://mongez.js.org/agent-kit/llms.txt, fetched once and cached locally. If
that fetch fails for an explicitly requested non-default target, the run fails
visibly and names every target it _could_ determine — it never silently
guesses.

## Valid keys

**Database drivers** (`--db`):

| Key        | Default port | Status                                                                   |
| ---------- | ------------ | ------------------------------------------------------------------------ |
| `mongodb`  | 27017        | available                                                                |
| `postgres` | 5432         | available                                                                |
| `mysql`    | 3306         | coming soon (disabled in the wizard)                                     |
| `none`     | —            | opt out — no driver, no driver package, `src/config/database.ts` removed |

**Features** (`--features`): `react`, `react-email`, `mail`, `ses`, `image`, `s3`, `redis`, `scheduler`, `herald`, `socket`, `test`, `access`, `web`, `tailwind`, `shadcn`, `notifications`.

**AI providers / packages** (`--ai`): `ai-openai`, `ai-google`, `ai-anthropic`, `ai-bedrock`, `ai-ollama`, plus the capability packages `ai-tools`, `ai-panoptic`, `ai-workspace`. Any pick auto-pulls the core `@warlock.js/ai` package.

## Interactive selectors

The default flow and Customize both use the same database selector: MongoDB
and PostgreSQL, with MySQL shown as disabled, then **None**. **None** is
`--db=none` / `--no-db`: no driver
feature is added and `src/config/database.ts` is removed. A supplied database
flag skips the default-flow selector.

In Customize's AI multiselect, pressing Enter with no selection skips AI.
**None** is the last option and also skips AI when it is the sole choice.
Selecting **None** alongside a provider or capability is invalid: the wizard
shows a warning and returns to that selector with the non-**None** choices
retained for correction. Noninteractive `--ai` flag semantics are unchanged.

> The scaffolder holds **no dependency versions** for these — the keys map to `warlock add <key>`, whose feature map in `@warlock.js/core` is the single source of truth. A feature that resolves there will install; one that does not is rejected.

## What gets generated

```
my-app/
├─ .env                         # copied from .env.example, name + DB driver/port substituted
├─ .env.example
├─ .gitignore                   # renamed from the template's _.gitignore
├─ package.json                 # "name" set to the project name
├─ tsconfig.json
├─ warlock.config.ts
└─ src/
   ├─ config/                   # app, auth, cache, database, http, log, mail, repository, storage, tests, validation
   └─ app/
      ├─ auth/                  # controllers, schema, services, requests, utils, OTP model + migration
      ├─ users/                 # model, migration, resource, repository, create + list controllers, schema, events, seeds, commands
      ├─ posts/                 # sample module — model, migration, resource, schema, create + update controllers
      ├─ uploads/               # routes.ts mounts core's uploadedFileController; named image variants go in src/config/uploads.ts
      └─ shared/                # router/locale utils, home page, scheduler
```

The template ships a working auth module (login / logout / logout-all / refresh / me / forgot + reset password via OTP), a `users` module, and a sample `posts` module — all using the current framework surface: schemas via `v` from `@warlock.js/seal`, controllers typed with `GuardedRequestHandler` carrying a `.validation = { schema }`, models on `@warlock.js/cascade`, and declarative migrations via `Migration.create`.

## Setup steps the scaffolder runs

1. Copy template → substitute name → wire `DB_DRIVER` / `DB_PORT` into `.env` (or, for `--db=none`, remove `src/config/database.ts`) → record non-default `--agents` targets into `package.json`'s `agentKit.targets`.
2. Install base dependencies (so the `warlock` binary exists).
3. `warlock add <driver> <features...> <ai...> --no-install`, then one batched install. The `<driver>` is omitted for `--db=none`.
4. `git init` (if `--git`).
5. `jwt` script (if `--jwt`) — otherwise `warlock --warm-cache`.
6. Print the decisions summary.

Failures surface the error and halt; there is no rollback. After it finishes, `cd my-app` and run the dev server.

## Gotchas

- **The target directory must not already exist** — the command exits rather than merge into it.
- **`--db=none` / `--no-db` scaffolds without a database** — no driver, no driver package, and `src/config/database.ts` is deleted. The framework's database connector is gated on that file, so the app boots with no database. The `DB_*` lines stay in `.env` (harmless) as a template for adding one back later.
- **`--ai` never takes `ai` itself.** Pick a provider (`ai-openai`, …); the core `@warlock.js/ai` package is pulled in transitively.
- **`mysql` is disabled** in the wizard; passing `--db=mysql` resolves the driver record but the driver is marked coming-soon.
- **Versions are not the scaffolder's job.** If a feature installs the wrong version, the fix is in core's `warlock add` feature map, not here.

## See also

- The `run-app` topic of the `warlock-js-core` skill — `warlock dev` / `build` / `start` once the project exists.
- The `create-module` topic of the `warlock-js-core` skill — generate a new module inside the project.
- The `add-connector` topic of the `warlock-js-core` skill — what `warlock add` wires when a feature pulls a connector.

The project-ready summary wraps the complete feature list to your terminal width.
Terminals narrower than 50 columns get a plain list; piped output uses 80 columns.

## Custom feature groups

`--customize` opens a section menu for optional features. Open a section to edit
its checklist; **Select all** includes the remaining features while preserving
items you explicitly unticked. The category cursor stays on the last edited
section. Section
counts update when returning to the menu, and **Continue** keeps the selection.
Flags preselect their existing feature keys. Both menus and checklists retain
terminal paging. The decisions overview previews up to six feature/AI keys with
a total count; the success screen shows the complete list.

## Choose the linter and formatter

`--lint=oxc` is the default. It also accepts `--lint oxc` and installs exact
`oxlint@1.88.0` and `oxfmt@0.73.0` versions, emits `.oxlintrc.json` and
`.oxfmtrc.json`, and removes the template's ESLint/Prettier configs and dependencies.
Pass `--lint=eslint` to opt in to ESLint/Prettier. The custom wizard prompts for
the same choice; a flag preselects it.

```bash
# Default: Oxlint + Oxfmt, TypeScript 7.0.2
npm create warlock@latest my-app -- --yes

# Explicit opt-in: ESLint + Prettier, TypeScript 6.0.3
npm create warlock@latest my-eslint-app -- --lint=eslint --yes
```

Both choices provide `lint`/`format` and non-mutating `lint:check`/`format:check`
scripts. Oxc projects also configure VS Code format-on-save with the official
`oxc.oxc-vscode` formatter, use `source.fixAll.oxc` for lint fixes and recommend
that extension. The ESLint toolchain retains its Prettier/ESLint editor settings.
Oxc config enables `devServer.healthCheckers: { eslint: false, oxlint: true }` and
leaves TypeScript health checks enabled. Style matches the template's 100-column,
double-quote, semicolon and trailing-comma settings. Import sorting is on in
`.oxfmtrc.json`, kept to one block like the ESLint toolchain's
`@ianvs/prettier-plugin-sort-imports`:

```json
{ "sortImports": { "newlinesBetween": false, "internalPattern": ["app/", "web/", "@shared/"] } }
```

`format` (`npm run format`) orders built-ins, packages, internal aliases,
then relative imports. Neither formatter deletes unused imports. ESLint reports
them through `unused-imports/no-unused-imports`; Oxlint uses `no-unused-vars`.
Scripts in both toolchains call local binaries
(`eslint --fix ./src --max-warnings=0`, `tsc --noEmit`), never `npx`.

## TypeScript 7 in 5.32

Default Oxlint/Oxfmt projects pin `typescript` to `7.0.2`; `tsc` is the native Go compiler.
The template uses `module: "ESNext"`, `moduleResolution: "bundler"`, explicit
Node types, and `paths` relative to its tsconfig, without `baseUrl`.
Existing apps must remove `baseUrl`, rebase alias targets, and replace
`moduleResolution: "node"` / `"node10"` before typechecking.

Explicit `--lint=eslint` projects pin `typescript` to **6.0.3**, the newest version
supported by typescript-eslint. Its parser requires the JavaScript compiler API
removed in TypeScript 7, and its declared peer range is `>=4.8.4 <6.1.0`
([parser package metadata](https://registry.npmjs.org/@typescript-eslint/parser/8.71.2)).
Both modes use the same tsconfig settings above, which are valid in TypeScript 6.
ESLint mode prints a deprecation warning naming removal in 5.34.0 and the Oxc migration command. Both modes install with every supported package manager.

### Prettier import order in ESLint mode

The ESLint scaffold’s `@ianvs/prettier-plugin-sort-imports` uses Babel instead of
the compiler API. Keep these options in `.prettierrc.json`:

```json
{
  "plugins": ["@ianvs/prettier-plugin-sort-imports"],
  "importOrder": ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "^(app|web|@shared)/", "^[.]"],
  "importOrderParserPlugins": ["typescript", "jsx", "decorators"]
}
```

Leave `importOrderTypeScriptVersion` at its default to keep type and value imports
separate. Run `npm run format`, then `npm run lint:check`; formatting preserves
unused imports, and `npm run lint` can apply ESLint’s unused-import fixes.

## Migrate to Oxlint and Oxfmt in 5.33

ESLint + Prettier are deprecated in 5.33.0 and will be removed in **5.34.0**.
New apps should use `--lint=oxc`. To migrate an existing app, install the new
core release and `ts-morph`, then run:

```bash
npx warlock upgrade --from 5.32 --to 5.33.0 --dry-run
npx warlock upgrade --from 5.32 --to 5.33.0
npm install
npm run format
npm run lint:check
npx warlock check
```

Review every reported `file:line`: customized configs are preserved and need
manual translation before removal. The codemod installs the template's Oxlint
and Oxfmt versions and pins TypeScript to 7.0.2. It replaces standard lint/format
scripts, removes legacy dependencies, and deletes only recognized generated
configs. A generated `.prettierignore` becomes `.oxfmtignore`. Existing Oxc
configs are preserved. `--dry-run --json` reports the same planned changes
without writing files.

Explicit deprecated ESLint scaffolds set `devServer.healthCheckers.eslint: true`;
existing apps must set this themselves to retain background ESLint checking.

Oxc formatting scripts explicitly read `.gitignore` and `.oxfmtignore`. Oxfmt
0.73 otherwise defaults to `.prettierignore` (`oxfmt --help`); the explicit
paths make migrated ignore rules effective. The package template format gate
also defaults to Oxfmt; `--lint=eslint` is its deprecated compatibility mode.
