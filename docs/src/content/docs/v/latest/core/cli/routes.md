---
title: "warlock routes"
description: List the registered HTTP routes as a verb-colored table — method, path, name, controller action, middleware count, source file. Read-only and connector-free; filter by method/path/name or emit JSON. How the table is built and how it pairs with warlock doctor.
sidebar:
  order: 6
  label: "warlock routes"
---

`warlock routes` prints every registered HTTP route as a table — a read-only sibling of [`warlock doctor`](./doctor.md). It's the "what does my app actually expose?" command: a quick map of the route surface, an audit of which routes carry middleware, or a JSON feed for a script. It boots your app code far enough to register routes but **starts no connectors**, so it never opens a database, cache, or socket connection.

```bash
warlock routes
```

```
METHOD  PATH              NAME           ACTION    MW  SOURCE
GET     /users            users.list     index     2   app/users/routes.ts
POST    /users            users.create   store     2   app/users/routes.ts
GET     /users/:id        users.get      show      2   app/users/routes.ts
DELETE  /users/:id        users.delete   destroy   3   app/users/routes.ts

4 routes (2 GET · 1 POST · 1 DELETE)
```

The `METHOD` column is colored by verb (GET green, POST blue, PUT/PATCH yellow, DELETE red, `all`/OPTIONS/HEAD dim) so the table scans at a glance.

## Columns

| Column   | What it shows                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------- |
| `METHOD` | The HTTP verb. A wildcard `all`-verb route lists as `ALL`.                                       |
| `PATH`   | The full request path, with any group prefix already folded in.                                 |
| `NAME`   | The route name (`—` if the route was registered without one).                                   |
| `ACTION` | The handler/controller-action — the handler function name (`anonymous` for an unnamed handler). |
| `MW`     | The number of middleware attached to the route.                                                 |
| `SOURCE` | The source file the route was registered from (`—` if unknown).                                 |

Rows are sorted by path, then by HTTP-method order within a path, so every verb of one resource lists together.

## Filters

All filters are optional and combine (AND). String filters are case-insensitive.

```bash
warlock routes --method GET     # -m — exact HTTP method
warlock routes --path /users    # -p — path substring
warlock routes --name users     # -n — route-name substring
warlock routes --method POST --path /users   # combined
```

## JSON output

`--json` (`-j`) emits the normalized rows instead of the table — handy for piping into `jq`, a diff in CI, or a generated API map:

```bash
warlock routes --json
```

```json
[
  {
    "method": "GET",
    "path": "/users",
    "name": "users.list",
    "action": "index",
    "middleware": 2,
    "source": "app/users/routes.ts"
  }
]
```

The filters apply before JSON serialization too — `warlock routes --method GET --json` emits only the GET rows.

## What it does NOT do

Like `doctor`, `routes` bootstraps your app code (so route modules register) **but starts no connectors** — it never opens a database, cache, or socket connection. It's pure introspection of the router.

Because the route-module loader is **fail-loud**, a route file that throws on import or registration aborts boot with the error rather than being silently skipped — so a route missing from the table means it isn't registered, not that it was quietly dropped. (A wholesale empty table — `No routes registered` — is the same tell `warlock doctor`'s `routes` check warns on: a route module likely failed to load.)

## Gotchas

- **No connectors are started.** The route list reflects what's *registered*, independent of whether the database or cache would connect.
- **`MW` counts middleware, it doesn't name them.** It's a quick "is this route guarded?" signal; for the actual middleware chain, read the route definition.
- **`ACTION` is the handler function name.** A controller method shows its method name; an inline arrow handler with no name shows `anonymous`.

## `warlock routes:diff`

`warlock routes:diff` bootstraps the current application in diagnostic mode
(route modules loaded, connectors not started), then compares those live page
routes against the **page-route manifest** the last successful `warlock build` wrote
(`page-routes.manifest.json` under the build output directory). It exists for
the same failure `@warlock.js/web`'s live dev re-registration is built to
avoid at runtime: a page renamed, added, or route-changed in dev must not
silently ship a production build with a stale route surface.

```bash
warlock routes:diff
```

```
Page routes match (6 routes).
Note: page names are compared as DERIVED by the build, so a clean diff does not
prove that no route name collided at registration (the router appends
`.<method>` to a name already claimed by another method). Run `warlock routes`
to see the registered names.
```

A tree you have not touched since a successful `warlock build` now reports
clean. That was not true through 5.1: the manifest recorded the catch-all page
route as `"*"` while the router registers it as `"/*"`, so the very first
`routes:diff` after a green build reported drift on an untouched checkout. The
manifest is written through the router's own path normalizer now, so drift on
an unedited tree is a real signal rather than the expected greeting.

:::caution[What a clean diff does not prove]
The manifest is a record of what each page's route name was **derived** as, not
of what it was **registered** as. `warlock build` never boots connectors, so it
cannot see the API routes a page name could collide with — and when a name is
already claimed by another method, the router appends a `.<method>` suffix at
registration time, which the comparison accepts rather than reporting.

`Page routes match` therefore means *the page surface has not moved since the
build*. It does **not** mean *no page route name collided*. Run plain
`warlock routes` (the table at the top of this page) to see the names as they
were actually registered.
:::

When the two disagree, it prints one line per drift and exits non-zero — a
CI-friendly gate to run before deploying:

```
changed - GET /contact-us  contact-us  (src/web/contact-us.page.tsx)
        + GET /contact-us2  contact-us  (src/web/contact-us.page.tsx)
added   + GET /about  about  (src/web/about.page.tsx)
```

It requires a prior `warlock build` — there is no manifest to diff against
otherwise, and the command refuses with an explicit instruction rather than
comparing against nothing. Comparison identity is method + path + name; a
route whose declared source file moved (a checkout relocated on disk) is
shown as context only and does not itself count as drift. Only page routes
(`isPage: true`) are compared — ordinary API routes are out of scope for this
command.

## Going further

- [`warlock doctor`](./doctor.md) — the read-only diagnostics sibling (the `routes` check there warns when the table would be empty).
- [CLI commands](./cli-commands.md) — every other built-in `warlock` command.
- [Routing](../the-basics/02-routing.md) — how routes are defined, named, and grouped in the first place.
- [`@warlock.js/web`](../../web/) — the page layer `routes:diff` is built for.
