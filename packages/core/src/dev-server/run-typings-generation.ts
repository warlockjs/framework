/**
 * Run type generation, in this process.
 *
 * ## Why this is not a spawn
 *
 * It used to be. `type-generator.ts` ran `npx warlock generate.typings`, which
 * resolves to `core/bin/warlock.js` → `import "../esm/cli/start.mjs"`. This
 * monorepo consumes packages as TypeScript **source**, so there is no `esm/`
 * directory: every dev boot printed `✗ Failed to generate types`, and an
 * `ERR_MODULE_NOT_FOUND` stack rode along inside an otherwise green core suite.
 *
 * Spawning was the mistake underneath the broken path. The CLI command it
 * launched does two things — add the config files to the orchestrator, then
 * call `typeGenerator.generateAll()` — and the dev server has **already**
 * initialised that orchestrator with those files at boot. So it paid for a
 * second Node process to rediscover state it was holding, in order to call a
 * method that lives in the same module it was calling from.
 *
 * Launching a binary through `npx` is separately prohibited in this workspace:
 * resolve and invoke directly.
 *
 * ## Why a failure here is not fatal
 *
 * Generated typings are editor autocomplete. A dev server that refused to boot
 * because it could not write them would be a worse defect than the one this
 * replaces, so this never throws — but it does say **why**, which the old
 * `Failed to generate types` did not. A failure message that names no cause
 * sends the reader hunting, which is most of what the old line achieved.
 */

export type TypingsGenerationPorts = {
  /** `typeGenerator.generateAll()` in production; a fake in tests. */
  generate(): Promise<void>;
  info(message: string): void;
  success(message: string): void;
  error(message: string): void;
};

function describeCause(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;

  return String(thrown);
}

export async function runTypingsGeneration(ports: TypingsGenerationPorts): Promise<void> {
  ports.info("Checking for types generation");

  try {
    await ports.generate();

    ports.success("Types generated successfully");
  } catch (thrown) {
    ports.error(`Failed to generate types: ${describeCause(thrown)}`);
  }
}
