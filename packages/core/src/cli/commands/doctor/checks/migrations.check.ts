import { existsSync } from "node:fs";
import { findUndiscoveredMigrations } from "../../../../database/migration-discovery";
import { appPath } from "../../../../utils/paths";
import type { DoctorCheck } from "../check.types";

/**
 * Warns about `*.migration.ts` files under `src/app` that `warlock migrate`
 * does not discover (it reads `models/<name>/migrations/` at any depth and a
 * module's own `migrations/` folder). Such a file never runs and nothing else
 * says so. Silent when every migration file is discovered.
 */
export const migrationsCheck: DoctorCheck = {
  name: "migrations",
  run: async () => {
    const appDirectory = appPath();

    if (!existsSync(appDirectory)) return undefined;

    const missed = await findUndiscoveredMigrations(appDirectory);

    if (missed.length === 0) return undefined;

    const shown = missed.slice(0, 5).join(", ");

    return {
      name: "migrations",
      status: "warn",
      code: "WL9106",
      detail:
        `${missed.length} migration file(s) under src/app will never run: ${shown}${missed.length > 5 ? ", ..." : ""}. ` +
        "Move each into <module>/migrations/ or <module>/models/<name>/migrations/.",
    };
  },
};
