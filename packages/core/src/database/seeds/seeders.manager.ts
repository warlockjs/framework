import { colors } from "@mongez/copper";
import {
  type DataSource,
  type DriverContract,
  DatabaseWriterValidationError,
  dataSourceRegistry,
  migrationRunner,
  transaction,
} from "@warlock.js/cascade";
import { Seeder } from "./seeder";
import { SeederDependencyCycleError, UnknownSeederDependencyError } from "./seeder.errors";
import { SeedRecordsTableMigration } from "./seed-records-table-migration";
import { SeedsTableMigration } from "./seeds-table-migration";
import {
  SeedClock,
  SeederMetadata,
  SeedRecordRef,
  SeedResult,
  Track,
  TrackableModel,
} from "./types";
import { seedRecordsTableName, seedsTableName } from "./utils";

export type SeedersManagerOptions = {
  datasource?: DataSource;
  /**
   * Clock the manager reads for the `now` it hands each seeder AND for its own
   * metadata timestamps (`createdAt` / `firstRunAt` / `lastRunAt` / a tracked
   * ref's `runAt`). Defaults to `() => new Date()`. Override it to make a
   * historical back-fill or a test deterministic — every timestamp a run
   * produces then comes from this one clock.
   */
  clock?: SeedClock;
};

export class SeedersManager {
  public seeders: Seeder[] = [];

  protected datasource?: DataSource;

  /**
   * The single clock every timestamp in a run reads from. Defaults to
   * `() => new Date()`; overridable via {@link SeedersManagerOptions.clock}.
   */
  protected readonly now: SeedClock;

  public constructor(protected options?: SeedersManagerOptions) {
    this.datasource = options?.datasource ?? dataSourceRegistry.get();
    this.now = options?.clock ?? (() => new Date());
  }

  /**
   * Register new seeder
   */
  public register(...seeders: Seeder[]) {
    this.seeders.push(...seeders);
    return this;
  }

  /**
   * Initialize before running
   */
  protected async init() {
    if (!(await this.driver.blueprint.tableExists(seedsTableName))) {
      await migrationRunner.run(SeedsTableMigration);
    }

    if (!(await this.driver.blueprint.tableExists(seedRecordsTableName))) {
      await migrationRunner.run(SeedRecordsTableMigration);
    }
  }

  /**
   * Run seeders
   */
  public async run(withTransaction = true) {
    await this.init();

    this.prepareSeeders();

    console.log(`🌱 Running ${this.seeders.length} seeder(s)...\n`);

    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const seeder of this.seeders) {
      // Check if already executed
      if (seeder.once && (await this.seederIsExecutedBefore(seeder))) {
        console.log(`⏭️  Skipping ${colors.yellow(seeder.name)} (already executed)`);
        skippedCount++;
        continue;
      }

      try {
        console.log(`🔄 Running ${colors.green(seeder.name)}...`);
        const startTime = Date.now();

        const refs: SeedRecordRef[] = [];
        const track = this.createTracker(seeder, refs);

        const runSeeder = async () => {
          // Keep LAST-RUN refs only: drop the prior refs for this seeder before
          // writing the new ones, so `--drop` undo stays bounded.
          await this.driver.deleteMany(seedRecordsTableName, { seeder: seeder.name });

          const result = await seeder.run({
            track,
            now: this.now,
            batchSize: seeder.batchSize ?? 0,
          });

          if (refs.length > 0) {
            await this.driver.insertMany(
              seedRecordsTableName,
              refs.map((ref) => ({ ...ref })),
            );
          }

          return result;
        };

        const result = withTransaction ? await transaction(runSeeder) : await runSeeder();

        const duration = Date.now() - startTime;

        // Auto-derive recordsCreated from the track count; a returned
        // SeedResult is an optional fallback when nothing was tracked.
        const recordsCreated = refs.length > 0 ? refs.length : (result?.recordsCreated ?? 0);

        await this.storeSeedsResults(seeder, { recordsCreated });

        console.log(
          `✅ ${colors.green(seeder.name)} completed (${duration}ms, ${recordsCreated} records)\n`,
        );
        successCount++;
      } catch (error: any) {
        const err = error as Error;
        console.error(`❌ ${colors.red(seeder.name)} failed:`, err.message);
        console.log(err);
        failedCount++;

        if (error instanceof DatabaseWriterValidationError) {
          console.log(error.errors);
        }

        // Re-throw to stop execution (or continue to next seed based on your preference)
        throw error;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log(`✅ Success: ${successCount}`);

    if (skippedCount > 0) console.log(`⏭️  Skipped: ${skippedCount}`);

    if (failedCount > 0) console.log(`❌ Failed: ${failedCount}`);

    console.log("=".repeat(50));
  }

  /**
   * Build a `track` helper bound to the given seeder. Tracked refs are pushed
   * into `refs` and persisted (within the run transaction) by the caller.
   *
   * Every overload returns its first argument so it can be chained inline.
   */
  protected createTracker(seeder: Seeder, refs: SeedRecordRef[]): Track {
    const push = (table: string, recordId: number | string) => {
      refs.push({ seeder: seeder.name, table, recordId, runAt: this.now() });
    };

    function track<T extends TrackableModel>(model: T): T;
    function track<T extends TrackableModel>(models: T[]): T[];
    function track(table: string, id: number | string): string;
    function track(
      arg: TrackableModel | TrackableModel[] | string,
      id?: number | string,
    ): TrackableModel | TrackableModel[] | string {
      if (typeof arg === "string") {
        push(arg, id as number | string);

        return arg;
      }

      if (Array.isArray(arg)) {
        for (const model of arg) {
          push(model.getTableName(), model.id);
        }

        return arg;
      }

      push(arg.getTableName(), arg.id);

      return arg;
    }

    return track;
  }

  /**
   * Sort seeds
   */
  public sort() {
    this.seeders = this.seeders.sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

    return this;
  }

  /**
   * Prepare seeders to order by the seeder order, then resolve `dependsOn`.
   *
   * Dependencies are honored via a topological sort layered over the existing
   * numeric `order` tie-break: among seeders whose dependencies are already
   * satisfied, the lowest `order` (then registration order) runs first. Throws
   * {@link UnknownSeederDependencyError} for a missing dependency and
   * {@link SeederDependencyCycleError} for a cycle.
   */
  public prepareSeeders() {
    this.seeders = this.seeders.filter((seeder) => seeder.enabled !== false);

    this.sort();

    this.seeders = this.resolveDependencies(this.seeders);

    return this;
  }

  /**
   * Topologically sort `seeders` by their `dependsOn` names. The input is
   * assumed pre-sorted by `order` (see {@link sort}); that ordering is used as
   * the tie-break so dependency-free siblings keep their `order` sequence.
   */
  protected resolveDependencies(seeders: Seeder[]): Seeder[] {
    const byName = new Map<string, Seeder>();

    for (const seeder of seeders) {
      byName.set(seeder.name, seeder);
    }

    // Validate dependencies up-front so an unknown name is a clear error rather
    // than a silently dropped edge.
    for (const seeder of seeders) {
      for (const dependency of seeder.dependsOn ?? []) {
        if (!byName.has(dependency)) {
          throw new UnknownSeederDependencyError(seeder.name, dependency);
        }
      }
    }

    const sorted: Seeder[] = [];
    const state = new Map<string, "visiting" | "visited">();

    const visit = (seeder: Seeder, path: string[]) => {
      const status = state.get(seeder.name);

      if (status === "visited") {
        return;
      }

      if (status === "visiting") {
        const cycleStart = path.indexOf(seeder.name);
        const cycle = path.slice(cycleStart >= 0 ? cycleStart : 0).concat(seeder.name);

        throw new SeederDependencyCycleError(cycle);
      }

      state.set(seeder.name, "visiting");

      for (const dependency of seeder.dependsOn ?? []) {
        // Presence already validated above; the `!` is safe.
        visit(byName.get(dependency)!, [...path, seeder.name]);
      }

      state.set(seeder.name, "visited");
      sorted.push(seeder);
    };

    // Iterate in the incoming (order-sorted, registration-stable) sequence so
    // dependency-free seeders preserve their `order` tie-break.
    for (const seeder of seeders) {
      visit(seeder, []);
    }

    return sorted;
  }

  /**
   * Store seed results in db
   */
  public async storeSeedsResults(seeder: Seeder, result: SeedResult) {
    const oldResult = await this.getMetadata(seeder);

    // log with an emoji icon at beginning of text no of total craeted records
    console.log(`📊 Total records created: ${result.recordsCreated}`);

    // Read the single overridable clock once so every timestamp in this write
    // is identical (and pinned in a deterministic / historical run).
    const now = this.now();

    if (oldResult) {
      // Update existing record - use query builder with WHERE clause
      await this.driver
        .queryBuilder(seedsTableName)
        .where("name", seeder.name)
        .update({
          runCount: oldResult.runCount + 1,
          lastRunAt: now,
          totalRecordsCreated: oldResult.totalRecordsCreated + result.recordsCreated,
          lastRunRecordsCreated: result.recordsCreated,
        });

      // now display total created records so far
      console.log(
        `📊 Total records created so far: ${oldResult.totalRecordsCreated + result.recordsCreated}`,
      );
    } else {
      // Insert new record
      await this.driver.insert(seedsTableName, {
        name: seeder.name,
        createdAt: now,
        firstRunAt: now,
        lastRunAt: now,
        runCount: 1,
        totalRecordsCreated: result.recordsCreated,
        lastRunRecordsCreated: result.recordsCreated,
      });
    }
  }

  /**
   * Get seed info from database
   */
  protected getMetadata(seeder: Seeder): Promise<SeederMetadata> {
    const driver = this.datasource.driver;

    return driver.queryBuilder(seedsTableName).where("name", seeder.name).first();
  }

  /**
   * Get driver instance
   */
  protected get driver(): DriverContract {
    return this.datasource.driver;
  }

  /**
   * Check if seeder has been executed before
   */
  protected async seederIsExecutedBefore(seeder: Seeder) {
    return !!(await this.getMetadata(seeder));
  }
}
