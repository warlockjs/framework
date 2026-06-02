# How the dev server works

> Canonical walkthrough of the post-rebuild dev server. If you're trying to
> debug HMR, add a new file kind, or just figure out who owns what — start
> here.

## The 30-second mental model

The dev server is three threads cooperating through a shared map of
file metadata and a `MessageChannel`:

```
┌──────────────────────────────────────────────────────────────────┐
│  Main thread                                                     │
│  ┌─────────────────────────┐   ┌─────────────────────────────┐   │
│  │ FilesOrchestrator       │   │ DevelopmentServer           │   │
│  │  • file map (FileManager)│  │  • boot orchestration       │   │
│  │  • dependency graph     │◄──┤  • batch event handler      │   │
│  │  • manifest (warm cache)│   │  • LayerExecutor            │   │
│  │  • watcher → handler    │   │  • connector lifecycle      │   │
│  └────────────┬────────────┘   └─────────────────────────────┘   │
│               │ MessageChannel (bump / sync / sync-ack)          │
└───────────────┼──────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  Loader-hook worker (Node module.register worker)                │
│  ┌──────────────────┐  ┌────────────────┐  ┌───────────────────┐ │
│  │ resolve()        │  │ load()         │  │ version-registry  │ │
│  │  • stamp ?v=N    │  │  • strip ?v=N  │  │  Map<path, N>     │ │
│  │  • delegate tsx  │  │  • delegate tsx│  │  normalised keys  │ │
│  └──────────────────┘  └────────────────┘  └───────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                ▲
                │ chokidar fs events (change / add / unlink)
┌───────────────┴──────────────────────────────────────────────────┐
│  Watcher thread (chokidar internals)                             │
│  Watches: src/  +  .env*  +  warlock.config.ts                   │
└──────────────────────────────────────────────────────────────────┘
```

Everything else is bookkeeping around those three actors.

## The core idea: `?v=N` URLs as the cache-busting mechanism

Node caches modules by **URL**. Two URLs that differ only by query string
(`./user.ts?v=0` vs `./user.ts?v=1`) are two different cache entries to
Node. The dev server exploits this to do HMR without rewriting imports,
without a userland module cache, and without breaking native ESM cycle
semantics.

When you save a file:

1. Main thread sends a `bump` message to the hook worker.
2. Hook worker increments that file's counter in its `versionMap`.
3. Main thread imports the file. The hook's `resolve()` stamps the
   current counter onto the URL: `file:///.../user.ts?v=1`.
4. Node sees a URL it has never seen, treats it as a fresh module, asks
   the hook to `load()` it, and tsx transpiles fresh from disk.
5. The file's static `import` statements are re-resolved through the
   hook too — the same versioning kicks in for any of *their* deps that
   were also bumped. The dep graph is invalidated transitively without
   userland having to touch Node's module cache directly.

That's it. The rest of this doc is the choreography around that
mechanism.

## Boot sequence

When `yarn dev` (or equivalent) runs, [`DevelopmentServer.start()`](../../../@warlock.js/core/src/dev-server/development-server.ts:31)
executes these phases **in order**. Skipping or reordering breaks
things in subtle ways.

### 1. `--fresh` handling

If the flag was passed and `.warlock/manifest.json` exists, delete it.
This forces reconciliation to re-parse every file from disk instead of
restoring metadata from the cached manifest. The loader hook owns
transpile caching in memory; there is **no on-disk transpile cache** to
clear.

### 2. `filesOrchestrator.init()`

Three sub-steps:

- Initialise `es-module-lexer` (one-time wasm load).
- Ensure `.warlock/` exists.
- **Register the loader hook**:
  - esbuild bundles
    [`hook-thread.ts`](../../../@warlock.js/core/src/dev-server/loader/hook-thread.ts)
    into plain ESM (the hook worker has no tsx).
  - Write the bundle to `.warlock/loader-hook.mjs`.
  - Open a `MessageChannel` and `module.register(bundlePath, importMeta.url, { data: { port: port2, srcRoot }, transferList: [port2] })`.
  - Attach a `sync-ack` listener to `port1` on the main side. This
    listener drains the `pendingFlushes` queue when the hook worker
    acknowledges a bump batch.

After `init()`, every subsequent dynamic `import()` Node performs
flows through the hook.

### 3. `filesOrchestrator.initializeAll()`

- Glob `src/**/*.{ts,tsx}` for the disk truth.
- Read `.warlock/manifest.json` if present.
- **No manifest** → cold path: process every file (read source, hash,
  parse imports) in batches.
- **Manifest exists** → reconcile:
  - `newFiles`: in disk but not manifest → full process.
  - `deletedFiles`: in manifest but not disk → drop from manifest +
    file map.
  - `existingFiles`: in both → `FileManager.init(manifestEntry)`. If
    the on-disk hash matches the manifest hash, dep metadata is
    restored from JSON without re-parsing. If it differs, force a
    re-parse.
- Build the dependency graph from the populated file map.
- Persist the new manifest.

This is the warm-start trick: 989 unchanged files restore from
manifest in ~hundreds of milliseconds instead of re-parsing all of
them.

### 4. `watchFiles()`

chokidar starts watching:
- `src/` (the app code)
- All `.env*` variants at project root
- `warlock.config.ts` at project root

Events go through
[`FileEventHandler`](../../../@warlock.js/core/src/dev-server/file-event-handler.ts)
which debounces 150ms and emits batched `dev-server:batch-complete`
events.

### 5. `specialFilesCollector.collect()`

Iterates the file map once and categorises each file into one of five
buckets:

| Bucket    | Pattern                                            |
| --------- | -------------------------------------------------- |
| `config`  | `src/config/**/*.{ts,tsx}`                         |
| `main`    | `src/app/<module>/main.{ts,tsx}` or `src/app/main` |
| `route`   | `src/app/<module>/routes.{ts,tsx}`                 |
| `event`   | `src/app/<module>/events/*.{ts,tsx}`               |
| `locale`  | `src/app/<module>/utils/locales.{ts,tsx}`          |

The collector is the source of truth for "what files should the dev
server eagerly load at boot".

### 6. `autoDiscoverFiles()`

Eagerly `import()` every file whose `FileManager.type === "model"`.
Models have decorators (`@RegisterModel()` and friends from Cascade)
that populate global registries. Those registries need to be filled
**before** routes/services try to resolve symbols by name — hence
the eager pass.

### 7. `moduleLoader.loadAll()`

Imports special files in this exact order:

```
locale → event → main → route
```

Why this order:
- Locales register translations everything else might use.
- Events register listeners that main code can fire.
- Main files run boot logic (singletons, container bindings).
- Routes bind handlers last so they see the fully-initialised state.

Each special file is imported through the loader hook (so transpile
happens on demand). Route files are wrapped in
`router.withSourceFile(relativePath, load)` so every `router.get(...)`
they register carries its origin path — that's what makes
`removeRoutesBySourceFile()` work later.

### 8. Late-phase connector start

`connectorsManager.startPhase(ConnectorLifecyclePhase.Late)` boots
connectors that depend on app state being registered — the http
server (which needs routes) and the socket server (which needs
listeners). Early-phase connectors (database, logger, cache) booted
much earlier in the bootstrap path before any user code ran.

### 9. `new LayerExecutor(...)`

Constructed with closures over the orchestrator's `bumpVersion` and
`flushVersionBumps` methods. The executor is the dispatcher that turns
"these files changed" into "these reloads happen". Until this exists,
HMR is inert — file changes during phases 1-8 are intentionally
ignored (the orchestrator's `running` flag is false).

### 10. Mark ready, fire background work

- Set `running = true`.
- Print the "Development Server is ready in Xs" line.
- Kick off type generation in the background (non-blocking).
- Kick off file health checkers in the background (non-blocking).

Boot done. From here, the dev server is event-driven.

## The loader hook in detail

Lives entirely in
[`@warlock.js/core/src/dev-server/loader/`](../../../@warlock.js/core/src/dev-server/loader/):

| File                    | Role                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `register-loader.ts`    | Main-thread side. Bundles + registers the hook, opens the MessageChannel. |
| `hook-thread.ts`        | Worker-thread entry. Wires `initialize`, `resolve`, `load` exports.       |
| `resolve-hook.ts`       | Stamps `?v=N` onto src/ URLs after delegating to tsx.                     |
| `load-hook.ts`          | Strips `?v=N` before delegating to tsx's loader.                          |
| `version-registry.ts`   | Worker-local `Map<normalisedPath, counter>`.                              |

### How `resolve()` runs (the hot path)

```ts
resolve(specifier, context, nextResolve):
  // 1. Strip ?v=N from parentURL so tsx's URL joining works correctly.
  cleanContext = stripVersionFromParent(context)

  // 2. Let tsx handle the actual resolution (path mapping, extensions, etc.)
  result = await nextResolve(specifier, cleanContext)

  // 3. Only stamp version on files inside the project's src/.
  if (!result.url.startsWith(srcRootUrl)) return result
  if (!result.url.endsWith(".ts" or ".tsx")) return result

  // 4. Look up version and append.
  version = getVersion(fileURLToPath(cleanUrl))
  return { ...result, url: `${cleanUrl}?v=${version}`, shortCircuit: true }
```

Two non-obvious details:

**Spreading `...result` is load-bearing.** tsx sets `format: "module"`
on resolution results. Dropping that field makes Node's loader fall
through to the default extension handler, which rejects `.tsx`. Always
spread.

**Stripping `?v=N` from `parentURL` is load-bearing.** When a v1
module statically imports a relative sibling, Node uses the v1 URL as
the `parentURL` for the next resolve. If we pass that through
unmodified, tsx joins the query suffix into the resolved path and
produces nonsense like `./sibling.ts?v=1`. Strip first, version
later.

### Path normalisation (the bug we hit twice)

Windows and POSIX disagree on path separators. The main thread holds
absolute paths with forward slashes
(`D:/xampp/.../user.ts`). The hook worker's `fileURLToPath()` returns
Windows-native paths with backslashes
(`D:\xampp\...\user.ts`). Different strings → different map keys → the
hook returns version 0 forever and HMR silently fails.

The fix lives in
[`version-registry.ts`](../../../@warlock.js/core/src/dev-server/loader/version-registry.ts):

```ts
function normalizeKey(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/").toLowerCase();
}
```

Every read and write to the version map normalises first. Always.

## HMR cycle on edit

When you save `src/app/shared/controllers/home-page.controller.tsx`:

### Step 1 — Watcher fires

chokidar emits a `change` event. The watcher thread forwards it to the
main thread, which calls `FileEventHandler.handleFileChange(absPath)`.

### Step 2 — Debounce + batch

`processPendingEvents = debounce(processBatch, 150ms)`. Other editor
save events that land in the next 150ms join the same batch (handy
when format-on-save fires multiple events for one user keystroke).

### Step 3 — `processBatch()`

```
changes = pending.changes
adds    = pending.adds
deletes = pending.deletes
clear pending

// External paths (env files, warlock.config.ts) never enter the dep graph
// — they only ride along in the batch event so DevelopmentServer can react.
codeChanges = changes filter !isExternalPath
codeAdds    = adds    filter !isExternalPath

// On multi-file batches, give the filesystem a moment to settle (Windows).
if (codeAdds + codeChanges > 1) wait 500ms

processBatchAdds(codeAdds)         // fileOperations.addFile each
processBatchChanges(codeChanges)   // fileOperations.updateFile each
processBatchDeletes(deletes)       // fileOperations.deleteFile each

fileOperations.updateFileDependents()
fileOperations.syncFilesToManifest()
manifest.save()

emit "dev-server:batch-complete" { added, changed, deleted }
```

### Step 4 — `DevelopmentServer.handleBatchComplete(batch)`

- If `running === false` (still booting), drop the batch.
- If `warlock.config.ts` is in `changed` → print "restart required"
  warning. Settings like CLI command registration, watch patterns, and
  scheduled jobs are read at boot and aren't safely hot-swappable.
- Drop no-op changes (some editors fsync without writing — the content
  hash still matches, so we skip).
- Filter env files out of `codeFiles` (they trigger config reloads,
  not transpile).
- Call `layerExecutor.executeBatchReload(codeFiles, fileMap, deleted, allChanged)`.
- After reload, kick `typeGenerator` + `checkHealth` in the background.

### Step 5 — `LayerExecutor.executeBatchReload()`

This is the meat. Five sub-phases:

```
─ Phase A: invalidation chain ────────────────────────────────────
chain = new Set()
for each changed path:
  chain.union( dependencyGraph.getInvalidationChain(path) )

─ Phase B: bump versions ─────────────────────────────────────────
for each file in chain:
  moduleLoader.runCleanup(file)          // run user cleanup hooks
  bumpVersion(file.absolutePath)         // postMessage to hook worker
  file.process({ force: true })          // re-parse for dep graph

─ Phase C: flush ─────────────────────────────────────────────────
await flushVersionBumps()
// Sends { type: "sync" }, awaits { type: "sync-ack" } from hook worker.
// Guarantees every prior bump has been processed before we proceed.

─ Phase D: reload affected special files ────────────────────────
configPaths = []
for each affected config:
  configManager.reload(file)
  configPaths.push(file.relativePath)

// Order matters: locale → main → event → route
for each affected locale: moduleLoader.reloadModule(file)
for each affected main:   moduleLoader.reloadModule(file)
for each affected event:  moduleLoader.reloadModule(file)
for each affected route:  moduleLoader.reloadModule(file)

// If no special file was touched, the dep chain's last hop is usually
// the user-facing edge — give it a kick.
if no special files affected and chain.last exists:
  moduleLoader.reloadModule(chain.last)

─ Phase E: restart affected connectors ──────────────────────────
for each connector:
  if connector.shouldRestart([...changedPaths, ...configPaths]):
    await connector.restart()  // shutdown + start
```

### Step 6 — `moduleLoader.reloadModule(file)`

For a route file:

```
1. cleanupFileModule(file)               // run + clear cleanup hooks
2. router.removeRoutesBySourceFile(file.relativePath)
3. loadedModules.delete(file.absolutePath)
4. await loadModule(file, "route")
   ├─ withSourceFile(file.relativePath, () => import(fileUrl))
   ├─ resolve() in hook returns fileUrl?v=N  (N is the bumped value)
   ├─ Node cache miss → load → tsx transpiles fresh from disk
   ├─ Top-level code runs: router.get("/", ...) re-registers route
   └─ registerCleanup() scans new module exports for cleanup hooks
```

For a config file:

```
1. configManager.reload(file)  → import(fileUrl) → set into global config
```

For everything else (no special handling needed): the file just won't
be re-imported until something else imports it; when that happens the
hook's `?v=N` ensures freshness.

## The flush protocol (don't skip this)

`postMessage` is **async**. The hook worker may not have processed a
bump message before our next `import()` call resolves. If the worker is
still on `version=0` when resolve runs, Node returns the cached old
module and HMR silently fails — the symptom is "I edited the file but
the change didn't take effect".

`flushVersionBumps()` solves this by sending a `sync` sentinel after
all the bumps and awaiting `sync-ack`:

```
Main side                                Worker side
─────────                                ───────────
bumpVersion(A.ts)  ─postMessage─►        on "bump A.ts": map.set(A, 1)
bumpVersion(B.ts)  ─postMessage─►        on "bump B.ts": map.set(B, 1)
flushVersionBumps:
  pendingFlushes.push(resolve)
  postMessage({type: "sync"}) ─►         on "sync": postMessage({type: "sync-ack"})
                                  ◄─postMessage
  on "sync-ack": pendingFlushes.shift()()
  // resolve fires — flushVersionBumps() returns

// only NOW do we call import() — guaranteed fresh ?v=1
```

MessagePort messages are processed in order, so once the worker has
processed `sync`, every prior `bump` has already been applied.

## How specific file kinds are handled

### Code files inside `src/`

Standard path: enter the dep graph, version-stamped on import,
HMR'd as described above.

### `.env*` files

Watched but never tracked by the dep graph. When changed:
- `FileEventHandler` lets them through to the batch event but filters
  them out of `fileOperations` calls.
- `LayerExecutor.executeBatchReload` detects env-only changes:
  - `loadEnv()` re-reads the env file(s) into `process.env`.
  - Every config file is treated as "affected" (env values feed into
    config bodies).
  - Each affected config is `configManager.reload()`'d.
  - Connectors whose `watchedFiles` include the reloaded configs
    (e.g. database connector watches `src/config/database.ts`)
    get restarted.

### `warlock.config.ts`

Watched but not tracked or reloaded. When changed, a warning is
printed:

```
warlock.config.ts changed — restart the dev server to apply.
```

Why no hot reload: the file holds CLI command registrations, scheduled
job declarations, build options, and watch patterns. These are read
once at boot and aren't safely mutable — hot-reloading would leave
running services configured with stale values, which is worse than the
honest "restart needed" signal.

### Deleted files

`fileOperations.deleteFile(path)`:
- Pull `dependents` from the dep graph **before** removal.
- Remove from dep graph, special-files collector, manifest.
- For each dependent: emit `FILE_READY` so it surfaces a broken-import
  error if it referenced us.
- Delay the actual `files.delete(path)` by 300ms so in-flight reads
  still find the FileManager.

For special files (routes etc.), `moduleLoader.cleanupDeletedModule`
also runs `removeRoutesBySourceFile` and the file's cleanup hooks.

## The dependency graph

Lives in
[`dependency-graph.ts`](../../../@warlock.js/core/src/dev-server/dependency-graph.ts).
Two maps:
- `dependencies`: file → set of files it imports
- `dependents`: file → set of files that import it

`getInvalidationChain(file)` does a BFS over `dependents` to find the
transitive closure of files that need to be re-imported when `file`
changes.

Type-only edges (`import type { ... }`) are tracked separately in
`FileManager.typeOnlyDependencies` and skipped during cycle detection —
they have no runtime effect.

On boot, the graph also detects circular dependencies and prints a
formatted warning. The hint is **tailored** based on file types:

- Both files are `*.resource.ts` or `*.model.ts` → recommend `lazy()`
  (Cascade's purpose-built solution for circular relations).
- Anything else → recommend converting one edge to a dynamic
  `import()`.

## Connectors and restart logic

A connector is anything with a `start/shutdown/restart` lifecycle and a
list of `watchedFiles`. Defined in
[`@warlock.js/core/src/connectors/`](../../../@warlock.js/core/src/connectors/):
database, http, socket, mail, cache, logger, herald, storage.

Two lifecycle phases:

- **Early** (database, logger, cache, mailer, herald, storage) — boot
  before app code runs. Things app code might call during initialisation.
- **Late** (http, socket) — boot after app code has registered routes
  and listeners. Things that need user state to be in place.

`connector.shouldRestart(changedFiles)` returns `true` if any
changed file matches the connector's `watchedFiles`. For example,
`DatabaseConnector.watchedFiles = ["src/config/database.ts"]`, so any
change that reloads that config triggers a DB reconnect.

## What lives in `.warlock/`

After boot:

```
.warlock/
├── loader-hook.mjs   # bundled hook (regenerated every boot)
├── manifest.json     # dep graph + hashes for warm start
├── commands.json     # discovered CLI commands cache
└── typings/          # generated *.d.ts for app code
```

**Not** there any more:
- `cache/` — gone. The loader hook owns transpile (in memory). No on-disk
  transpile cache exists.

`--fresh` deletes `manifest.json` to force full re-parse on next boot.

## File map: where things live

| Concern                          | File                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Boot orchestration               | [`development-server.ts`](../../../@warlock.js/core/src/dev-server/development-server.ts) |
| File map + watcher wiring        | [`files-orchestrator.ts`](../../../@warlock.js/core/src/dev-server/files-orchestrator.ts) |
| Per-file metadata + process()    | [`file-manager.ts`](../../../@warlock.js/core/src/dev-server/file-manager.ts)     |
| Add/update/delete a file         | [`file-operations.ts`](../../../@warlock.js/core/src/dev-server/file-operations.ts) |
| Watcher event → batch            | [`file-event-handler.ts`](../../../@warlock.js/core/src/dev-server/file-event-handler.ts) |
| chokidar setup                   | [`files-watcher.ts`](../../../@warlock.js/core/src/dev-server/files-watcher.ts)   |
| Decide what to reload            | [`layer-executor.ts`](../../../@warlock.js/core/src/dev-server/layer-executor.ts) |
| Import + reload modules          | [`module-loader.ts`](../../../@warlock.js/core/src/dev-server/module-loader.ts)   |
| Categorise files (config/route…) | [`special-files-collector.ts`](../../../@warlock.js/core/src/dev-server/special-files-collector.ts) |
| Dep graph + cycle detection      | [`dependency-graph.ts`](../../../@warlock.js/core/src/dev-server/dependency-graph.ts) |
| Manifest persistence             | [`manifest-manager.ts`](../../../@warlock.js/core/src/dev-server/manifest-manager.ts) |
| Loader hook bundling + register  | [`loader/register-loader.ts`](../../../@warlock.js/core/src/dev-server/loader/register-loader.ts) |
| Hook worker entry                | [`loader/hook-thread.ts`](../../../@warlock.js/core/src/dev-server/loader/hook-thread.ts) |
| URL versioning on resolve        | [`loader/resolve-hook.ts`](../../../@warlock.js/core/src/dev-server/loader/resolve-hook.ts) |
| URL stripping on load            | [`loader/load-hook.ts`](../../../@warlock.js/core/src/dev-server/loader/load-hook.ts) |
| Version map                      | [`loader/version-registry.ts`](../../../@warlock.js/core/src/dev-server/loader/version-registry.ts) |
| Parse imports                    | [`parse-imports.ts`](../../../@warlock.js/core/src/dev-server/parse-imports.ts)   |

## Known limitations (the honest list)

- **Cold start is ~12-15s** on a ~1000-file project. Most of that is
  tsx transpile + database connect + initial route registration. Could
  be ~8s with more parallelism; not currently a priority.
- **`warlock.config.ts` changes require manual restart.** We warn but
  don't auto-restart. A supervisor wrapper around tsx could do this
  later.
- **Stack traces show `?v=N` in URLs.** Cosmetic but annoying.
- **No source map preservation on HMR re-imports.** tsx provides source
  maps for the initial transpile; whether they survive the `?v=N`
  re-import is inconsistent.
- **Single-pass dep graph build.** If you create a complex circular
  import graph at runtime, the graph won't always pick it up until the
  next batch. In practice this is fine because circular runtime imports
  are already broken — see Cascade's `lazy()` for the right answer.

## Mental model summary

When you're debugging dev server behaviour, ask in this order:

1. **Is the file watched?** Check `files-watcher.ts` paths. If it's
   outside `src/`, `.env*`, or `warlock.config.ts`, chokidar isn't
   seeing it.
2. **Is the file tracked?** `filesOrchestrator.files.has(relativePath)`.
   If `isExternalPath(p)` returns true, it's intentionally excluded.
3. **Did the version bump?** Look at `versionMap` in the worker
   (instrument with `process.stderr.write` temporarily). If always 0,
   it's a path-normalisation problem.
4. **Did the flush land?** If your import resolves before the bump is
   applied, Node serves the cached module. Ensure
   `flushVersionBumps()` is awaited between bump and re-import.
5. **Was the right special file reloaded?** Check
   `reloadAffectedModules` — `isFileAffected` should return true for
   the file you care about (it's in the chain or imports something in
   the chain).
6. **Did the connector restart?** `shouldRestart` checks
   `watchedFiles`. If your config reloaded but the connector didn't
   restart, its `watchedFiles` doesn't list the right path.

If you've gone through this list and HMR still misbehaves, the bug is
almost certainly in one of these three places:

- Path normalisation between main thread and hook worker.
- Race condition between `bumpVersion` and `import()` (missing flush).
- Special-files collector classifying a file wrong (so `isAffected`
  returns false for what should be a reload).

Welcome back, future-me.
