# Generations

Code scaffolding / generation system. Provides the `add` CLI command action that generates module boilerplate (model, migration, repository, resource, routes, etc.) from stubs.

## Key Files

| File                    | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `add-command.action.ts` | Main action: prompts for module name, generates files from templates |
| `stubs.ts`              | Template strings for generated files, including the `warlock add web` starter (`webRootStub`, `webHomePageStub`, `webContactControllerStub`, `webContactRoutesStub`) |
| `features/web.feature.ts` | The `web` feature installer — scaffolds `src/web/root.tsx` + `src/web/index.page.tsx` plus `src/app/contact/{routes.ts,controllers/contact.controller.ts}` (a real `POST /api/contact` route validated with `@warlock.js/seal`), registers the `WebConnector`, and declares the feature's npm dependencies |

## Key Exports

- `addCommandAction()` — interactive module scaffolding

## Dependencies

### Internal (within `core/src`)

- `../utils` — path helpers for output directories
- `../cli` — integrates as a CLI command

### External

- `@mongez/copper` — terminal prompts and colors
- `@mongez/fs` — file system operations

## Used By

- `cli/commands/` — the `warlock add` command

## Notes

- The `web` feature's `dependencies` map declares npm packages installed into the
  *target app*, not this package — `@warlock.js/web`, `@mongez/http`,
  `@mongez/react-form`, `@mongez/react-localization`, `react`, `react-dom`. The
  scaffolded contact form (`webHomePageStub`) and its API route
  (`webContactControllerStub` / `webContactRoutesStub`) import from those, so
  removing one from the feature's `dependencies` without also changing the stubs
  leaves the generated app with unresolved imports.
