---
name: warlock-routes
description: 'Run `warlock routes` — a read-only command that lists the registered HTTP routes as a verb-colored table (method / path / name / action / middleware-count / source), a sibling of `warlock doctor`. Filter with `--method` / `--path` / `--name`, or emit normalized rows as JSON with `--json`. Triggers: `warlock routes`, `routesCommand`, "list my routes", "show all routes", "route table", "what endpoints does my app expose", "dump routes as JSON", "which routes have middleware", "route map for CI"; run as `yarn warlock routes`. Skip: read-only health/preflight checks — `@warlock.js/core/warlock-doctor/SKILL.md`; defining/naming/grouping routes — `@warlock.js/core/register-route/SKILL.md`; authoring a general CLI command — `@warlock.js/core/write-cli-command/SKILL.md`; competing tools `nest`/`express` route listers, `php artisan route:list`.'
---

# Warlock — `warlock routes`

`warlock routes` lists every registered HTTP route as a table. It's the read-only sibling of [`warlock doctor`](../warlock-doctor/SKILL.md): it boots the app far enough to register route modules — but **starts no connectors**, so it never opens a database, cache, or socket connection.

```bash
yarn warlock routes
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
yarn warlock routes --method GET     # -m  exact HTTP method
yarn warlock routes --path /users    # -p  path substring
yarn warlock routes --name users     # -n  route-name substring
yarn warlock routes -m POST -p /users
```

## JSON output

`--json` (`-j`) emits the normalized rows instead of the table — for `jq`, a CI diff, or a generated API map. Filters apply before serialization.

```bash
yarn warlock routes --json
```

```json
[
  { "method": "GET", "path": "/users", "name": "users.list", "action": "index", "middleware": 2, "source": "app/users/routes.ts" }
]
```

## Patterns

### Audit which routes are guarded

```bash
yarn warlock routes --json | jq '[.[] | select(.middleware == 0)]'
```

Surfaces public routes (no middleware) — a quick check that auth-protected paths actually carry a guard.

### Confirm a route registered

```bash
yarn warlock routes --name users.create
```

An empty result means the route isn't registered — re-run `warlock dev` and read the boot error (the route-module loader is fail-loud, so a throwing route file aborts boot rather than being silently dropped).

## Gotchas

- **No connectors are started.** The list reflects what's *registered*, not what would connect. It never opens a DB/cache/socket.
- **An empty table is a tell.** `No routes registered` is the same signal `warlock doctor`'s `routes` check warns on — a route module likely failed to load.
- **`MW` counts, it doesn't name.** It's a "is this route guarded?" signal; for the actual chain, read the route definition.
- **`ACTION` is the handler function name.** A controller method shows its method name; an inline anonymous handler shows `anonymous`.

## See also

- [`warlock-doctor/SKILL.md`](../warlock-doctor/SKILL.md) — the read-only diagnostics sibling; its `routes` check warns when this table would be empty.
- [`register-route/SKILL.md`](../register-route/SKILL.md) — defining, naming, and grouping the routes this command lists.
- [`write-cli-command/SKILL.md`](../write-cli-command/SKILL.md) — the command + `preload` shape `routesCommand` is built from.
