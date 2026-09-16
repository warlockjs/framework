import { defaultQueueName } from "./config";
import type { JobDefinition } from "./types";

/** A registered definition, payload/result erased for storage. */
export type RegisteredJob = JobDefinition<unknown, unknown>;

type RegistryListener = (job: RegisteredJob) => void;

const jobs = new Map<string, RegisteredJob>();
const listeners = new Set<RegistryListener>();

/**
 * Register a definition under its name.
 *
 * Re-registering a name REPLACES the previous definition: in development a
 * job module is re-evaluated on every reload, and refusing the second
 * evaluation would break the reload. Job names must therefore be unique
 * across the app — two different modules using one name leave only the
 * later handler active.
 */
export function registerJob(job: RegisteredJob): void {
  jobs.set(job.name, job);

  for (const listener of listeners) {
    listener(job);
  }
}

/** The definition registered under `name`, if any. */
export function findRegisteredJob(name: string): RegisteredJob | undefined {
  return jobs.get(name);
}

/** Every registered definition. */
export function registeredJobs(): RegisteredJob[] {
  return [...jobs.values()];
}

/** The queue a definition runs on, resolved against the active config. */
export function queueOf(job: Pick<RegisteredJob, "queue">): string {
  return job.queue ?? defaultQueueName();
}

/** Be told whenever a job is registered. Returns an unsubscribe function. */
export function onJobRegistered(listener: RegistryListener): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}
