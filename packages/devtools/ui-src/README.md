# Devtools dashboard (source)

The React app behind `@warlock.js/devtools`. It is built into `ui/dashboard/` and that build is what ships. This folder
is not published.

Stack: Vite, React 19, Tailwind 4 and shadcn components copied into `src/components/ui/`. There is no router or chart
library: hash routing and SVG charts are written by hand.

## Work on it

Start an app with `warlock dev`, then in this repository:

```bash
DEVTOOLS_DEV_TARGET=http://localhost:3000 DEVTOOLS_DEV_BASE=/__warlock \
  pnpm --filter @warlock.js/devtools dev:ui
```

`DEVTOOLS_DEV_TARGET` is the app's origin (default `http://localhost:3000`). `DEVTOOLS_DEV_BASE` is the dashboard path
(default `/__warlock`). Vite serves the UI with hot reload and proxies the API to the app, so you need no production
setup. In development the app answers `GET api/auth/session` with the development view and the sign-in is skipped.

To work on sign-in or the admin screens, point `DEVTOOLS_DEV_BASE` at a running production monitor's path.

## Build

The build is heavy. On the shared server run it through the wrapper:

```bash
/root/.claude/bin/heavy-run pnpm --filter @warlock.js/devtools build:ui
```

It writes `ui/dashboard/index.html`, `assets/app.js`, `assets/app.css` and `build-info.json`. Commit the result with the
source change.

## Specs

```bash
pnpm --filter @warlock.js/devtools test:ui
```

Specs use jsdom and Testing Library. Mock `fetch` per spec and never call a server. Each screen and tab has specs for
data, the empty state, an API error with its message and reference, and its main action.

## Where things live

| Folder                      | What                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| `src/app/`                  | The shell, router, header, instance picker.                             |
| `src/auth/`                 | Sign-in, setup, invite, password, two-factor enrolment, recovery codes. |
| `src/admin/`, `src/account/` | Users and invites, audit, settings, the account page.                  |
| `src/panel-host/`           | Mounts package panel view modules with the original context.            |
| `src/panels/<id>/`          | One folder per built-in tab, registered in `src/panels/registry.ts`.    |
| `src/components/ui/`        | shadcn components.                                                      |
| `src/components/common/`    | Shared pieces such as the error message with its reference id.          |
| `src/components/charts/`    | SVG charts.                                                             |
| `src/api/`                  | `apiFetch`, the data hooks, and types.                                  |
| `tests/`                    | UI specs.                                                               |

The wire types come from `src/production/contracts.ts` (imported as `@contracts`). That file has no imports so the UI
can use it.

## Size budget and the release gate

`assets/app.js` plus `assets/app.css` must stay at or under 300 KB gzipped. The release gate
(`npm run check:devtools-ui` in `tools/release`) checks three things: the source hash in `build-info.json` matches this
folder, `contracts.ts` and the UI dependency versions; a fresh build is byte-identical to the shipped files; and the
size is within budget. If `ui/dashboard/` is stale, the gate fails: rebuild and commit it.

TODO(coordinator): confirm the `dev:ui` proxy variables and the gate wording against `ui-src/vite.config.ts` and the gate script once both are final.
