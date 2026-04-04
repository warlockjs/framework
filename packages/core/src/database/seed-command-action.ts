import { DataSource, dataSourceRegistry } from "@warlock.js/cascade";
import { CommandActionData } from "../cli/types";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { Path } from "../dev-server/path";
import { getFilesFromDirectory } from "../dev-server/utils";
import { srcPath } from "../utils";
import { Seeder } from "./seeds/seeder";
import { SeedersManager } from "./seeds/seeders.manager";

async function clearAllTables(datasource: DataSource) {
  const tables = await datasource.driver.blueprint.listTables();

  for (const table of tables) {
    await datasource.driver.truncateTable(table, { cascade: true });
  }
}

export async function seedCommandAction(options: CommandActionData) {
  const { path, fresh, transaction } = options.options;

  const datasource = dataSourceRegistry.get();

  if (fresh) {
    await clearAllTables(datasource);
  }

  const seeds = path
    ? [await loadSeedFile(Path.toAbsolute(path as string))]
    : await listSeedsFiles();

  const seedersManager = new SeedersManager();

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
