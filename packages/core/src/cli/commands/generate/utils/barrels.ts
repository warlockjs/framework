/**
 * Whether `warlock generate` / `warlock make` write `index.ts` barrels.
 *
 * Barrels are optional: an app turns them off with `generate: { barrels: false }`
 * in `warlock.config.ts`, and the generators then write no barrel and point the
 * files they generate at the model file itself. The default is on, so an app
 * that sets nothing keeps the layout it has today.
 *
 * Like the dry-run flag in `writer.ts`, this is process-wide state: the CLI runs
 * one command per process, so a generator sets it once and the stubs it calls
 * read it without a parameter on every signature.
 */
let barrels = true;

/** Set whether generators write barrels. Tests call this directly. */
export function setGeneratedBarrels(value: boolean): void {
  barrels = value;
}

/** Whether generators write barrels right now. */
export function generatedBarrels(): boolean {
  return barrels;
}

/** Read `generate.barrels` from `warlock.config.ts` once, at the start of a generator. */
export async function loadGeneratedBarrels(): Promise<void> {
  const { warlockConfigManager } = await import("../../../../warlock-config/warlock-config.manager");

  await warlockConfigManager.load();

  barrels = warlockConfigManager.isLoaded
    ? warlockConfigManager.get("generate")?.barrels !== false
    : true;
}

/**
 * The import path, relative to a sibling folder of `models/`, of a generated
 * model: the model folder (its barrel) or, with barrels off, the model file.
 */
export function modelImportPath(kebab: string): string {
  return barrels ? `../models/${kebab}` : `../models/${kebab}/${kebab}.model`;
}
