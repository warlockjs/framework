import { colors } from "@mongez/copper";
import {
  exportMigrationsSQL,
  freshMigrate,
  listExecutedMigrations,
  Migration,
  migrationRunner,
  rollbackMigrations,
  runMigrations,
} from "@warlock.js/cascade";
import dayjs from "dayjs";
import path from "path";
import { CommandActionData } from "../commands/types";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { Path } from "../utils/normalized-path";
import { getFilesFromDirectory } from "../dev-server/utils";
import { srcPath } from "../utils";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";
import { exitCodeFor, PENDING_EXIT_CODE } from "./pending-exit-code";
import {
  resolvePendingMigrations,
  type PendingMigrationsResult,
} from "./resolve-pending-migrations";

/**
 * `--list` — print the migration state: what has run, then what will run next.
 *
 * The executed section is printed FIRST and unconditionally, before anything
 * touches disk or config. That ordering is the contract: reading migrations
 * from the table cannot fail because of a broken migration file, and `--list`
 * is the command an operator reaches for *during* an incident. The pending
 * section is best-effort on top of an answer that is already on screen.
 *
 * Always exits 0. It is a report; `--pending` is the gate.
 */
async function listMigrationsAction() {
  await printExecutedMigrations();

  const pending = await resolvePendingMigrations(loadAllMigrations);

  printPendingMigrations(pending);
}

async function printExecutedMigrations() {
  const createdMigrations = await listExecutedMigrations();

  console.log(`\nTotal Executed Migrations: ${colors.green(createdMigrations.length)}\n`);

  if (createdMigrations.length === 0) {
    console.log(colors.gray("  No migrations have been executed yet.\n"));
    return;
  }

  // Display each migration as a block
  for (const migration of createdMigrations) {
    const executedAt = dayjs(migration.executedAt).format("DD-MM-YYYY hh:mm:ss A");
    const createdAt = migration.createdAt
      ? dayjs(migration.createdAt).format("DD-MM-YYYY hh:mm:ss A")
      : null;

    // Migration name with checkmark icon
    console.log(`  ${colors.green("✔")} ${colors.cyanBright(migration.name)}`);

    // Executed date
    console.log(`    ${colors.gray("Executed:")} ${colors.white(executedAt)}`);

    // Created date (if available)
    if (createdAt) {
      console.log(`    ${colors.gray("Created:")}  ${colors.yellow(createdAt)}`);
    }

    console.log(""); // Empty line between migrations
  }
}

/**
 * Print the pending section shared by `--list` and `--pending`.
 *
 * An unavailable result prints an explicit line and NEVER a count. "0 pending"
 * over a tree we failed to read is the one output this whole feature exists to
 * prevent.
 */
function printPendingMigrations(result: PendingMigrationsResult) {
  if (result.type === "unavailable") {
    console.log(
      `${colors.yellowBright("Pending: unavailable")} — ${result.reason}\n` +
        colors.gray("  The executed list above is still accurate.\n"),
    );
    return;
  }

  const { migrations } = result;

  console.log(`Total Pending Migrations: ${colors.green(migrations.length)}\n`);

  if (migrations.length === 0) {
    console.log(colors.gray("  Nothing pending — the database is up to date.\n"));
    return;
  }

  // Numbered because the ORDER is the answer: this is what the next
  // `warlock migrate` will do, in the sequence it will do it.
  migrations.forEach((migration, index) => {
    console.log(`  ${colors.gray(`${index + 1}.`)} ${colors.cyanBright(migration.name)}`);
  });

  console.log("");
}

/**
 * `--pending` — the scriptable half. Same computation as `--list`'s pending
 * section, different exit contract: see {@link PENDING_EXIT_CODE}.
 */
async function pendingMigrationsAction() {
  const result = await resolvePendingMigrations(loadAllMigrations);

  printPendingMigrations(result);

  const exitCode = exitCodeFor(result);

  if (exitCode === PENDING_EXIT_CODE.unavailable) {
    console.error(
      colors.redBright("Could not determine the pending set — exiting 2 rather than reporting 0."),
    );
  }

  process.exit(exitCode);
}

async function allMigrationsFilesAction() {
  // get all available migration files in the project
  const files = (await migrationFiles()).map((path) => Path.toRelative(path));
  console.log(`Total Migration Files: ${colors.green(files.length)}`);

  for (const file of files) {
    console.log(colors.yellowBright(file));
  }
}

/**
 * If path is provided, then run the migration runner against that file only
 * If fresh is provided, then rollback all migrations and run all migrations
 * If rollback is provided, then run the migration runner against all files in reverse order
 */
export async function migrateAction(options: CommandActionData) {
  const { fresh, path, rollback, all, list, pending, sql, pendingOnly, compact } = options.options;

  if (list) {
    return await listMigrationsAction();
  }

  if (pending) {
    return await pendingMigrationsAction();
  }

  if (all) {
    return await allMigrationsFilesAction();
  }

  if (path) {
    await loadMigrationFile(Path.toAbsolute(path as string));
  } else {
    await loadAllMigrations();
  }

  if (fresh && rollback) {
    console.log(colors.redBright("You can't use --fresh and --rollback together"));
    process.exit(1);
  }

  if (rollback) {
    await rollbackMigrations({ all: true });
    return;
  }

  if (sql) {
    await exportMigrationsSQL({
      pendingOnly: pendingOnly as boolean,
      compact: compact as boolean,
    });
    return;
  }

  if (fresh) {
    await freshMigrate();
    return;
  }

  await runMigrations();
}

async function loadMigrationFile(absPath: string) {
  const relativePath = Path.toRelative(absPath);

  const loadedModule = await filesOrchestrator.load<{ default: typeof Migration }>(relativePath);

  if (!loadedModule?.default) {
    throw new Error(`${Path.toRelative(absPath)} must have a default export`);
  }

  const MigrationClass = loadedModule.default;

  if (!MigrationClass.migrationName) {
    MigrationClass.migrationName = path
      .basename(absPath)
      .split(".")[0]
      .replace("-migration", "")
      .replace("_migration", "");
  }

  // Extract createdAt timestamp from filename if not already set
  // Expected format: MM-DD-YYYY_HH-MM-SS-name.migration.ts
  if (!MigrationClass.createdAt) {
    const filename = path.basename(absPath);
    const timestampMatch = filename.match(/^(\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2})/);
    if (timestampMatch) {
      MigrationClass.createdAt = timestampMatch[1];
    }
  }

  migrationRunner.register(MigrationClass);
}

/**
 *
 * @returns List of absolute paths to migration files
 */
async function migrationFiles() {
  const migrationFiles = await getFilesFromDirectory(srcPath("app"), "*/models/*/migrations/*");
  const separateMigrationsFolderFIles = await getFilesFromDirectory(
    srcPath("app"),
    "*/migrations/*",
  );

  const migrations = [...migrationFiles, ...separateMigrationsFolderFIles];

  return migrations;
}

async function loadAllMigrations() {
  // Load config-registered migrations (from packages like @warlock.js/auth)
  const configMigrations = warlockConfigManager.get("database")?.migrations || [];

  for (const MigrationClass of configMigrations) {
    // Use class name as migration name if not set
    if (!MigrationClass.migrationName) {
      MigrationClass.migrationName = MigrationClass.name;
    }
    migrationRunner.register(MigrationClass);
  }

  // Always load file-based migrations from src/app, regardless of config
  const migrations = await migrationFiles();
  for (const migrationFile of migrations) {
    await loadMigrationFile(migrationFile);
  }
}
