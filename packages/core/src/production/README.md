# Production

Production build tooling. Uses esbuild to bundle the application for production deployment, with custom plugins for import resolution and optimization.

## Key Files

| File                      | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `production-builder.ts`   | `ProductionBuilder` — configures esbuild and drains configured connector build contributions |
| `build-app-production.ts` | Entry point function `buildAppForProduction()`                         |
| `build-contributions.ts`  | Validates and sequentially runs connector `build.generate` / `build.emit` hooks; merges narrow esbuild patches |
| `esbuild-plugins.ts`      | Custom esbuild plugins for the production bundle                       |

## Key Exports

- `buildAppForProduction()` — triggers the production build
- `ProductionBuilder` — build orchestrator class

## Connector build contributions

`warlock build` reads `warlock.config.ts > connectors` statically. It does not call connector `boot()` or `start()`. Instead, it runs each optional `connector.build.generate(context)` before esbuild and each `connector.build.emit(context)` after esbuild, awaiting hooks sequentially in config-array order. A hook failure names the connector and aborts the build.

`generate` may write under `.warlock/production`, append generated-entry imports, or return an esbuild patch limited to `jsx`, `jsxImportSource`, `define`, `external`, and `loader`. The builder dependency-checks contributor-generated files before bundling. `emit` produces artifacts outside the server bundle before the temporary production directory is removed. See `skills/add-connector/SKILL.md` for the authoring contract.

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
