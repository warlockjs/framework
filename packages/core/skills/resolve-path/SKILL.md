---
name: resolve-path
description: 'Path helpers anchored at `process.cwd()` — `rootPath`, `srcPath`, `appPath`, `configPath`, `publicPath`, `storagePath`, `uploadsPath`, `cachePath`, `logsPath`, `tempPath`, `warlockPath`, `sanitizePath`. Optional `uploads.root` config overrides the uploads anchor. Triggers: `appPath`, `configPath`, `uploadsPath`, `storagePath`, `publicPath`, `cachePath`, `logsPath`, `tempPath`, `sanitizePath`, `paths`; "resolve a path inside src/app", "absolute upload destination", "sanitize a user filename", "ship uploads to a mounted volume"; typical import `import { appPath, uploadsPath } from "@warlock.js/core"`. Skip: HTTP URL helpers — `@warlock.js/core/build-url/SKILL.md`; app metadata — `@warlock.js/core/use-app-context/SKILL.md`; storage abstraction — `@warlock.js/core/store-file/SKILL.md`; competing patterns: `path.join(process.cwd(), ...)`, hand-rolled directory constants.'
---

# Warlock — resolve a path

Twelve helpers, all anchored at `process.cwd()`, all in `@warlock.js/core`. They exist so you don't re-parse `process.cwd()` in every call site or hand-roll `path.join` for the same five locations.

## The shape

```ts
import { appPath, configPath, uploadsPath, storagePath } from "@warlock.js/core";

appPath("orders/routes.ts");           // → <cwd>/src/app/orders/routes.ts
configPath("http.ts");                  // → <cwd>/src/config/http.ts
uploadsPath("avatars/42.png");          // → <cwd>/storage/uploads/avatars/42.png
storagePath("backups/2026-01.tar.gz");  // → <cwd>/storage/backups/2026-01.tar.gz
```

Every helper takes any number of path segments and joins them. No-argument calls return the base directory itself.

## Full inventory

| Helper             | Resolves to                              | Notes                                                              |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------ |
| `rootPath(...p)`   | `<cwd>/<...p>`                           | Also `Application.rootPath`. Base of every other helper.           |
| `srcPath(...p)`    | `<cwd>/src/<...p>`                       | Also `Application.srcPath`.                                        |
| `appPath(p?)`      | `<cwd>/src/app/<p>`                      | Also `Application.appPath`. Module roots live here.                |
| `configPath(...p)` | `<cwd>/src/config/<...p>`                | `src/config/*.ts` subsystem configs.                               |
| `publicPath(p?)`   | `<cwd>/public/<p>`                       | Also `Application.publicPath`. Static assets served as-is.         |
| `storagePath(p?)`  | `<cwd>/storage/<p>`                      | Also `Application.storagePath`. Root for framework-managed files.  |
| `uploadsPath(p?)`  | `<cwd>/storage/uploads/<p>` *(default)*  | Also `Application.uploadsPath`. Honors `config.uploads.root` override (string or function). |
| `cachePath(p?)`    | `<cwd>/storage/cache/<p>`                | Persistent cache files.                                            |
| `logsPath(p?)`     | `<cwd>/storage/logs/<p>`                 | Application logs.                                                  |
| `tempPath(p?)`     | `<cwd>/storage/tmp/<p>`                  | Throw-away scratch.                                                |
| `warlockPath(...p)` | `<cwd>/.warlock/<...p>`                 | Framework internals (manifest, transpile cache, typings). **Never write app files here** — the framework deletes the folder freely. |
| `sanitizePath(p)`  | Strips `<>:"/\|?*` from `p`              | Cleans user-supplied filename fragments before joining.            |

## The aggregate — `paths`

For builders or maintenance scripts that shuttle several locations in close proximity, use the `paths` object — a short-alias view over every helper:

```ts
import { paths } from "@warlock.js/core";

paths.root("dist", "app.js");        // → <cwd>/dist/app.js
paths.app("orders/routes.ts");        // → <cwd>/src/app/orders/routes.ts
paths.uploads("avatars/42.png");      // → <cwd>/storage/uploads/avatars/42.png
paths.config("mail.ts");              // → <cwd>/src/config/mail.ts
paths.cache("queries.bin");           // → <cwd>/storage/cache/queries.bin
paths.logs("errors.log");             // → <cwd>/storage/logs/errors.log
paths.temp("tmp-export.csv");         // → <cwd>/storage/tmp/tmp-export.csv
paths.warlock("manifest.json");       // → <cwd>/.warlock/manifest.json
paths.sanitize("../etc/passwd");      // → "..etcpasswd"
```

Use the named import (`appPath`, `uploadsPath`, ...) when one helper dominates the file; reach for `paths.*` when you're shuttling multiple paths together.

## Patterns

### Read a file inside a module

```ts
import { appPath } from "@warlock.js/core";
import { readFile } from "node:fs/promises";

const template = await readFile(
  appPath("mailers/templates/welcome.html"),
  "utf-8",
);
```

### Locate a config file

```ts
import { configPath } from "@warlock.js/core";

const httpConfigFile = configPath("http.ts");
```

### Compute an absolute upload destination

```ts
import { uploadsPath } from "@warlock.js/core";

const avatar = uploadsPath(`avatars/${userId}/profile.png`);
```

### Sanitize a user-supplied filename before joining

```ts
import { sanitizePath, uploadsPath } from "@warlock.js/core";

const safe = sanitizePath(req.input("filename"));
const dest = uploadsPath(`exports/${safe}`);
```

`sanitizePath` strips characters that are illegal in filenames on Windows (`<>:"/\|?*`) and that enable path traversal. **Always** sanitize before joining user input into an `uploadsPath` / `tempPath` / any persistence helper.

### Read framework metadata (rare)

```ts
import { warlockPath } from "@warlock.js/core";

const manifest = warlockPath("manifest.json");
```

`.warlock/` is the framework's scratch space — manifests, transpile cache, generated typings. Reading is occasionally useful for diagnostics. **Writing** is a defect; the framework deletes the folder whenever it feels like it.

## Overriding the uploads root

`uploadsPath` is the only helper with a config override. Set `uploads.root` in `src/config/uploads.ts` to a string (static directory) or a function `(relativePath) => string` (dynamic per-call). Useful when you've moved user uploads onto a mounted volume:

```ts title="src/config/uploads.ts"
export default {
  uploads: {
    root: "/mnt/uploads",                   // static
    // root: (rel) => `/mnt/uploads/${rel}`, // dynamic
  },
};
```

After this, `uploadsPath("avatars/42.png")` resolves to `/mnt/uploads/avatars/42.png`. Other helpers continue resolving against `process.cwd()`.

When to reach for the function form:

- Per-tenant uploads (`(rel) => /mnt/${tenant.id}/${rel}`).
- Per-environment routing (production → S3-mounted volume, dev → local).
- Date-based shards (`(rel) => /mnt/uploads/${YYYY-MM}/${rel}`).

When to keep it as a static string: everything else. The function form is per-call overhead.

### What "override" means

The override is applied **inside** `uploadsPath()`. So `Application.uploadsPath` (the no-arg getter on the `Application` class) also respects it. Other helpers — `storagePath`, `cachePath`, `logsPath`, `tempPath` — continue resolving against `<cwd>/storage`, even though they're conceptually "under" the same root. If you want all of those redirected too, your deployment should mount the whole `storage/` folder, not just `storage/uploads`.

## When to use which

| Goal                                       | Helper            |
| ------------------------------------------ | ----------------- |
| File inside a module (controllers/services) | `appPath`        |
| Top-level subsystem config                 | `configPath`      |
| Static asset served as-is over HTTP        | `publicPath`      |
| User-uploaded file (avatar, document)      | `uploadsPath`     |
| Persistent cache for an expensive op       | `cachePath`       |
| Application log line                       | `logsPath`        |
| Short-lived scratch (cleaned aggressively) | `tempPath`        |
| Bundled artifact (build outputs)           | `rootPath("dist", ...)` |
| Reading a TS source from disk              | `srcPath` / `appPath` |
| Framework internals (manifest, transpile)  | `warlockPath` *(read-only)* |

If you find yourself reaching for `path.join(process.cwd(), ...)` — that's a sign you want one of these helpers instead.

## Gotchas

- **Paths depend on `process.cwd()`.** If something `process.chdir()`s, the paths shift. Warlock never does this; if you do, you've broken every path lookup.
- **`warlockPath` is read-only from app code.** The framework deletes `.warlock/` on dev restart, build clean, etc. Anything you write there is collateral damage on the next run.
- **`sanitizePath` strips, doesn't reject.** It replaces illegal characters with empty string — `../foo/bar` becomes `..foobar`, not an error. If you want a hard refusal on traversal attempts, validate upstream first (e.g. seal schema rule).
- **`storagePath` vs `uploadsPath`.** Storage is the framework-managed root (logs, cache, temp, uploads sit under it). Uploads is the user-content subfolder. Don't write app logs into `uploadsPath` or user files into `logsPath`.
- **`uploads.root` override is read at call time.** Changing config mid-process is honored on the next `uploadsPath()` call. Useful in tests; don't rely on it in request handlers.
- **No helper covers `node_modules`.** If you need an `node_modules/<pkg>` path, use `rootPath("node_modules", "<pkg>")` — there's no `vendorPath`.

## See also

- [`build-url/SKILL.md`](../build-url/SKILL.md) — HTTP URL helpers (`url`, `uploadsUrl`, `publicUrl`, `assetsUrl`) — companion for rendering URLs (not filesystem paths).
- [`use-app-context/SKILL.md`](../use-app-context/SKILL.md) — `Application` static (env, runtime strategy, version, uptime) + `app` runtime accessor (Fastify, socket.io, router, database).
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `src/config/uploads.ts` for the `root` override.
- [`store-file/SKILL.md`](../store-file/SKILL.md) — the storage abstraction (most uploads code goes through `storage.put(...)`, not raw paths).
- [`upload-file/SKILL.md`](../upload-file/SKILL.md) — the `UploadedFile` shape that pairs with `uploadsPath`.
