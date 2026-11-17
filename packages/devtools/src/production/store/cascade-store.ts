import type { DevtoolsStore } from "./types";

/**
 * The production `DevtoolsStore`: the app's database through
 * `@warlock.js/cascade` (MongoDB or SQL), using the models in `./models` and
 * the tables `devtoolsMigrations` creates. Imports cascade lazily so loading
 * this module never requires it.
 *
 * Throws `DevtoolsProductionConfigError("DT005")` when cascade is not
 * installed or has no connection.
 *
 * Owner: WP-1.
 */
export async function createCascadeStore(): Promise<DevtoolsStore> {
  throw new Error("not implemented");
}
