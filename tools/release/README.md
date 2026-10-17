# tools/release — the Warlock.js release runner

This folder is **not** pkgist. It is the harness that _runs_ pkgist for the
`@warlock.js/*` family — every package under `packages/`, released together at
one version. It is npm-managed (its own `package-lock.json`) and sits outside the
pnpm workspace.

- `pkgist.config.ts` — the static package registry (warlock family only). Member
  roots are `../../packages/<name>`. Never edit it for a release.
- `scripts/release-family.ts` — the release state machine: `gate`, `publish`, `confirm`.
- `ci/blog-check.mjs` — the end-to-end check against the private blog app.
- `builds/`, `sources/`, `release-artifacts/`, `release-handoffs/` — run output, gitignored.

Releases run in GitHub Actions on this repository
(`.github/workflows/release.yml`, dispatched with a version and `publish`):

1. **gate** — public-text check, strictness ratchet, every member's typecheck and tests, a clean
   tree per member directory, pkgist build, ONE release commit for the family,
   pack, local-registry install, generator matrix at the stated scope.
2. **publish** — every tarball to npm, re-hashed immediately before each publish.
3. **confirm** — install/import from the npm origin, then tag `v<version>` once on
   the release commit and push the tag and the branch. Registry reads and the
   install/import/scaffold checks share one thirty-minute deadline, with
   exponential backoff from three to sixty seconds. Already-live packages are
   not re-polled; retries start with clean consumer and scaffold directories.
   On exhaustion, or when tagging or pushing fails after confirmation, the
   runner saves its recorded release commit in `$LOGS/release-commit.bundle`,
   uploaded with `warlock-<version>-logs`.
   Recovery output explains how to download that bundle and the
   `warlock-<version>-artifacts` upload, restore `build-provenance.json`, import
   the commit, check that the origin branch is its ancestor, push the recorded
   commit and tag, and dispatch the registry blog check. When release edits are
   a no-op, the recorded commit is the dispatched commit. Wait for every subject
   to be visible before recovery; do not republish.
   The same steps are saved as `$LOGS/recover-release-v<version>.sh`: after
   `gh run download <run_id> -n warlock-<version>-logs -D release-logs`, run
   `bash release-logs/recover-release-v<version>.sh <run_id>` from the
   repository root. The script uses `set -euo pipefail` and is safe to rerun
   after a partial recovery: it skips present downloads, keeps a tag already at
   the release commit and treats a tag already at origin as pushed. The printed
   copy is wrapped in `( set -euo pipefail … )`, so pasting it stops at the
   first failure without closing your shell.

```bash
npm ci
npm run test:scripts
node --import tsx scripts/release-family.ts gate --version <x.y.z> --matrix none
```

The pkgist tool itself is `@mongez/pkgist` on npm, released separately; keep the
pinned version in `package.json` in step with the @mongez runner.

## Dispatching a release from automation

A person can always dispatch `release.yml` from the Actions tab
(<https://github.com/warlockjs/framework/actions/workflows/release.yml> → **Run workflow**).
To let an agent or script dispatch it, it needs a fine-grained personal access token, and the
`warlockjs` organization's token policy currently rejects such tokens because of their lifetime.
Only an organization owner can change that:

1. Open the organization's token policy:
   <https://github.com/organizations/warlockjs/settings/personal-access-tokens>.
   Under **Fine-grained personal access tokens**, allow access via fine-grained tokens, set the
   **maximum allowed lifetime** to at least the lifetime you will give the token (or no limit),
   and choose whether tokens need approval.
2. Create the token at <https://github.com/settings/personal-access-tokens/new>:
   - **Resource owner:** `warlockjs`;
   - **Repository access:** only `warlockjs/framework`;
   - **Permissions:** `Actions: Read and write` (dispatching and reading runs) and
     `Metadata: Read` (added automatically). Nothing else is needed.
   - an expiry within the policy from step 1.
3. If the policy requires approval, approve the request under the organization's
   **Personal access tokens → Pending requests**.
4. Store the token outside the repository with owner-only permissions (`chmod 600`) and dispatch with
   `gh workflow run release.yml -R warlockjs/framework -f version=<x.y.z> -f publish=<true|false>`
   using `GH_TOKEN` from that file. Never print it or commit it.

Publishing itself does not use this token: `release.yml` publishes with the `NPM_TOKEN` secret of the
`release` environment and pushes the tag with the job's own `GITHUB_TOKEN`. A new package added to the
family must be publishable with that `NPM_TOKEN` (an automation or granular token with write access to
the whole `@warlock.js` scope, not to a fixed list of packages).

## Repository history

Issue reports used while preparing a release (`findings/`) are removed from the tree once the release
ships. Earlier reports stay in git history: rewriting the public history would break every clone and
fork, so it is not done.

---

The rest of this file is a copy of pkgist's own README, kept here for reference.

---

# @mongez/pkgist

A build, version, and publish tool for TypeScript/React npm packages. Powered by [tsdown](https://tsdown.dev) (Rolldown/Rust-based bundler).

## Features

- **Two versioning strategies** — standalone packages version independently; family packages share one synchronized version
- **tsdown engine** — Rust-based Rolldown bundler; fast, reliable, modern
- **Dual output** — ESM + CJS with proper `exports` map and separate `.d.ts` files per format
- **File cloning** — copy `README.md`, `skills/`, `llms.txt`, or any file/folder into the build
- **Source snapshots** — archives a clean copy of the source before each build (`.git` and `node_modules` excluded)
- **Git integration** — `git add → commit → push → tag v<x.y.z> → push tags`
- **npm publish** — publishes from the build directory, not the source
- **Dry-run mode** — prints every step without touching disk, git, or npm
- **Concurrency** — builds multiple packages in parallel
- **TypeScript config** — `pkgist.config.ts` with full type safety via `defineConfig`

---

## Installation

```sh
# Global — use the CLI anywhere
npm install -g @mongez/pkgist

# Or as a dev dependency in your monorepo root
npm install -D @mongez/pkgist
```

Add a script to your root `package.json` for convenience:

```json
{
  "scripts": {
    "release": "pkgist build:all",
    "release:dry": "pkgist build:all --dry-run"
  }
}
```

---

## Configuration

Create a `pkgist.config.ts` in your project root (auto-discovered; `builder.ts` also works):

```ts
import { defineConfig } from "@mongez/pkgist";

export default defineConfig({
  settings: {
    concurrency: 8, // parallel build limit (default: 4)
    buildDir: "../builds", // where compiled packages are written
    sourcesDir: "../sources", // optional: where source snapshots are archived
  },

  // Standalone: each package versions independently
  standalone: [
    {
      name: "@my-scope/utils",
      root: "../utils",
      clone: ["README.md", "skills", "llms.txt", "llms-full.txt"],
    },
  ],

  // Families: all packages in a group share one version
  families: [
    {
      name: "state",
      packages: [
        { name: "@my-scope/atom", root: "../atom", clone: ["README.md"] },
        {
          name: "@my-scope/react-atom",
          root: "../react-atom",
          type: "react",
          clone: ["README.md"],
        },
      ],
    },
  ],
});
```

The config file is loaded at runtime via dynamic import — it can use `import` syntax freely.

---

## Package options

Every entry in `standalone[]` and `families[].packages[]` accepts:

| Option            | Type                             | Default          | Description                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | `string`                         | **required**     | npm package name                                                                                                                                                                                                                                        |
| `root`            | `string`                         | **required**     | Path to package root, relative to `pkgist.config.ts`                                                                                                                                                                                                    |
| `type`            | `"typescript" \| "react"`        | `"typescript"`   | React packages get JSX support                                                                                                                                                                                                                          |
| `formats`         | `("esm" \| "cjs")[]`             | `["esm", "cjs"]` | Output formats                                                                                                                                                                                                                                          |
| `mainType`        | `"cjs" \| "esm"`                 | `"cjs"`          | Primary format (affects `main` field in package.json)                                                                                                                                                                                                   |
| `entries`         | `string \| string[]`             | `["index.ts"]`   | Entry files inside `src/`                                                                                                                                                                                                                               |
| `srcDir`          | `string`                         | `"src"`          | Source directory name                                                                                                                                                                                                                                   |
| `dts`             | `boolean`                        | `true`           | Generate TypeScript declarations                                                                                                                                                                                                                        |
| `sourcemap`       | `boolean`                        | `true`           | Generate sourcemaps                                                                                                                                                                                                                                     |
| `minify`          | `boolean`                        | `false`          | Minify output                                                                                                                                                                                                                                           |
| `preserveModules` | `boolean`                        | `true`           | Keep one file per source module instead of bundling everything into a single `index.js`. Produces meaningful stack traces (`array/chunk.mjs:4` vs `index.js:1027`). Set to `false` only for tiny single-file packages where a flat bundle is preferred. |
| `clone`           | `(string \| [string, string])[]` | `[]`             | Files/dirs to copy into build. Strings copy as-is; `["src", "dest"]` renames                                                                                                                                                                            |
| `publish`         | `boolean`                        | `true`           | Publish to npm                                                                                                                                                                                                                                          |
| `access`          | `"public" \| "restricted"`       | `"public"`       | npm access level                                                                                                                                                                                                                                        |
| `commit`          | `string \| true \| false`        | —                | Git commit message. `string` → use verbatim. `true` → auto-generate `Released <new-version>`. `false` / omitted → skip git entirely.                                                                                                                    |
| `branch`          | `string`                         | current branch   | Git branch to push to                                                                                                                                                                                                                                   |

### Standalone-only option

| Option    | Type                                                | Default  | Description                                                                                                                         |
| --------- | --------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `version` | `"auto" \| "patch" \| "minor" \| "major" \| string` | `"auto"` | `"auto"`/`"patch"` bumps the patch digit; `"minor"` bumps minor; `"major"` bumps major; any semver string uses that version exactly |

### Family-level options

| Option    | Type                                                | Default  | Description                                                                                                                                                                                                          |
| --------- | --------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version` | `"auto" \| "patch" \| "minor" \| "major" \| string` | `"auto"` | Same strategies as standalone; applied to the highest current version across all family members                                                                                                                      |
| `commit`  | `string \| true \| false`                           | —        | Commit message applied to all family members (overrides per-package). Same shape as the per-package `commit`. `true` auto-generates `Released <new-version>` for every member with their shared version substituted. |

---

## Versioning

### Standalone packages

```
current: 2.1.0
version: "auto"   →  2.1.1  (patch bump)
version: "3.0.0"  →  3.0.0  (explicit)
```

### Family packages

The family picks the **highest current version** across all members, then bumps it:

```
atom        1.0.5
react-atom  5.1.3   ← highest
atomic-query 0.1.0

family version: "auto"  →  5.1.4  (all three land on 5.1.4)
```

This means if you add a new package to a family at `0.1.0`, it jumps to match the family on first build — which is intentional. The family version is the compatibility contract.

---

## CLI reference

### `build`

Build one or more standalone packages.

```sh
pkgist build @my-scope/utils
pkgist build @my-scope/utils @my-scope/cache
pkgist build --all                   # all standalone packages
```

### `build:family`

Build all packages in a family with a shared version.

```sh
pkgist build:family atom
pkgist build:family localization
```

### `build:all`

Build every standalone package and every family.

```sh
pkgist build:all
```

### `list`

Show all registered packages and families with their current versions.

```sh
pkgist list
```

```
=== Standalone Packages ===
  @my-scope/utils v2.1.0 [typescript] [esm, cjs]
    root: /path/to/utils

=== Families ===
  Family: state
    @my-scope/atom v5.1.3 [typescript] [esm, cjs]
    @my-scope/react-atom v5.1.3 [react] [esm, cjs]
```

### `validate`

Check that the config is valid and all package roots exist on disk.

```sh
pkgist validate
```

---

## Common flags

Available on all `build` commands:

| Flag                | Description                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `--dry-run`         | Print every step without writing to disk, git, or npm                                  |
| `--no-publish`      | Skip `npm publish`                                                                     |
| `--no-git`          | Skip git add / commit / push / tag                                                     |
| `--concurrency <n>` | Override the parallel build limit                                                      |
| `--config <path>`   | Path to config file (default: auto-discovers `pkgist.config.ts` / `builder.ts` in cwd) |
| `--verbose`         | Show debug-level log lines                                                             |

---

## Build output structure

### With `preserveModules: true` (default)

Each source file becomes its own output file, mirroring the source tree. Stack traces show file names instead of opaque line numbers.

```
builds/
└── utils/
    └── 2.1.1/
        ├── package.json            ← clean: no devDeps, no scripts
        ├── README.md               ← cloned
        ├── skills/                 ← cloned (directory)
        ├── esm/
        │   ├── index.mjs
        │   ├── index.mjs.map
        │   ├── index.d.mts
        │   ├── array/
        │   │   ├── chunk.mjs
        │   │   └── chunk.d.mts
        │   └── string/
        │       └── trim.mjs
        └── cjs/
            ├── index.cjs
            ├── index.cjs.map
            ├── index.d.cts
            └── array/
                └── chunk.cjs
```

The generated `package.json` sets:

```json
{
  "main": "./cjs/index.cjs",
  "module": "./esm/index.mjs",
  "types": "./esm/index.d.mts",
  "exports": {
    ".": {
      "import": {
        "types": "./**esm**/index.d.mts",
        "default": "./esm/index.mjs"
      },
      "require": { "types": "./cjs/index.d.cts", "default": "./cjs/index.cjs" }
    }
  }
}
```

### With `preserveModules: false`

Everything is bundled into a single file per format. Useful for tiny single-file packages.

```
esm/
  index.js / index.js.map / index.d.ts
cjs/
  index.js / index.js.map / index.d.ts
```

```json
{
  "main": "./cjs/index.js",
  "module": "./esm/index.js",
  "types": "./esm/index.d.ts"
}
```

ESM-only packages (`mainType: "esm"` or `formats: ["esm"]`) get `"type": "module"` and omit the `require` condition in both modes.

---

## Build pipeline (per package)

1. Load source `package.json` → read current version
2. Resolve new version (auto-bump or explicit)
3. Create build output directory
4. Snapshot source to `sourcesDir/` — full copy excluding `.git`, `node_modules`, `dist`
5. Compile with **tsdown** → `esm/` and `cjs/` subdirectories
6. Clone extra files/directories listed in `clone`
7. Write clean `package.json` for the build
8. Update source `package.json` version in-place
9. Git: `add .` → `commit` → `push` → `tag v<version>` → `push tags` _(if `commit` is set)_
10. `npm publish --access <public|restricted>` from build directory _(if `publish !== false`)_

---

## Git workflow

Git operations run when `commit` resolves to a non-empty message. Three shapes:

```ts
// 1. Explicit message — string
{ name: "@my-scope/utils", root: "../utils", commit: "chore: release" }

// 2. Auto-generated message — boolean true
//    → produces "Released <new-version>", e.g. "Released 2.1.4"
{ name: "@my-scope/utils", root: "../utils", commit: true }

// 3. Skip git — omit, or pass false explicitly
{ name: "@my-scope/utils", root: "../utils" }              // omitted
{ name: "@my-scope/utils", root: "../utils", commit: false } // explicit skip
```

**Family-level `commit`** uses the same shape and overrides per-package values:

```ts
// One explicit message for every family member
{
  name: "state",
  commit: "feat: improved actions API",
  packages: [ ... ],
}

// Auto-generated for every member with the shared family version
{
  name: "state",
  commit: true,
  packages: [ ... ],
}
```

The builder tags each package with `v<version>` and pushes tags automatically.  
Pick `false` or omit for local test builds where you want zero git side effects.

---

## Developing the bundler itself

```sh
yarn build     # compile src/ → dist/ once
yarn dev       # watch mode — recompiles on change
```

After any change to `src/`, run `yarn build` before the next `pkgist` invocation.

npx pkgist build:family warlock --bump 4.2.2

CI checks shipped documentation command portability and skill-snippet compile budgets.
Package-manager-specific troubleshooting exceptions match exact file and text, so
inserting lines above them cannot hide a new command or break a valid exception.
The spec-coverage gate passes under the required Node.js 22.15 runtime.
Shared Oxfmt config or ignore changes also trigger the standalone scaffolder CI
workflow. Temporary coverage scratch directories are excluded from version control.

Queue and notification integration tests probe Redis at localhost:6390 (override
with QUEUE_REDIS_HOST/QUEUE_REDIS_PORT). Without Redis, local runs skip those cases
and continue unit tests. CI or WARLOCK_REDIS_INTEGRATION=1 fails when the service is
missing. A disposable local service can use `redis-server --bind 127.0.0.1 --port
6390 --save "" --appendonly no`; stop only the instance you started.

The release gate runs every package reference generator before validation and
clean-tree checks. Run `pnpm docs:references` in the workspace to prepare those
files; commit any changed projections before gating. Generator failure stops the
gate, and stale generated changes cannot be silently packed.

The strictness ratchet also checks noUncheckedIndexedAccess. Preserve real bounds
checks and assertions rather than widening types, and lower budgets to measured
counts after fixes. The release gate verifies the full workspace again.

Release gates always set WARLOCK_REDIS_INTEGRATION=1 for package quality scripts,
including local runs. The release workflow supplies Redis on port 6390 explicitly.
Skill compilation maps source package subpaths independently of root barrels,
honours explicit package exports without exposing internal source paths,
resolves installed dependencies from the skill's owning package, and isolates
application registry augmentations between skills. Missing app support files
remain compiler errors; examples must include those files or state a complete
replacement. Existing failure allowances cannot increase; lower them to the
measured package counts after fixes and the final formatting pass.
