# Create Warlock

This package is used to generate a [Warlock.js](https://warlock.js.org) project.

## Usage

Run the following command:

```bash
npx create-warlock
```

Or

```bash
yarn create warlock
```

Or

```bash
pnpm create warlock
```

Then follow the instructions, it is easy as that!

### Flags

`create-warlock` is fully headless: every prompt has a flag that answers it,
`--yes` takes the default for anything you leave unset, and it works with no
terminal at all (CI, a script, an agent). With a terminal and neither `--yes` nor `--interactive`, it asks for API-only
or full-stack web, then for a database unless `--db` or `--no-db` already
answered that choice. The stack is the only choice that changes the generated
app's shape. Everything else below is a flag with a default; a summary of what
was decided prints after scaffolding, along with how to change each one.

| Flag                           | Description                                                          | Default                                                                  |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `--name=<name>`                | Project name (or the first positional arg)                           | required — prompted with a TTY, otherwise fails naming this flag         |
| `--stack=<api\|web>`           | API-only or full-stack web; the structural choice                    | `api`                                                                    |
| `--db=<driver>` / `--no-db`    | Database driver (`postgres`, `mongodb`, …), or skip one entirely     | `mongodb`                                                                |
| `--features=<list>`            | Comma-separated feature keys (e.g. `test,herald`)                    | none (or `["web"]` when `--stack=web` and `--features` is not given)     |
| `--lint=<oxc>`                 | Oxlint/Oxfmt (only supported toolchain)                              | `oxc`                                                                    |
| `--ai=<list>`                  | Comma-separated AI provider keys (e.g. `openai,anthropic`)           | none                                                                     |
| `--pm=<manager>`               | Package manager (`npm`, `yarn`, `pnpm`, `bun`)                       | inferred from the invoking agent (`npm_config_user_agent`) or the system |
| `--agents=<list>`              | Comma-separated [agent-kit](https://mongez.js.org/agent-kit) targets | `claude`                                                                 |
| `--git` / `--no-git`           | Force-enable or force-disable git initialization                     | `false`                                                                  |
| `--jwt` / `--no-jwt`           | Force-enable or force-disable JWT secret generation                  | `false`                                                                  |
| `-y`, `--yes`                  | Skip every prompt and take defaults for anything unset               | `false`                                                                  |
| `--interactive`, `--customize` | Restore the full long-form interactive wizard                        | `false`                                                                  |
| `-h`, `--help`                 | Print usage (every flag + its default) and exit                      | —                                                                        |
| `-v`, `--version`              | Print the installed version and exit                                 | —                                                                        |

```bash
create-warlock my-app --db=postgres --features=test,herald --yes
create-warlock --help       # print every flag with its default, no scaffolding runs
create-warlock --version    # print the installed version and exit
create-warlock my-app --interactive   # the full long-form wizard, one prompt at a time
```

`--help` and `--version` exit before any prompt, filesystem write, or network
call — including before a positional project name or any other flag is
honoured.

`--agents` validates against the agent-kit targets published at
[mongez.js.org/agent-kit/llms.txt](https://mongez.js.org/agent-kit/llms.txt)
(cached locally after the first successful lookup); `claude`, the default,
always works offline. An unrecognized target fails the run with the full list
of valid targets rather than silently falling back.

### Interactive database and AI choices

The default interactive flow offers the same database choices as Customize:
MongoDB and PostgreSQL, while MySQL remains shown as disabled, followed by
**None**. Choosing **None** is the same as
`--db=none` / `--no-db`: no database driver is installed and the generated
`src/config/database.ts` is removed. A supplied `--db` or `--no-db` skips this
prompt.

Customize keeps AI optional. Pressing Enter with no AI selections skips it. Its
last option, **None**, does the same when selected alone. **None** cannot be
combined with an AI provider or capability package; the wizard explains the
conflict and asks for the AI choices again, keeping the non-**None** choices
for correction. Headless `--ai` flags keep their existing provider/capability
key behavior.

## Developing this package locally

`bin/create-app.js` imports `../esm/index.mjs` — a build output, not the
TypeScript source under `src/`. There is no `esm/` directory in the checkout,
so **the local bin only works after a build has produced it.** Running
`node bin/create-app.js` (or the linked `create-warlock` bin) against a fresh
checkout fails with a module-not-found error until that build step has run.
During development, use `npm run start` (`tsx ./index.dev.ts`), which runs the
TypeScript source directly and needs no build.

### The manifest is rewritten at publish time — on purpose

`package.json` in this checkout declares:

- `"main"/"module"/"typings": "./src/index.ts"` — pointing at TypeScript
  source, not the compiled `esm/` output the published bin actually imports;
- `"@warlock.js/fs": "*"` — a wildcard, not a real semver range.

Neither is a bug. This package is published in lockstep with the rest of the
`@warlock.js/*` family; the release tooling compiles `src/` to `esm/` and
rewrites both the entry-point fields and every `@warlock.js/*` dependency to
the version being released, as the last step before `npm publish`. Outside
that tooling — i.e. everywhere in this checkout — those fields stay as
source-pointers and wildcards deliberately, so local development never has to
chase a version that has not been cut yet.

**Coverage seam:** the rewrite itself lives in release tooling outside this
package's write fence, so nothing under `specs/` exercises it. `specs/`
proves the CLI's own behavior (flag parsing, `--help`/`--version`,
`createNewApp` wiring); it does not — and cannot, from in here — assert that
the publish step produces a correct `esm/index.mjs` or correctly rewritten
dependency versions. That remains unresolved from this package's fence and
should be verified against a real published (or `--install-links`) install,
not from source.

## CI

`.github/workflows/ci.yml` runs two jobs:

- **`specs`** — on pushes to `main`/`master` and on pull requests: `node scripts/check-resolver-boundaries.mjs`
  (below), a smoke test that the built CLI's `--version` output matches `package.json`, then
  `npm run test:standalone`. This excludes only the source-bound template typecheck, which
  deliberately requires sibling framework repositories and remains available through the default
  `npm test` / `npm run typecheck:template` workspace lane.
- **`scaffold-typecheck`** — scaffolds a real project with the current scaffolder, installs
  it, and runs that project's own `tsc --noEmit` (`npm run typecheck:scaffold`; see the
  header of `scripts/typecheck-scaffold.mjs` for why this can't be done by typechecking
  `templates/warlock/` in place). This registry-backed consumer check remains mandatory.

Both jobs also run nightly (`cron "0 4 * * *"`) and on `workflow_dispatch`, in addition to
push/PR — `scaffold-typecheck` installs the framework from the registry, so a framework
release alone can turn it red without anyone touching this repo, and the nightly run is what
surfaces that the same day rather than when the next contributor happens to run it.

### Resolver-boundary check

`scripts/check-resolver-boundaries.mjs` treats every `package.json` in the checkout as an
independent publish boundary. It walks each package's `tsconfig.json` `compilerOptions.paths`
and any `vite.config.*` / `vitest.config.*` alias, and fails (exit 1, one line per violation)
if a target resolves outside that package's own directory. An alias inside the package (e.g.
pointing `app/*` at its own `src/*`) is fine; one that reaches into a sibling checkout is not
— it resolves in this monorepo today and breaks the moment the package is installed on its
own, which nothing else here catches before publish. Run it directly with
`node scripts/check-resolver-boundaries.mjs [root]` (defaults to this package's root); its
pure logic is exported as `findResolverBoundaryViolations` and covered by
`specs/resolver-boundaries.spec.ts`.

## License

This project is licensed under the MIT License.

The project-ready summary wraps the complete feature list to your terminal width,
aligning continuation lines under the value while keeping commands indented.
Terminals narrower than 50 columns get a plain list; piped output uses 80 columns.

### Grouped custom feature selection

In `--customize` mode, optional features are organized into sections such as
Auth & Access, Rendering & Mail, and Jobs & Messaging. Open a section to edit its
checklist or choose **Select all** for that section, then return to the menu.
The picker remembers the last group; selecting all remaining features preserves
items you explicitly unticked.
Each section shows its selected count; **Continue** keeps the current choices.
Existing `--features` and `--stack=web` selections stay preselected. Lists remain
paged to the terminal height and hints fit the available width.

The decisions overview shows the total selected feature/AI count and up to six
keys, followed by `+N more` for longer selections. The final success screen lists
all selected feature keys.

### Oxlint and Oxfmt

Oxlint **1.88.0** and Oxfmt **0.73.0** are the only supported tools. New apps
pin TypeScript **7.0.2** and include `.oxlintrc.json`, `.oxfmtrc.json`,
`.oxfmtignore`, and VS Code settings for `oxc.oxc-vscode`.
`--lint=oxc` is optional; `--lint=eslint` fails with the 5.34.0 removal message.
The wizard has no toolchain choice.

```bash
npm create warlock@latest my-app -- --yes
cd my-app
npm run lint:check
npm run format:check
```

Oxlint enables `"categories": { "correctness": "error" }`, unused-variable/import
checks, explicit class accessibility and type-import style. Oxfmt sorts imports
with `"sortImports": { "newlinesBetween": false, "internalPattern": ["app/", "web/", "@shared/"] }`.
It keeps built-ins, packages, internal aliases and relative imports in one block.
Formatting retains unused imports; lint reports them. Local package scripts use
`oxlint`, `oxfmt` and `tsc` directly. The non-mutating scripts are `lint:check`
and `format:check`. Background checks run TypeScript and configured Oxlint.

## TypeScript 7 in 5.32

Default Oxlint/Oxfmt projects pin `typescript` to `7.0.2`; `tsc` is the native Go compiler.
The template uses `module: "ESNext"`, `moduleResolution: "bundler"`, explicit
Node types, and `paths` relative to its tsconfig, without `baseUrl`.
Existing apps must remove `baseUrl`, rebase alias targets, and replace
`moduleResolution: "node"` / `"node10"` before typechecking.

## Migrate existing apps

ESLint and Prettier support was removed in **5.34.0**. Oxlint/Oxfmt is the only
supported toolchain. `--lint eslint` and `healthCheckers.eslint` are removed.
Install the new core release and `ts-morph`, then migrate an existing app:

```bash
npm install --save-dev ts-morph
npx warlock upgrade --from 5.33 --to 5.34.0 --dry-run
npx warlock upgrade --from 5.33 --to 5.34.0
npm install
npm run format
npm run lint:check
npx warlock check
```

The `oxc-toolchain-removal` step reapplies the preserved 5.33 `oxc-toolchain`
migration when legacy configs, scripts or dependencies remain. Apps upgrading
from 5.32 can still use `npx warlock upgrade --from 5.32 --to 5.33.0` first.
It replaces standard scripts/dependencies, pins TypeScript 7.0.2, updates generated
editor settings, removes `healthCheckers.eslint` and selects Oxlint. A generated
`.prettierignore` becomes `.oxfmtignore`; Oxfmt scripts read it explicitly.

Literal custom rules are translated without executing the config. Per-folder
`no-restricted-imports` and `no-restricted-exports` become Oxlint overrides with
file/exclusion patterns. Supported `@typescript-eslint/*` rules become native
`typescript/*` rules (or native base rules). Options are checked against the
pinned Oxlint 1.88.0 schema. Type-aware equivalents enable `options.typeAware`
and add `oxlint-tsgolint@7.0.2004` to the app's dev dependencies.
`unused-imports/no-unused-imports` uses `no-unused-vars` with safe import fixes;
Oxlint shares the severity for imports and variables, so differing active
severities are reported for review.

Only unsupported rules/options, computed or imported settings, selectors such
as `no-restricted-syntax`, and conflicting existing Oxc rules need manual review.
Each finding names its source `file:line`, rule and affected file patterns.
Fully ported lint configs are removed; configs with findings remain for reference
until those findings are addressed. Existing Oxc rules are kept on conflict.
`--dry-run --json` reports the same plan without writes. Customized formatting,
editor settings and nonstandard scripts can also require review.

**Upgrading:** new and migrated template configs enable
`"categories": { "correctness": "error" }`. Address the additional diagnostics;
existing Oxc configs retain their categories. A real lockfile beside a workspace
marker determines the installer: `package-lock.json` plus `pnpm-workspace.yaml`
without `pnpm-lock.yaml` now produces `npm install`.

### Client performance budgets

Generated projects configure `build.budgets.page` with gzip limits of `150kb`
JavaScript and `50kb` CSS, in `mode: "error"`. `npx warlock build` reports each
page and enforces the limits; `npx warlock build --json` prints the report for CI.
API-only projects report no client pages. Adjust the limits in `warlock.config.ts`
or set `mode: "warn"` to keep reporting without failing.
