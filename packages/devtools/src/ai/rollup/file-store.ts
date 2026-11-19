import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DevtoolsAiRollupDelta,
  DevtoolsAiRollupRecord,
  DevtoolsAiRollupStore,
} from "../types";
import { DevtoolsAiRollupIncrementError } from "./increment-error";
import { applyAiRollupDelta, matchesAiRollupFilter } from "./memory-store";

export type FileAiRollupStoreOptions = {
  /** The folder, e.g. `storage/devtools/ai-rollups`; created on the first write. */
  directory: string;
  now?: () => number;
};

const DAY_MS = 86_400_000;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function dayName(hour: number): string {
  return new Date(hour).toISOString().slice(0, 10);
}

function dayStart(name: string): number {
  return Date.parse(`${name}T00:00:00.000Z`);
}

/**
 * The development `DevtoolsAiRollupStore`: one JSON file per UTC day
 * (`YYYY-MM-DD.json`, an array of records) in `directory`. Development runs
 * one process, so `increment` reads the day's file, adds, and writes it back
 * through a temporary file and a rename (a failed day is reported with
 * `DevtoolsAiRollupIncrementError`, the other days stay saved). `prune` deletes whole day files
 * before the cut-off and rewrites the boundary day. `verify` is `true` when
 * the folder exists or can be created. A corrupt file is renamed to
 * `<name>.corrupt-<time>` and treated as empty.
 */
export function createFileAiRollupStore(options: FileAiRollupStoreOptions): DevtoolsAiRollupStore {
  const { directory } = options;
  const now = options.now ?? Date.now;
  // Writes run one after another, so two flushes never interleave a read and a rename.
  let queue: Promise<unknown> = Promise.resolve();

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);

    queue = run.catch(() => undefined);

    return run;
  };

  const fileOf = (name: string) => path.join(directory, `${name}.json`);

  async function readDay(name: string): Promise<DevtoolsAiRollupRecord[]> {
    const file = fileOf(name);
    let text: string;

    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];

      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(text);

      if (!Array.isArray(parsed)) throw new Error("not an array");

      return parsed as DevtoolsAiRollupRecord[];
    } catch {
      await rename(file, `${file}.corrupt-${now()}`).catch(() => undefined);

      return [];
    }
  }

  async function writeDay(name: string, records: DevtoolsAiRollupRecord[]): Promise<void> {
    await mkdir(directory, { recursive: true });

    const file = fileOf(name);
    const temporary = `${file}.tmp-${process.pid}`;

    await writeFile(temporary, JSON.stringify(records), "utf8");
    await rename(temporary, file);
  }

  return {
    async verify() {
      try {
        await mkdir(directory, { recursive: true });

        return true;
      } catch {
        return false;
      }
    },
    increment(deltas) {
      return serial(async () => {
        const byDay = new Map<string, (typeof deltas)[number][]>();

        for (const delta of deltas) {
          const name = dayName(delta.hour);

          byDay.set(name, [...(byDay.get(name) ?? []), delta]);
        }

        // Each day file is written on its own; a failed day is reported so a retry never adds a saved day twice.
        const unwritten: DevtoolsAiRollupDelta[] = [];
        let firstError: unknown;

        for (const [name, dayDeltas] of byDay) {
          try {
            const rows = new Map((await readDay(name)).map((record) => [record.id, record]));

            for (const delta of dayDeltas) applyAiRollupDelta(rows, delta, now());

            await writeDay(name, [...rows.values()]);
          } catch (error) {
            firstError ??= error;
            unwritten.push(...dayDeltas);
          }
        }

        if (unwritten.length === 0) return;

        if (unwritten.length === deltas.length) throw firstError;

        throw new DevtoolsAiRollupIncrementError(unwritten, {
          written: deltas.length - unwritten.length,
          cause: firstError,
        });
      });
    },
    async list(filter) {
      if (filter.toHour <= filter.fromHour) return [];

      const found: DevtoolsAiRollupRecord[] = [];
      const first = dayStart(dayName(filter.fromHour));
      let names: string[];

      try {
        names = await readdir(directory);
      } catch {
        return [];
      }

      // Only the day files inside the range are read (a range may be open-ended).
      for (const file of names.sort()) {
        const name = DAY_FILE.exec(file)?.[1];

        if (!name) continue;

        const start = dayStart(name);

        if (start < first || start >= filter.toHour) continue;

        for (const record of await readDay(name)) {
          if (matchesAiRollupFilter(record, filter)) found.push(record);
        }
      }

      return found;
    },
    prune(beforeHour) {
      return serial(async () => {
        let names: string[];

        try {
          names = await readdir(directory);
        } catch {
          return 0;
        }

        let removed = 0;

        for (const file of names) {
          const name = DAY_FILE.exec(file)?.[1];

          if (!name) continue;

          const start = dayStart(name);

          if (start >= beforeHour) continue;

          const records = await readDay(name);

          if (start + DAY_MS <= beforeHour) {
            await rm(fileOf(name), { force: true });
            removed += records.length;

            continue;
          }

          const kept = records.filter((record) => record.hour >= beforeHour);

          if (kept.length !== records.length) {
            removed += records.length - kept.length;
            await writeDay(name, kept);
          }
        }

        return removed;
      });
    },
  };
}
