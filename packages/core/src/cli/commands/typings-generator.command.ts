import { filesOrchestrator } from "../../dev-server/files-orchestrator";
import { runConnectorTypings } from "../../dev-server/run-connector-typings";
import { typeGenerator } from "../../dev-server/type-generator";
import { command } from "../../commands/cli-command";
import { collectRouteRegistrationSnapshot } from "../../production/route-registration-snapshot";
import { resolveBuildConfig } from "../../production/resolve-build-config";
import { rootPath } from "../../utils";
import { warlockConfigManager } from "../../warlock-config/warlock-config.manager";

/**
 * Standalone `warlock generate.typings`.
 *
 * Runs `filesOrchestrator.initializeAll()` before generating — the same
 * full-project discovery `warlock dev` performs at boot — so this produces
 * the identical registry from a fresh checkout instead of only whatever
 * config files a caller happened to list. A prior version added just the
 * config directory's files, which left `TranslationKeyRegistry` empty on any
 * app whose translation keys came from source outside `src/config`.
 *
 * Not `filesOrchestrator.init()` — that also registers the ESM loader hook
 * for dynamically importing project code, which typings generation, being
 * purely static AST inspection, never does.
 *
 * Connectors then write their own typings through the `build.typings` hook
 * (web's `web-routes.d.ts`), so a clean checkout typechecks before any build.
 */
export const typingsGeneratorCommand = command({
  name: "generate.typings",
  description: "Generate type definitions for the project",
  action: async () => {
    await filesOrchestrator.initializeAll();

    await typeGenerator.generateAll();

    await runConnectorTypings({
      connectors: warlockConfigManager.isLoaded ? (warlockConfigManager.get("connectors") ?? []) : [],
      appRoot: rootPath(),
      options: resolveBuildConfig,
      collectRoutes: async () => (await collectRouteRegistrationSnapshot({ cwd: rootPath() })).routes,
    });
  },
  preload: {
    warlockConfig: true,
  },
});
