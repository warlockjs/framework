import path from "node:path";
import { fileURLToPath } from "url";
import { Worker, type WorkerOptions } from "worker_threads";

/**
 * Options for creating a health check worker
 */
export type CreateWorkerOptions = WorkerOptions & {
  /**
   * Worker data to pass to the worker thread
   */
  workerData?: Record<string, unknown>;
};

/**
 * Create a worker that works in both dev (TypeScript) and production (JavaScript) environments.
 *
 * The worker shares the CALLING module's extension: `.ts` when core runs from
 * source (loaded via tsx), `.mjs` when core is published. Source workers are
 * run through the tsx loader; published `.mjs` workers run as-is.
 *
 * @param workerPath - Relative path to worker file WITHOUT extension (e.g., "./workers/ts-health.worker")
 * @param baseUrl - The import.meta.url of the calling module (used to resolve relative paths)
 * @param options - Additional worker options
 * @returns A new Worker instance
 *
 * @example
 * ```typescript
 * // In FilesHealthcareManager
 * const worker = createWorker(
 *   "./workers/ts-health.worker",
 *   import.meta.url,
 *   { workerData: { cwd: process.cwd() } }
 * );
 * ```
 */
export function createWorker(
  workerPath: string,
  baseUrl: string,
  options?: CreateWorkerOptions,
): Worker {
  // The worker shares the CALLING module's extension: `.ts` from source (needs the
  // tsx loader to execute), `.mjs` when core is published.
  const callerExtension = path.extname(fileURLToPath(baseUrl));
  const isSource = callerExtension === ".ts" || callerExtension === ".tsx";
  const workerUrl = new URL(`${workerPath}${callerExtension}`, baseUrl);
  const workerFilePath = fileURLToPath(workerUrl);

  const workerOptions: WorkerOptions = {
    ...options,
  };

  // Source workers are TypeScript — run them through the tsx loader.
  if (isSource) {
    workerOptions.execArgv = [...(options?.execArgv || []), "--import", "tsx/esm"];
  }

  return new Worker(workerFilePath, workerOptions);
}
