---
name: zero-edit-generator-matrix
description: The 30-row release gate that scaffolds real apps from staged tarballs and runs them end to end — what a row is, what each row proves, the three adapters it needs, how to run one row instead of thirty, and the OWNER-GATED rule that decides whether it runs at all in a given release. Read this before running the gate, before extending it, and before telling anyone a release is verified.
---

# The zero-edit generator matrix

**What it is, in one line: thirty real apps, built and run, with nothing repaired
by hand to make them pass.**

It is the only check in this workspace that answers _"does what we publish
actually work?"_ Unit tests answer "does this function behave", and a grep
answers "does this string exist" — neither has ever caught the defects this
does. In 5.4 it found nine, including a scaffold whose own home page 404'd and a
`dist` that reported itself built while being empty.

Implementation: `tools/release/scripts/zero-edit-generator-gate.ts`, driven by
`tools/release/scripts/release-family.ts`.

---

## ⚠ OFF BY DEFAULT — the owner turns it on, per release

**Owner ruling 2026-09-07, rev. 3 (canon `e00fb7b8`): the matrix is OFF by
default, and a release ships without it.** A full run is ~50 minutes of machine
time and cannot be paid on every release.

**Before each release, ASK in the Bureau room — never mid-run.** Only an
explicit owner authorisation turns it on. No answer, or no ask, means **skip**,
and the release still ships. Bring three things to the ask:

1. **Which rows this release's diff actually touches.** Not a guess: the changed
   packages, mapped to their feature rows. "Everything, to be safe" is not an
   answer, it is an abdication.
2. **The cost.** Full is about 50 minutes. A subset via `--only` is about 5
   minutes per row.
3. **A recommendation, with the reason.** You read the diff; the owner did not.

| scope      | when                                   | may publish? |
| ---------- | -------------------------------------- | ------------ |
| **NONE**   | the default — nobody authorised a run  | **yes**      |
| **SUBSET** | owner authorised named rows (`--only`) | **yes**      |
| **FULL**   | owner authorised all 30 rows           | **yes**      |

### EVERY release states its scope — this is the whole safeguard

The gate is optional now, so **the record is what stops it degrading silently.**

**Every release states the matrix scope it ran** — in the release summary _and_
in `docs/src/data/releases.json`. Not only the skipped ones. `"matrix": "none"`
and `"matrix": "full"` are both statements; an absent field is not. For any run
that happened, name **which rows** ran.

> **A release whose scope is not stated must not ship.**

This is not bureaucracy. Shipping something that quietly degraded without
announcing it is the exact defect class this framework's last two releases were
spent fixing. We do not get to do it to our own process.

### The weakness — name it, do not paper over it

**The release script cannot read Bureau.** So "the owner authorised it in a room
message" is enforced by **the member, not the machine**. A member asserting a
fact instead of checking it is precisely how the 5.5 scope was got wrong (canon
`37ef76bf`).

So **quote the authorisation into the release summary** — its date and the
owner's actual words, not a bare pointer. A reference that only resolves inside
Bureau is a dangling pointer everywhere else (canon `09374678`).

### How the runner enforces it

Built on task `26831930`, shipped in 5.6. The scope is no longer something a
member remembers to write down afterwards — it is an argument the gate refuses
to run without, and a field the handoff carries.

```sh
# the default: the matrix does not run, and the release says so
node tools/release/scripts/release-family.ts gate --version 5.6.0 --matrix none

# the owner authorised named rows
node tools/release/scripts/release-family.ts gate --version 5.6.0 \
  --matrix subset --only web,composed \
  --authorised-by Hasan --authorisation-date 2026-09-07 \
  --authorisation "run the web and composed rows for this one"

# the owner authorised all 30
node tools/release/scripts/release-family.ts gate --version 5.6.0 \
  --matrix full \
  --authorised-by Hasan --authorisation-date 2026-09-07 \
  --authorisation "full matrix before this one ships"
```

What it refuses, and why each is a refusal rather than a default:

- **No `--matrix` at all.** Refused before anything is built. A default would
  let an unstated scope become a stated one by accident, which is the exact
  silent degradation the ruling was written to prevent.
- **`subset` with no rows, or `full`/`none` carrying rows.** A handoff that
  misdescribes what ran is worse than one that admits it ran nothing.
- **`subset` or `full` with no authorisation.** The runner cannot read Bureau,
  so it cannot check that an authorisation is real — what it can do is refuse to
  invent one. `none` needs no authorisation and refuses one: requiring
  permission for the default would be requiring permission to do nothing.
- **A handoff with no `matrixScope`** is refused at publish time. It is not
  read as `"none"`.

`none` skips the **matrix** and nothing else. The local registry is still owned
and started, all 28 tarballs are still staged, and every member is still
confirmed installable from it. Skipping the matrix is not skipping the gate.

Still written by hand: the summary prose and the `releases.json` entry. The
handoff carries the scope, the rows and the quoted authorisation; a human still
copies them across.

### What changed, stated plainly

Until 2026-09-07 the full matrix was **mandatory** before any publish. It is now
opt-in, so the normal release is **no longer gate-verified**. That is the owner's
risk, taken knowingly. It is recorded here so nobody later mistakes it for drift.

---

## What a "row" is

One row = **one scaffolded application**, created from the staged tarballs,
installed, built, booted, and exercised.

- **1 baseline row** — a plain app with no features added.
- **28 isolated rows** — one per feature (`auth`, `cache`, `herald`, `seal`,
  `web`, …), each with **exactly one** feature turned on.
- **1 composed row** — every feature at once.

**Why one feature per row:** when a row fails, the failing row names the culprit.
A single all-features app that breaks tells you only that something broke.

**Why "zero-edit":** the generated files are never patched to make the gate pass.
The moment you hand-fix a scaffold, the gate stops measuring what a user gets and
starts measuring your patience.

## What each row actually does

1. `npm create warlock` into an empty directory, from the staged registry.
2. `warlock add <feature>` — the isolated path, or the composed path.
3. `npm install --strict-peer-deps`, then `npm ls --all` must be clean: one Core
   instance, no `ELSPROBLEMS`. No `--force`, no `--legacy-peer-deps`.
4. Assert every `@warlock.js/*` pin is the exact candidate version.
5. Typecheck, build, boot, start.
6. Exercise every generated route and command over real HTTP.
7. For web-bearing rows: drive a **real browser** over CDP — render, click,
   assert HMR, and run the mutation red-control.

## The three adapters

The gate spawns each as a Node child process and parses **stdout as JSON**:

| variable                           | what it answers                                                        |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `WARLOCK_FEATURE_CATALOG_ADAPTER`  | which features exist — derived from the installed CLI, never hardcoded |
| `WARLOCK_GENERATED_OUTPUT_ORACLE`  | did this generated app produce what it should                          |
| `WARLOCK_GENERATED_BROWSER_ORACLE` | does the rendered page work in a browser                               |

They live in `tools/release/scripts/adapters/`.

**The gate truncates stderr to its TAIL.** So an oracle's failure message puts the
**captured output first and the diagnosis last** — reverse it and the useful half
is what gets cut.

---

## Running it

```sh
# full matrix — about 50 minutes, and it needs an owner authorisation
node tools/release/scripts/release-family.ts gate --version <x.y.z> --matrix full \
  --authorised-by <name> --authorisation-date <YYYY-MM-DD> --authorisation "<their words>"

# one row (plus baseline) — about 5 minutes instead of 50
node tools/release/scripts/release-family.ts gate --version <x.y.z> --matrix subset --only web \
  --authorised-by <name> --authorisation-date <YYYY-MM-DD> --authorisation "<their words>"

# skip the rebuild when the tarballs are already proven
node tools/release/scripts/release-family.ts gate --version <x.y.z> --matrix subset --only web \
  --authorised-by <name> --authorisation-date <YYYY-MM-DD> --authorisation "<their words>" \
  --reuse-artifacts
```

- All three scopes emit a publish handoff. What none of them may do is go
  unstated — see **How the runner enforces it** above.
- `--only` always runs the **baseline** too. The **composed** row is skipped
  unless you pass `--only composed` explicitly.
- `--reuse-artifacts` re-hashes every recorded tarball and checks git HEAD plus
  the dirty set before trusting them. It refuses if anything moved.
- Never launch the gate through `npx` or `pnpm exec` (canon `50608334`).
- **RabbitMQ must be running for the `herald` row.** It is installed locally on
  Erlang **28.5** — _not_ 29, which dies with `horus, extraction_denied`.
- The gate's own command timeout is 15 minutes. Its timeout message says _"if it
  says the work completed, the command finished and then failed to EXIT"_ —
  believe it; that distinction has cost hours.

## Extending it — the rules that were paid for

- **Verify by executing, never by grepping** (canon `e3121797`). A tarball
  legitimately contains the string `workspace:` in sourcemaps; a parsed manifest
  is the evidence.
- **A red control is three observations** (canon `87660e1e`, `4a7f3259`): good
  input passes, bad input fails, and reverting the fix exhibits the **original**
  defect affirmatively. Two of the three is not a red control.
- **Withhold the marker, don't assert it.** The browser oracle fails the gate
  when a mutation goes _undetected_ — silence must never read as success. The
  worst bug this gate ever had was an oracle that never ran while reporting
  passes.
- **A plausible cause that explains the symptom is not the cause.** A plausible
  fix for the mutation-control defect shipped once, and run 11 refuted it.
- **An oracle that cannot decide must THROW**, not return `false`. `detectHasWeb`
  returning a quiet `false` silently skipped the browser oracle for every
  web-bearing app.
- Adapter path arguments are **not** realpath'd on purpose — the gate compares
  the echoed `appRoot`/`baselineRoot` against `path.resolve`.

## Known gap

`88bfc363` — the gate has **no vocabulary for BLOCKED**. A row needing an
external service that is absent can only be reported as a failure. Designed in
5.4 (`release/gate-blocked-vocabulary-form-enumeration.md`, ten forms enumerated,
only two of them non-FAIL); never built. Carried to 5.6.

## Running it in CI, and how the release runner reads the verdict

**Status (monorepo):** the workflow is `.github/workflows/generator-matrix.yml`
in **`warlockjs/framework`**, beside `release.yml` (see the
release-the-warlock-family skill). `release.yml` runs the gate with
`--matrix none` only; the matrix runs only when this workflow is dispatched.
It is `workflow_dispatch`-only and owner-gated, same as the local `gate` CLI:
dispatching it IS the authorisation event, and `scope`/`authorisation` have no
default. Dispatching it and running the first Linux row is a separate,
owner-authorised step; the workflow existing is not the matrix having run.

How it runs: one checkout of this repository at `inputs.sha` pins every
member at once (the per-repo era needed 30 clones and a cross-repo token). The
SHA is put on the default branch with `git checkout -B`, because the gate
refuses a detached HEAD. An `artifacts` job installs the workspace, stages
every tarball ONCE (`--matrix none`) and uploads `tools/release/builds`,
`release-artifacts/<version>` and the handoff; each `matrix` row downloads
them and runs `--matrix subset --only <row> --reuse-artifacts`; a Windows
canary runs `baseline` (it rebuilds, because recorded tarball paths are
Linux paths); `verdict` (`.github/scripts/matrix-verdict-cli.mjs`) fails
unless every planned row has exactly one green result. The herald row has no
RabbitMQ service and is expected to report BLOCKED.

The release runner requires "a successful authorised run for the exact
candidate SHA" before treating the matrix as satisfied. Check it with:

```sh
gh run list --repo warlockjs/framework --workflow generator-matrix.yml \
  --json headSha,conclusion,url \
  --jq '[.[] | select(.headSha == "<exact-sha>")][0]'
```

`conclusion` must be exactly `"success"` for that SHA. That top-level check has
no per-row detail — download the run's `generator-matrix-verdict-<sha>`
artifact for the row-by-row table (row, os, conclusion) the `verdict` job
writes.
