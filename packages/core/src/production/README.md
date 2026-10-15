# Production

Production build tooling. Uses esbuild to bundle the application for production deployment, with custom plugins for import resolution and optimization.

## Key Files

| File                      | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `production-builder.ts`   | `ProductionBuilder` — configures esbuild and drains configured connector build contributions |
| `build-app-production.ts` | Entry point function `buildAppForProduction()`                         |
| `build-contributions.ts`  | Validates and sequentially runs connector `build.generate` / `build.emit` hooks; merges narrow esbuild patches |
| `esbuild-plugins.ts`      | Custom esbuild plugins for the production bundle                       |
| `promote-dist.ts`         | Temp write target, and the staged move-aside / rename-in / commit / rollback promotion |
| `dist-build-manifest.ts`  | Writes and reads `.warlock-build.json`, the build-success marker       |
| `assert-dist-ready-to-start.ts` | Whether `dist` is fit for `warlock start`, and the reason when it is not |

## Key Exports

- `buildAppForProduction()` — triggers the production build
- `ProductionBuilder` — build orchestrator class

## Connector build contributions

`warlock build` reads `warlock.config.ts > connectors` statically. It does not call connector `boot()` or `start()`. Instead, it runs each optional `connector.build.generate(context)` before esbuild and each `connector.build.emit(context)` after esbuild, awaiting hooks sequentially in config-array order. A hook failure names the connector and aborts the build.

`generate` may write under `.warlock/production`, append generated-entry imports, or return an esbuild patch limited to `jsx`, `jsxImportSource`, `define`, `external`, and `loader`. The builder dependency-checks contributor-generated files before bundling. `emit` produces artifacts outside the server bundle before the temporary production directory is removed. See `skills/add-connector/SKILL.md` for the authoring contract.

### `context.options.outdir` is always the FINAL destination

esbuild bundles into a private temp directory beside `outdir` (`promote-dist.ts`) so a failed build cannot leave partial output where `warlock start` would find it. That temp path is a write target only — it is passed as an argument to the one operation that writes into it and is **never** put into `options.outdir` or into the `ConnectorBuildContext`. A hook that reads `context.options.outdir` gets the path the artifact lives at once the build is done, because hooks bake that path into runtime output (`web` records `<outdir>/client` as the `clientDir` its browser assets are served from) and a temp path there would name a directory promotion has since renamed away.

That is why `emit` runs **after** the bundle has been promoted into `outdir`, not before: it writes into the real `dist`. The previous build stays parked aside until `emit` finishes and the build-success marker is written, so a failing `emit` rolls the whole promotion back and leaves the previous `dist` intact. The marker (`.warlock-build.json`, `dist-build-manifest.ts`) is written last of all — nothing `warlock start` will boot exists until every step has succeeded.

## Dependencies

### Internal (within `core/src`)

- `../config` — build configuration
- `../connectors` — configured connector instances and their static build contributions
- `../utils` — paths (root, src, output directories)
- `../dev-server` — may reuse transpilation utilities

### External

- `esbuild` — bundler

## Used By

- `cli/commands/` — `build` CLI command
