import { filesOrchestrator } from "../../dev-server/files-orchestrator";
import { typeGenerator } from "../../dev-server/type-generator";
import { command } from "../../commands/cli-command";

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
 */
export const typingsGeneratorCommand = command({
  name: "generate.typings",
  description: "Generate type definitions for the project",
  action: async () => {
    await filesOrchestrator.initializeAll();

    await typeGenerator.generateAll();
  },
});
