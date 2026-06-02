# Plan — persisted transpile cache + correct error mapping

Status: Phase A shipped (committed 51b86c35). Phase B complete — own
resolver + esbuild-only TS pipeline, all rollout flags removed, tsx
dropped from `@warlock.js/core`. Awaiting review/approval before commit.

## Why now

Two problems surfaced this phase, and they share a solution:

1. **No persisted transpile cache.** Every cold dev boot re-transpiles the
   entire boot import closure from scratch. `.warlock/cache/` was deleted in
   the loader-hook rebuild (it was URL/version-keyed and entangled with HMR
   correctness — the source of the staleness bugs). tsx's own ESM-loader path
   does **not** persist a cross-run cache (empirically verified: nothing in
   `node_modules/.cache`, tsx dir, or tmp). On a ~1000-file project that
   full re-transpile is the single largest avoidable cold-start cost.

2. **tsx loader-contract fragility.** tsx 4.22 changed its `resolve()` to
   return `format: "module-typescript"`; our hook spread that through and
   Node built empty module namespaces — every config lost its `default`
   export and the server wouldn't boot. We pinned tsx to `4.21.0` to
   unblock. Depending on tsx's loader-hook internals means a minor release
   can break the whole framework. `production-builder.ts` already transpiles
   via **esbuild directly** (stable, versioned transform API).

3. **Error mapping debt.** The pre-rebuild design wrote transpiled JS to
   `.warlock/cache/src-app-users-services-some-service.js`, so stack traces
   pointed at mangled cache filenames instead of the real
   `src/app/users/services/some-service.ts:42:10`. Any caching design we
   bring back **must not reintroduce this**. Error frames must resolve to
   the original `.ts`, correct line and column.

A content-hash transpile cache built on esbuild solves (1), removes the tsx
dependency from the hot path which addresses (2), and — done with proper
source maps — fixes (3) instead of regressing it.

## Goals

- Persisted transpile cache so warm boots only re-transpile changed files.
- **Correctness by construction**: keyed by source-content hash. Same hash →
  same output, always. Changed content → new hash → fresh transpile. The
  staleness bug class is structurally impossible.
- **HMR-orthogonal**: the `?v=N` Node-module-identity layer is untouched.
  The cache only short-circuits the *transform* step, never module identity.
- **Correct error mapping**: stack traces point to original `.ts` files with
  accurate line/column, in dev and production.
- **Decouple the transpile hot path from tsx's loader contract** by
  transforming via esbuild directly.

## Non-goals

- Not touching the `?v=N` HMR mechanism, the flush protocol, the dependency
  graph, or the manifest. Those work; leave them.
- Not a general plugin/transform pipeline. esbuild TS→JS transform only.
- Not removing tsx wholesale in one step (see "tsx decoupling", staged).

## Design

### Cache key & storage

- Key = `sha256(sourceText + transformOptionsFingerprint)`. The options
  fingerprint covers esbuild target, jsx settings, tsconfig-derived options
  — anything that changes output for identical source.
- Store under `.warlock/transpile/<first2>/<hash>.js` (+ `.js.map`). Sharded
  by hash prefix to keep directory sizes sane. **Never** keyed by a mangled
  source path — that was the old mistake and the cause of the error-mapping
  debt. The path on disk is opaque; the source identity lives in the map.
- Entry = `{ code, map }`. Optionally a tiny sidecar index for GC metadata
  (last-access, size) — or derive from filesystem mtime to avoid a second
  source of truth.
- GC: simple size/age budget (e.g. evict LRU when total > N MB or entries
  older than M days). Cheap; runs opportunistically at boot, not on the hot
  path.

### Where it plugs in

The load-hook is the single integration point. Today:

```
load(url) → strip ?v=N → nextLoad(cleanUrl)  // tsx transpiles here
```

Proposed:

```
load(url):
  cleanUrl = strip ?v=N
  absPath  = fileURLToPath(cleanUrl)
  source   = read absPath
  hash     = sha256(source + optsFingerprint)
  hit      = cache.get(hash)
  if hit:  return { format: "module", source: hit.code, shortCircuit }
  out      = esbuild.transform(source, { ...opts, sourcemap: true,
                                         sourcefile: absPath })
  cache.put(hash, out)
  return { format: "module", source: out.code (+ map), shortCircuit }
```

Transform via `esbuild.transform()` directly — already a core dependency,
already what `production-builder.ts` uses. This unifies the dev and prod
transpile engines and removes tsx from the load hot path.

`resolve()` still needs tsx for tsconfig `paths`/alias resolution and
extensionless imports — see staging below. The empty-namespace bug was a
*resolve-side* `format` propagation issue; this plan's load-side change is
independent of it, and pinning tsx 4.21 keeps resolve stable meanwhile.

### Error mapping — the part that must be right

The old design's failure: it served a file whose on-disk name and URL were
`.warlock/cache/src-app-users-some.js`, with no source map back to the
original. V8 had nothing to remap, so every frame showed the cache path.

The fix is source maps done properly, three requirements, all mandatory:

1. **esbuild emits a real map**: `sourcemap: true`, `sourcefile` set to the
   **absolute original `.ts` path**, and `sourcesContent: true` so the map
   is self-contained even if the cache outlives the source on disk.
2. **The map travels with the module.** Append an inline
   `//# sourceMappingURL=data:application/json;base64,…` to the returned
   `code` (or return the map via the loader result if Node's version
   supports it). Inline is simplest and survives the `?v=N` URL with no
   extra resolution step.
3. **Node consumes it.** Run dev with source maps enabled
   (`--enable-source-maps` / `process.setSourceMapsEnabled(true)` at boot).
   V8 then remaps every stack frame to `src/app/.../some.ts:LINE:COL`.

Acceptance test for this is explicit (see Testing): throw from a known line
in a service, assert the stack frame string is the original `.ts` path with
the exact line and column — not a `.warlock/...` path, not the transpiled
line number.

The `?v=N` query in the module URL must be stripped from the `sourcefile`
and from any displayed frame so the path is clean
(`some.ts`, not `some.ts?v=3`). The error-formatting helper in
`dev-logger.ts` already strips absolute prefixes; extend it to also strip
`?v=\d+` and trust the source map for line/col rather than regex-rewriting
filenames (delete the old cache-path translation logic entirely — it's dead
and wrong now).

### HMR orthogonality

- `?v=N` continues to drive Node module identity. Unchanged.
- The cache is consulted *after* `?v=N` is stripped, keyed by content hash.
- Editing a file → new content → new hash → cache miss → fresh transform →
  new cache entry. The bumped `?v=N` makes Node load it as a new module.
  The two mechanisms never interact; one is "is this a new module?", the
  other is "have I already compiled this exact text?".

### tsx decoupling — staged, not big-bang

Decided direction: the framework owns its module pipeline on esbuild;
tsx is removed from `@warlock.js/core` entirely. Sequenced so the risky
half (resolution) is isolated from the safe half (transform):

- **Phase A (this plan, Phases 1–4):** move the *transform* off tsx onto
  esbuild in the load hook. tsx stays only for `resolve()`. The hot path no
  longer depends on tsx's load contract — which is what the 4.22 incident
  broke.
- **Phase B (specified below):** replace tsx's `resolve()` with our own,
  built on `get-tsconfig` + `resolve-pkg-maps`. After Phase B, tsx is gone
  from the framework; see "Phase B — own the resolver" for full scope.

## Phases

1. **Cache module** — ✅ done. `loader/transpile-cache.ts`: content-hash
   `cacheKey`, `computeFingerprint` (esbuild version + cache epoch +
   compilerOptions blob), `TranspileCache` with sync `get`/`put` (atomic,
   sharded), mtime-derived `gc` (age + size budget), `clear`. Pure, no hook
   wiring. 20 vitest tests green via `yarn test:core`.
2. **esbuild transform path** — ✅ done. `load-hook.ts` now owns the
   transpile for stamped `src/` URLs via `esbuild.transformSync` + cache
   lookup; tsx is no longer on the load hot path for project source.
   `configureTranspile()` wired through `hook-thread` → `register-loader` →
   `files-orchestrator.init()`; payload built by
   `loader/build-transpile-init.ts`. Behind `devServer.transpileCache`
   (default off). Non-tracked URLs (npm, node:, framework `.ts`) still
   delegate to tsx unchanged.
3. **Source maps + error mapping** — ✅ done. esbuild emits inline base64
   maps (`sourcemap: "inline"`, `sourcefile` = absolute `.ts`,
   `sourcesContent` on by default); `process.setSourceMapsEnabled(true)` at
   dev boot. `dev-logger` already carried no cache-path translation (the
   loader-hook rebuild removed it). Acceptance test green — see Results.
4. **Flip on, measure** — ✅ measured on the real project. Results below.
5. **Phase B** — own the resolver, drop tsx from the framework. Full scope
   in the dedicated section below; has its own resolution test matrix and
   should not start until Phase A is shipped and measured.

### Follow-ups landed on top of Phase A

- **Load-time error mapping** — `module-loader.ts` now passes the caught
  error to `devLogError`, so module-evaluation failures (undefined symbol,
  bad import side-effect) print a source-mapped stack instead of a bare
  one-line message. Verified live (`main.ts → … → x()` → frames at the
  real `.ts:line:col`).
- **Stack colourisation** — `dev-logger.formatErrorStack`: bold-red header,
  user `src/` frames highlighted (green `›`, yellow fn, cyan rel-path),
  framework / `node_modules` / `node:` frames dimmed + relativised.
- **Debug cache filenames (toggle, default off)** —
  `devServer.transpileCacheDebug`. When on, cache files are
  `<slug>.<hash>.js` (last 3 source path segments, sanitised, capped 60)
  plus a trailing `// @source <abs>` marker. Slug is cosmetic only: cache
  key, lookup, module identity and source-map `sourcefile` are unchanged,
  so correctness is unaffected. Marker is appended **after** the inline
  `//# sourceMappingURL` so it cannot shift generated line numbers —
  verified live with debug on: probe still maps to exact `routes.ts:6:9`.
  New units: `source-slug.test.ts` + labeled-entry cases (31 green total).

## Phase A results (measured 2026-05-18, real project, `transpileCache: true`)

Live `yarn start` on the actual ~700-module boot closure, port 2032:

- **Cold boot (empty cache):** 74.2 s to http-bind. 0 → 722 cache entries
  written (every module a miss → fresh `esbuild.transformSync` → persisted).
- **Warm boot (populated cache):** 36.6 s to http-bind. **~51 % faster**
  (37.6 s saved) — entirely from skipping re-transpile of unchanged files.
- **No regressions:** zero "config does not have a default export" / "Storage
  driver … is not configured". The esbuild transform path produces correct
  module namespaces — the tsx-4.22 failure mode does not occur here.
- **CREATE:** new `routes.ts` → route auto-registered → `200`.
- **EDIT / HMR:** edit handler body → response reflects new value
  immediately; cache 722 → 724 (new content hash = new entry, old retained
  for GC). Content-hash keying makes stale serving structurally impossible —
  verified live.
- **ERROR MAPPING (headline acceptance test):** `throw` on a known line →
  stack frame `…\src\app\zzhmrtest\routes.ts:6:9` — original `.ts`, exact
  line/column, **not** a `.warlock/...` path, **not** a transpiled line.
  Passed with cache warm (served-from-cache entry still maps correctly).
- **DELETE:** route file removed → route `404`, home still `200`, app
  healthy.
- **Unit:** 20/20 `transpile-cache` vitest green; `tsc` clean on all
  changed files.

Caveat: cold/warm absolute numbers include framework startup (DB, manifest,
connectors); the cache only addresses the transpile share, which is the
delta shown. Numbers are a single run on one machine — indicative, not a
benchmark suite.

## Risks & open questions

- **esbuild ≠ tsx transform parity.** tsx layers some behavior over esbuild
  (certain tsconfig options, decorators/`useDefineForClassFields`,
  path-mapped imports inside transformed code). Must diff outputs on a
  representative sample (models with decorators, resources, config files)
  before flipping default. This is the top risk.
- **Decorators.** Cascade leans on decorators (`@RegisterModel`, relation
  decorators). esbuild's decorator handling vs tsx's must match the runtime
  semantics the framework expects. Explicit test case required.
- **tsconfig drift.** The options fingerprint must include every tsconfig
  field that affects output, or stale entries serve wrong code. Safer
  initial fingerprint: hash the resolved tsconfig compilerOptions blob
  wholesale rather than cherry-picking fields.
- **Cache poisoning across framework upgrades.** Bumping esbuild or the
  framework can change output for identical source. Include an esbuild
  version + a cache-format epoch in the options fingerprint so an upgrade
  invalidates everything automatically.
- **Windows path normalization.** Same class of bug as the `?v=N` version
  map. The cache key uses source *content*, not paths, so it's immune — but
  the `sourcefile` in maps must be normalized consistently or stack frames
  render with mixed slashes.

## Testing strategy

Mirror the empirical rigor used this phase — real dev boots, not just units:

- **Unit (vitest):** cache get/put/miss, hash stability, opts-fingerprint
  invalidation, GC eviction.
- **Cold vs warm boot:** measure boot time with cache empty vs warm on the
  real project; assert warm < cold by a meaningful margin and that a single
  changed file only re-transpiles that file.
- **Correctness:** HMR round-trip (edit controller → response reflects),
  model `$cleanup` (no "already registered"), circular-dep resources still
  resolve.
- **Error mapping (the headline acceptance test):** a service that throws
  at a known line; hit the route; assert the captured stack frame is
  `src/app/.../that-service.ts:<exactLine>:<exactCol>` — explicitly assert
  it is **not** a `.warlock/...` path and **not** the transpiled line
  number. Run it both with cache cold and warm (the map must be correct
  whether freshly transformed or served from cache).
- **Upgrade invalidation:** bump the cache epoch, assert every entry misses
  and re-transforms.

## Phase B — own the resolver (drop tsx from the framework)

Decided. Does **not** start until Phase A is shipped and measured. This
section is the scope so the end state is documented, not improvised.

### End state

- `@warlock.js/core` depends on **esbuild only** for the dev pipeline
  (transform from Phase A) plus `get-tsconfig` + `resolve-pkg-maps` for
  resolution. No `tsx` in `@warlock.js/core` dependencies.
- `tsx` becomes a **root devDependency of this monorepo only** — used
  solely to execute the framework's own TypeScript source in-place during
  framework development. A released Warlock project never installs or runs
  tsx. (Optional later: dogfood our own loader to run the monorepo too, and
  drop tsx entirely. Not required for "done".)

### What tsx's resolve() actually does (the parity surface)

Our hook currently delegates resolution to tsx via `nextResolve`. To drop
tsx we must reproduce, in our resolve hook, exactly what it does:

1. **tsconfig `paths` / `baseUrl` alias mapping.** The biggest one. App and
   framework code is saturated with mapped imports
   (`app/chats/models/chat`, `@warlock.js/cascade`, `@warlock.js/fs`).
   Wildcards (`@app/*`), multiple candidates per pattern, `baseUrl`
   anchoring, longest-prefix match semantics.
2. **Extensionless + `.js`→`.ts` ESM resolution.** `import "./x"` and
   `import "./x.js"` must resolve to `./x.ts`/`.tsx`. Directory `index`
   resolution.
3. **package.json `exports` / `imports` conditions.** Self-references
   (`@warlock.js/fs` resolving to its own `src/`), conditional exports
   (`import`/`require`/`types`/`default`), subpath patterns. This is what
   `resolve-pkg-maps` handles.
4. **Node resolution algorithm ordering.** The above must be tried in the
   correct order, mirroring Node's ESM algorithm, falling through to
   `nextResolve` (Node default) for bare node builtins and real npm
   packages we don't special-case.

`get-tsconfig` covers (1) and the tsconfig reading for (2).
`resolve-pkg-maps` covers (3). The glue that sequences them in Node's
order, and integrates with our existing `?v=N` stamping, is the work —
roughly "what tsx's resolver is," but scoped to our needs and owned by us.

### Design sketch (not final)

```
resolve(specifier, context, nextResolve):
  parentURL = stripVersion(context.parentURL)

  // 1. tsconfig paths / baseUrl
  aliased = tsconfigPaths.match(specifier)            // get-tsconfig
  if aliased: specifier = aliased

  // 2. relative / extensionless → .ts/.tsx/index
  if isRelative(specifier) or isAbsolute(aliased):
     resolved = probeExtensions(specifier, parentURL) // .ts .tsx /index.ts …
     if resolved: return stamp(resolved)

  // 3. bare specifier → package.json exports/imports
  if isBare(specifier):
     pkgResolved = resolvePkgMaps(specifier, parentURL) // resolve-pkg-maps
     if pkgResolved and underSrcRoot: return stamp(pkgResolved)
     // else fall through (real npm dep / node builtin)

  // 4. anything we didn't handle → Node default
  return nextResolve(specifier, { ...context, parentURL })
```

`stamp()` = the existing `?v=N` + `format:"module"` logic, unchanged. The
`format` bug from tsx 4.22 disappears entirely because we never read a
format off tsx's resolve — we set our own.

### Resolution test matrix (gate before flipping Phase B on)

This is the crux. Resolution bugs silently load the wrong file. Every row
is a fixture + assertion, run as part of the suite:

- tsconfig `paths`: exact alias, wildcard alias, multi-candidate pattern,
  longest-prefix wins, `baseUrl`-relative bare import.
- Extensions: `./x` → `x.ts`, `./x` → `x.tsx`, `./x.js` → `x.ts`,
  `./dir` → `dir/index.ts`, missing → clean error (not silent wrong file).
- package `exports`: self-reference (`@warlock.js/fs` → its `src/`),
  conditional `import` vs `require` vs `types`, subpath pattern
  (`pkg/sub/*`), `exports` "." sugar.
- Workspace: `@warlock.js/*` packages resolving across the monorepo,
  including `_package.json`-renamed ones via the tsconfig path map.
- Negative: bare npm dep falls through to Node default untouched; node:
  builtins untouched; a typo import yields ERR_MODULE_NOT_FOUND with the
  original specifier, not a mangled one.
- Cross-platform: every above row asserted with Windows-normalized paths
  (same bug class as the `?v=N` version map).
- Equivalence harness: for a sample of ~50 real imports across the project,
  assert our resolver returns the **same absolute file** tsx 4.21 resolves
  (capture tsx's answers once as a golden fixture).

### Phase B risks

- **Silent wrong-file resolution** — worst failure mode, no error, just
  wrong behavior. The equivalence harness against tsx 4.21 golden output is
  the primary defense; ship behind a flag with the option to fall back to
  tsx-resolve until the harness is green on the whole project.
- **`exports` map edge cases** — conditional/pattern exports are subtle;
  `resolve-pkg-maps` is tsx's own lib so parity is likely, but the *glue*
  ordering is ours to get right.
- **tsconfig features beyond paths** — `references`, `extends` chains,
  per-directory tsconfigs. `get-tsconfig` handles `extends`; project
  references are likely out of scope (flag if the monorepo uses them).
- **Effort** — this is the real engineering of the whole initiative. The
  transform half (Phase A) is days; the resolver half is the project. Do
  not start it until Phase A's gains are measured and justify continuing.

### Phase B progress (2026-05-18)

Built and verified, behind `devServer.ownResolver` (default off):

- `loader/resolve-capture.ts` — opt-in golden recorder
  (`WARLOCK_RESOLVE_CAPTURE`). Real boot captured **2851** resolutions
  (1904 relative, 303 tsconfig-alias, 404 `@warlock.js/*`, 231 bare-npm,
  9 `node:`).
- `loader/own-resolver.ts` — pure, injected (`pathsMatcher`,
  `fileExists`). Owns tsconfig `paths` (`get-tsconfig` createPathsMatcher)
  + TS extension/`index`/`​.js→.ts` probing; returns `null` to defer npm /
  `node:` / `file:` to Node default. No `resolve-pkg-maps` needed — the
  project's `@warlock.js/*` are tsconfig-aliased to `…/src` dirs, so
  index probing covers them; npm `exports` handled by Node default on the
  defer path.
- **Equivalence harness green on the first run: 0 mismatches / 2851**
  (1867 project-file resolutions reproduced exactly, rest correctly
  deferred). `own-resolver.equivalence.test.ts` (skips if golden absent).
- Initially wired behind `devServer.ownResolver`; fixed
  `ERR_LOADER_CHAIN_INCOMPLETE` (own-resolved results must
  `shortCircuit`).

### Simplification — all rollout flags removed (2026-05-18)

This framework version is unreleased with a single consumer (this
project, fully tested), so rollout-safety flags guard an audience that
doesn't exist. Removed:

- **`devServer.ownResolver`** — deleted; the own resolver is now the only
  resolver. tsx is never consulted for TypeScript.
- **`devServer.transpileCache` (on/off)** — deleted; esbuild transpile is
  unconditional and `.warlock/transpile` persistence is intrinsic.
- **`devServer.transpileCacheDebug`** — **kept** (deliberate debug aid,
  not rollout ceremony); doc updated (no longer "requires transpileCache").

The load hook now esbuild-transpiles **every** `.ts`/`.tsx` — project
`src/`, `@warlock.js/*` framework source, and `warlock.config.ts` alike —
not just stamped `src/` files. tsx self-registration removed from
`register-loader`; `tsx` removed from `@warlock.js/core` dependencies
(stays a **root devDependency** — this monorepo's launcher is still
`tsx ./@warlock.js/core/src/cli/start.ts`).

Pre-existing, out of scope (not a Phase B regression): editing a
*transitive dependency* of a route file doesn't auto-reload the route
(only the changed module HMRs; the dependent route isn't re-evaluated).
Flagged for a separate look.

### Phase B exit criteria

- ✅ Resolution test matrix + tsx-4.21 equivalence harness green across the
  whole project import graph (0/2851); resolver unchanged by the
  flag-removal.
- ✅ Full cold-boot + create + HMR + error-mapping + delete green on the
  fully-simplified path (esbuild transpiling **all** TS incl. framework +
  config): READY, home 200, 842 cache entries, error frame exact
  `routes.ts:5:9`, delete → 404. 38 unit tests green, tsc clean, no
  dangling refs to removed symbols.
- ✅ `@warlock.js/core` package.json no longer lists `tsx`; root keeps it
  as a devDependency for monorepo-source execution.

### Known gap (documented, not a blocker)

This repo always boots via the **tsx CLI launcher**, so tsx's loader is
present in-process regardless — our hooks short-circuit it for all TS, so
the run *is* representative of the no-tsx TypeScript path. What cannot be
exercised here is a true released `node bin/warlock.js` start (no tsx in
`node_modules` at all). That validation belongs in the release pipeline
as a smoke test; until then "released project runs with zero tsx" is
asserted by construction (no tsx code path remains for TS), not by a live
released-binary run.

## Decisions (locked 2026-05-18)

1. **Cache location: `.warlock/transpile/`.** Discoverable, and `--fresh`
   can nuke it trivially with the rest of `.warlock`.
2. **Map delivery: inline base64.** Self-contained, fewest moving parts,
   immune to the `?v=N` URL quirk.
3. **tsx Phase B: yes** — commit to dropping tsx from the framework (see
   "Phase B — own the resolver"). Sequencing holds: Phase A keeps
   tsx-on-resolve; Phase B does not start until Phase A is shipped and its
   gains measured.
