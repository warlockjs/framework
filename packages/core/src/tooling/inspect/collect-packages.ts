import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolve as resolveModule } from "import-meta-resolve";
import type {
  InspectJob,
  InspectPackage,
  InspectSchedule,
  InspectWarning,
} from "./inspect-report.types";

/**
 * Import a package the way the APP resolves it, so inspect reads the same
 * module instance (and registry) the app's own modules populated. Resolves to
 * `undefined` when the app does not have the package.
 */
export type AppModuleImporter = (specifier: string) => Promise<unknown>;

/** The default {@link AppModuleImporter}: resolve from `<cwd>/package.json`, then import. */
export function createAppModuleImporter(cwd: string): AppModuleImporter {
  return async (specifier) => {
    let url: string;

    try {
      url = resolveModule(specifier, pathToFileURL(path.join(cwd, "package.json")).href);
    } catch {
      return undefined;
    }

    return import(url);
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;

  const field = Reflect.get(value, key);

  return typeof field === "string" ? field : null;
}

/** The app's own `name` and `version`. */
export function readAppPackage(cwd: string): { name: string | null; version: string | null } {
  const manifest = readJson(path.join(cwd, "package.json"));

  return { name: stringField(manifest, "name"), version: stringField(manifest, "version") };
}

/** Every `@warlock.js/*` package installed at the app root, with its version. */
export function collectPackages(cwd: string): InspectPackage[] {
  const scope = path.join(cwd, "node_modules", "@warlock.js");
  let entries: string[];

  try {
    entries = readdirSync(scope);
  } catch {
    return [];
  }

  const packages: InspectPackage[] = [];

  for (const entry of entries) {
    const manifest = readJson(path.join(scope, entry, "package.json"));
    const name = stringField(manifest, "name");
    const version = stringField(manifest, "version");

    if (name && version) packages.push({ name, version });
  }

  return packages.sort((first, second) => first.name.localeCompare(second.name));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function retentionOf(value: unknown): boolean | number | null {
  return typeof value === "boolean" || typeof value === "number" ? value : null;
}

function backoffOf(value: unknown): InspectJob["backoff"] {
  if (typeof value === "number") return value;

  if (typeof value === "object" && value !== null) {
    const type = Reflect.get(value, "type");
    const delay = Reflect.get(value, "delay");

    if (typeof type === "string" && typeof delay === "number") return { type, delay };
  }

  return null;
}

/**
 * The jobs `defineJob()` registered, read from the app's `@warlock.js/queue`
 * (`registeredJobs()` / `queueOf()`). Empty when the app has no queue package.
 */
export async function collectJobs(
  importFromApp: AppModuleImporter,
  warnings: InspectWarning[],
): Promise<InspectJob[]> {
  let queue: unknown;

  try {
    queue = await importFromApp("@warlock.js/queue");
  } catch (error) {
    warnings.push({
      code: null,
      message: `@warlock.js/queue could not be loaded: ${errorMessage(error)}`,
      source: "jobs",
    });
    return [];
  }

  if (typeof queue !== "object" || queue === null) return [];

  const registered = Reflect.get(queue, "registeredJobs");
  const queueOf = Reflect.get(queue, "queueOf");

  if (typeof registered !== "function") return [];

  const jobs: unknown = registered();

  if (!Array.isArray(jobs)) return [];

  return jobs
    .filter((job): job is object => typeof job === "object" && job !== null)
    .map((job) => {
      const queueName: unknown =
        typeof queueOf === "function" ? queueOf(job) : Reflect.get(job, "queue");

      return {
        name: stringField(job, "name") ?? "anonymous",
        queue: typeof queueName === "string" ? queueName : "default",
        attempts: numberOrNull(Reflect.get(job, "attempts")),
        backoff: backoffOf(Reflect.get(job, "backoff")),
        removeOnComplete: retentionOf(Reflect.get(job, "removeOnComplete")),
        removeOnFail: retentionOf(Reflect.get(job, "removeOnFail")),
      };
    })
    .sort((first, second) => first.name.localeCompare(second.name));
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;

  const toISOString = Reflect.get(value, "toISOString");

  if (typeof toISOString !== "function") return null;

  const iso: unknown = toISOString.call(value);

  return typeof iso === "string" ? iso : null;
}

/**
 * The tasks on the app's `@warlock.js/scheduler` scheduler (`scheduler.list()`):
 * name, cron expression, interval settings and next run. Empty when absent.
 */
export async function collectSchedules(
  importFromApp: AppModuleImporter,
  warnings: InspectWarning[],
): Promise<InspectSchedule[]> {
  let module: unknown;

  try {
    module = await importFromApp("@warlock.js/scheduler");
  } catch (error) {
    warnings.push({
      code: null,
      message: `@warlock.js/scheduler could not be loaded: ${errorMessage(error)}`,
      source: "schedules",
    });
    return [];
  }

  if (typeof module !== "object" || module === null) return [];

  const scheduler: unknown = Reflect.get(module, "scheduler");
  const list =
    typeof scheduler === "object" && scheduler !== null
      ? Reflect.get(scheduler, "list")
      : undefined;

  if (typeof list !== "function") return [];

  const tasks: unknown = list.call(scheduler);

  if (!Array.isArray(tasks)) return [];

  return tasks
    .filter((task): task is object => typeof task === "object" && task !== null)
    .map((task) => {
      const intervals: unknown = Reflect.get(task, "intervals");

      return {
        name: stringField(task, "name") ?? "anonymous",
        cron: stringField(task, "cronExpression"),
        intervals:
          typeof intervals === "object" && intervals !== null
            ? Object.fromEntries(Object.entries(intervals))
            : {},
        nextRun: isoOrNull(Reflect.get(task, "nextRun")),
      };
    })
    .sort((first, second) => first.name.localeCompare(second.name));
}
