import { defineCommand } from "citty";
import { listExecutedMigrations } from "../../operations/migrations";
import { printExecutedMigrations } from "../printers";
import { withCliConnection } from "../with-cli-connection";

/**
 * `cascade migrate:list` — print every migration that has been executed
 * against the configured data source. Reads the migrations table directly;
 * does not load files from disk.
 */
export const migrateListCommand = defineCommand({
  meta: {
    name: "migrate:list",
    description: "List every migration that has been executed against the data source.",
  },
  async run() {
    await withCliConnection(async () => {
      const executed = await listExecutedMigrations();

      printExecutedMigrations(executed);
    });
  },
});
