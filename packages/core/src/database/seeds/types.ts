export type SeedResult = {
  recordsCreated: number;
};

export type SeederMetadata = {
  name: string;
  createdAt: number;
  firstRunAt: number;
  lastRunAt: number;
  runCount: number;
  totalRecordsCreated: number;
  lastRunRecordsCreated: number;
};

/**
 * A minimal Cascade-model-like shape that `track` can read.
 *
 * The cascade `Model` exposes both `getTableName()` and an `id` getter;
 * this structural type keeps `track` decoupled from the concrete `Model`
 * class so seeds can also hand in lightweight test doubles.
 */
export type TrackableModel = {
  /**
   * Owning table / collection name.
   */
  getTableName(): string;
  /**
   * Primary key value.
   */
  id: number | string;
};

/**
 * A single tracked record reference, persisted to the `seed_records` table.
 */
export type SeedRecordRef = {
  /**
   * Owning seeder name.
   */
  seeder: string;
  /**
   * Table / collection the record lives in.
   */
  table: string;
  /**
   * Primary key value of the tracked record.
   */
  recordId: number | string;
  /**
   * Wall-clock time the reference was recorded.
   */
  runAt: Date;
};

/**
 * Tracker handed to a seeder's `run()` so it can register the records it
 * creates. Tracked references are written in the same transaction the manager
 * wraps `run()` in, and are read back by `warlock seed --drop` to undo a seed.
 *
 * Every overload RETURNS its first argument so it can be chained inline:
 *
 * ```ts
 * const user = track(await User.create({ ... }));
 * ```
 */
export type Track = {
  /**
   * Track a single model. Reads `model.getTableName()` + `model.id`.
   *
   * @returns the same model, so the call can be chained inline.
   */
  <T extends TrackableModel>(model: T): T;
  /**
   * Track many models in one call.
   *
   * @returns the same array, so the call can be chained inline.
   */
  <T extends TrackableModel>(models: T[]): T[];
  /**
   * Raw escape hatch — track an arbitrary table + id without a model.
   *
   * @returns the passed table name, so the call can be chained inline.
   */
  (table: string, id: number | string): string;
};

/**
 * Injectable clock. Returns the "current" time a seed run should treat as
 * `now`.
 *
 * Defaults to `() => new Date()`. Override it (via the
 * {@link SeedContext.now} the manager builds) to make historical seeds and the
 * manager's own metadata timestamps deterministic — both read from this single
 * clock, so a test or a back-fill can pin every timestamp to one value.
 */
export type SeedClock = () => Date;

/**
 * Context passed to a seeder's `run()`.
 */
export type SeedContext = {
  /**
   * Tracker used to register created records for later undo via
   * `warlock seed --drop`.
   */
  track: Track;
  /**
   * The clock the seed should read instead of an ambient `new Date()` /
   * `dayjs()`. The {@link SeedersManager} builds it from its `clock` option
   * (default `() => new Date()`) and reads the SAME clock for its own metadata
   * timestamps, so historical seeds and the seeds-log stay consistent.
   *
   * @example
   * ```ts
   * run: async ({ track, now }) => {
   *   track(await User.create({ created_at: now() }));
   * }
   * ```
   */
  now: SeedClock;
  /**
   * Suggested batch size for bulk inserts, defaulted from the seeder's
   * `batchSize`. Surfaced here so a seed can forward it to
   * `Model.createMany(rows, { batchSize })` without re-reading its own config.
   *
   * @example
   * ```ts
   * run: async ({ track, batchSize }) => {
   *   track(await User.createMany(rows, { batchSize }));
   * }
   * ```
   */
  batchSize: number;
};
