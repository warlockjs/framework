---
name: warlock-routes
description: 'Run `warlock routes` — a read-only command that lists the registered HTTP routes as a verb-colored table (method / path / name / action / middleware-count / source), a sibling of `warlock doctor`. Filter with `--method` / `--path` / `--name`, or emit normalized rows as JSON with `--json`. Also covers `warlock routes:diff`, which compares live page routes against the last `warlock build`''s route snapshot and exits non-zero on drift. Triggers: `warlock routes`, `routesCommand`, `warlock routes:diff`, `routesDiffCommand`, "list my routes", "show all routes", "route table", "what endpoints does my app expose", "dump routes as JSON", "which routes have middleware", "route map for CI", "did my page routes drift from the last build"; run as `pnpm warlock routes` / `pnpm warlock routes:diff`. Skip: read-only health/preflight checks — `@warlock.js/core/warlock-doctor/SKILL.md`; defining/naming/grouping routes — `@warlock.js/core/register-route/SKILL.md`; authoring a general CLI command — `@warlock.js/core/write-cli-command/SKILL.md`; competing tools `nest`/`express` route listers, `php artisan route:list`.'
---

# Warlock — `warlock routes`

`warlock routes` lists every registered HTTP route as a table. It's the read-only sibling of [`warlock doctor`](../warlock-doctor/SKILL.md): it boots the app far enough to register route modules — but **starts no connectors**, so it never opens a database, cache, or socket connection.

```bash
pnpm warlock routes
```

```
METHOD  PATH              NAME           ACTION    MW  SOURCE
GET     /users            users.list     index     2   app/users/routes.ts
POST    /users            users.create   store     2   app/users/routes.ts
GET     /users/:id        users.get      show      2   app/users/routes.ts
DELETE  /users/:id        users.delete   destroy   3   app/users/routes.ts

4 routes (2 GET · 1 POST · 1 DELETE)
```

The `METHOD` column is verb-colored (GET green, POST blue, PUT/PATCH yellow, DELETE red, `all`/OPTIONS/HEAD dim). Rows sort by path, then by HTTP-method order within a path.

## Columns

| Column   | Meaning                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| `METHOD` | HTTP verb; a wildcard `all` route lists as `ALL`.                             |
| `PATH`   | Full request path (group prefix already folded in).                           |
| `NAME`   | Route name, or `—` when unnamed.                                              |
| `ACTION` | Handler function name (`anonymous` for an unnamed handler).                   |
| `MW`     | Count of middleware attached to the route.                                    |
| `SOURCE` | Source file the route registered from, or `—`.                               |

## Filters

Optional, case-insensitive, AND-combined:

```bash
pnpm warlock routes --method GET     # -m  exact HTTP method
pnpm warlock routes --path /users    # -p  path substring
pnpm warlock routes --name users     # -n  route-name substring
pnpm warlock routes -m POST -p /users
```

## JSON output

`--json` (`-j`) emits the normalized rows instead of the table — for `jq`, a CI diff, or a generated API map. Filters apply before serialization.

```bash
pnpm warlock routes --json
```

```json
[
  { "method": "GET", "path": "/users", "name": "users.list", "action": "index", "middleware": 2, "source": "app/users/routes.ts" }
]
```

## Patterns

### Audit which routes are guarded

```bash
pnpm warlock routes --json | jq '[.[] | select(.middleware == 0)]'
```

Surfaces public routes (no middleware) — a quick check that auth-protected paths actually carry a guard.

### Confirm a route registered

```bash
pnpm warlock routes --name users.create
```

An empty result means the route isn't registered — re-run `warlock dev` and read the boot error (the route-module loader is fail-loud, so a throwing route file aborts boot rather than being silently dropped).

## `warlock routes:diff` — catch page-route drift before it ships

Compares the **live dev-server page routes** (`router.list().filter(r => r.isPage)`) against a **snapshot written by the last successful `warlock build`** (`page-routes.manifest.json` in `resolveBuildConfig().outdir`, e.g. `dist/page-routes.manifest.json`). Boots the same diagnostic way as `warlock routes` — route modules registered, no connectors started — then diffs.

```bash
pnpm warlock routes:diff
```

```
Page routes match (4 routes).
```

or, on drift:

```
changed - GET /blog/:slug  blog.post (src/web/blog/[slug].page.tsx)
        + GET /blog/:id    blog.post (src/web/blog/[slug].page.tsx)
removed - GET /legacy      legacy.home
added   + GET /promo       promo.home   (src/web/promo.page.tsx)
Page route drift: 1 changed, 1 removed, 1 added. Run `warlock build` after reviewing these changes.
```

and exits non-zero.

- **Identity is `method` + `path` + `name`.** A route is only reported `changed` — instead of one `removed` line and one unrelated `added` line — when it shares its **`source` file** with the route it's being paired against. A moved checkout (same source, different absolute path on disk) never shows as drift; a route whose declared path/name literally changed in the same file does.
- **Requires a prior successful build.** No `page-routes.manifest.json` yet, or a malformed one → the command refuses to run and tells you to `warlock build` first, rather than diffing against nothing.
- **Fails loudly on a broken dev boot**, same as `warlock routes` / `warlock doctor` — a route module that throws on import, or a connector registration error, aborts before any comparison happens.
- **Only page routes are compared.** API routes registered without `isPage` never appear on either side of the diff; this command exists for the file-system page-routing surface `@warlock.js/web` adds, not the general route table.
- **Core reads the snapshot; it does not write it.** `warlock build` writes `page-routes.manifest.json` through a connector's `build`/`emit` contribution (`@warlock.js/web`'s build integration, keyed off pages it discovers) — a project with no `@warlock.js/web` page routes never produces one, and `routes:diff` has nothing to compare against.

## Gotchas

- **No connectors are started.** The list reflects what's *registered*, not what would connect. It never opens a DB/cache/socket.
- **An empty table is a tell.** `No routes registered` is the same signal `warlock doctor`'s `routes` check warns on — a route module likely failed to load.
- **`MW` counts, it doesn't name.** It's a "is this route guarded?" signal; for the actual chain, read the route definition.
- **`ACTION` is the handler function name.** A controller method shows its method name; an inline anonymous handler shows `anonymous`.

## See also

- [`warlock-doctor/SKILL.md`](../warlock-doctor/SKILL.md) — the read-only diagnostics sibling; its `routes` check warns when this table would be empty.
- [`register-route/SKILL.md`](../register-route/SKILL.md) — defining, naming, and grouping the routes this command lists.
- [`run-app/SKILL.md`](../run-app/SKILL.md) — `warlock build`, the command that produces the snapshot `routes:diff` compares against.
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — the command + `preload` shape `routesCommand` is built from.
