import { colors } from "@mongez/copper";
import {
  DataSource,
  dataSourceRegistry,
  transaction as runInTransaction,
} from "@warlock.js/cascade";
import { CommandActionData } from "../cli/types";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { Path } from "../dev-server/path";
import { getFilesFromDirectory } from "../dev-server/utils";
import { srcPath } from "../utils";
import { Seeder } from "./seeds/seeder";
import { SeedersManager } from "./seeds/seeders.manager";
import { SeedClock, SeedRecordRef } from "./seeds/types";
import { seedRecordsTableName, seedsTableName } from "./seeds/utils";

/**
 * Programmatic-only overrides for {@link seedCommandAction}.
 *
 * Not derived from CLI flags (the CLI passes only {@link CommandActionData}),
 * so a back-fill script or a test can inject behaviour the command line can't
 * express.
 */
export type SeedCommandOverrides = {
  /**
   * Clock the run reads for the `now` handed to each seeder and for the
   * seeds-log metadata timestamps. Defaults to `() => new Date()`. Forwarded to
   * {@link SeedersManager}'s `clock` option.
   */
  clock?: SeedClock;
};

async function clearAllTables(datasource: DataSource) {
  const tables = await datasource.driver.blueprint.listTables();

  for (const table of tables) {
    await datasource.driver.truncateTable(table, { cascade: true });
  }
}

type SeedRecordRow = SeedRecordRef & { id: number };

/**
 * Undo seeded data by deleting the records a seeder tracked via `track`.
 *
 * Reads `seed_records` (all seeders, or a single `seederName`), then deletes
 * the referenced records in REVERSE seed-order and, within each seed, in
 * reverse insertion-order. Insertion id is strictly increasing across the
 * whole run, so deleting by descending `id` satisfies both at once. The whole
 * operation runs in a single transaction, and the matching seeds-log rows are
 * reset afterwards so `once: true` seeds re-run on the next `warlock seed`.
 *
 * @returns the number of tracked records deleted.
 */
export async function dropSeedRecords(
  datasource: DataSource,
  seederName?: string,
): Promise<number> {
  const driver = datasource.driver;

  if (!(await driver.blueprint.tableExists(seedRecordsTableName))) {
    return 0;
  }

  const query = driver.queryBuilder<SeedRecordRow>(seedRecordsTableName);

  if (seederName) {
    query.where("seeder", seederName);
  }

  const rows = await query.get();

  if (rows.length === 0) {
    return 0;
  }

  // Descending insertion id == reverse seed-order + reverse within-seed order.
  const ordered = [...rows].sort((a, b) => b.id - a.id);

  await runInTransaction(async () => {
    for (const row of ordered) {
      await driver.deleteMany(row.table, { id: row.recordId });
    }

    // Clear the tracked refs we just acted on.
    if (seederName) {
      await driver.deleteMany(seedRecordsTableName, { seeder: seederName });
    } else {
      await driver.deleteMany(seedRecordsTableName, {});
    }

    // Reset the seeds-log rows so `once: true` seeds re-run.
    const seederNames = seederName
      ? [seederName]
      : [...new Set(ordered.map((row) => row.seeder))];

    for (const name of seederNames) {
      await driver.deleteMany(seedsTableName, { name });
    }
  });

  return ordered.length;
}

/**
 * Run database seeds.
 *
 * @example
 * ```ts
 * import { seedCommandAction } from "@warlock.js/core";
 *
 * await seedCommandAction({
 *   command: "seed",
 *   options: { fresh: true, list: false }
 * });
 * ```
 *
 * @param overrides Programmatic-only overrides (e.g. an injected `clock`); the
 * CLI never passes this, so the command-line signature stays unchanged.
 */
export async function seedCommandAction(
  options: CommandActionData,
  overrides?: SeedCommandOverrides,
) {
  const { path, fresh, transaction, list, drop } = options.options;

  const datasource = dataSourceRegistry.get();

  if (drop) {
    // `--drop` (boolean) undoes every tracked record; `--drop=<name>` scopes to
    // a single seeder.
    const seederName = typeof drop === "string" ? drop : undefined;

    const deleted = await dropSeedRecords(datasource, seederName);

    const scope = seederName ? colors.cyan(seederName) : "all seeders";
    console.log(
      `🗑️  Dropped ${colors.redBright(deleted)} tracked record(s) for ${scope}; matching seeds-log entries reset.`,
    );
    return;
  }

  if (fresh) {
    await clearAllTables(datasource);
  }

  if (list) {
    const seedFiles = await listSeedsFiles();

    if (seedFiles.length === 0) {
      console.log("No seeds found.");
      return;
    }

    const seedersManager = new SeedersManager();

    seedersManager.register(...seedFiles);

    const seeds = seedersManager.sort().seeders.map((seed) => {
      return {
        name: seed.name,
        order: seed.order,
        enabled: seed.enabled,
      };
    });

    console.table(seeds);

    console.log(
      `Total Seeds: ${colors.blueBright(seeds.length)}, enabled: ${colors.greenBright(seeds.filter((seed) => seed.enabled !== false).length)}, disabled: ${colors.redBright(seeds.filter((seed) => seed.enabled === false).length)}`,
    );
    return;
  }

  const seeds = path
    ? [await loadSeedFile(Path.toAbsolute(path as string))]
    : await listSeedsFiles();

  const seedersManager = new SeedersManager({ clock: overrides?.clock });

  seedersManager.register(...seeds);

  await seedersManager.run(transaction as boolean);
}

async function listSeedsFiles() {
  const seedsFiles = await getFilesFromDirectory(srcPath("app"), "*/seeds/*.ts");

  const seeds = [];

  for (const seedFile of seedsFiles) {
    const seed = await loadSeedFile(seedFile);
    seeds.push(seed);
  }

  return seeds;
}

async function loadSeedFile(absPath: string): Promise<Seeder> {
  const relativePath = Path.toRelative(absPath);
  const seedImport = await filesOrchestrator.load<{ default: Seeder }>(relativePath);

  if (!seedImport || !seedImport.default) {
    throw new Error(`Seeder file ${relativePath} does not export a default seeder.`);
  }

  return seedImport.default;
}
