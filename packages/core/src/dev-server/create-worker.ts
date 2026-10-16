import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
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
 * loaded through tsx's `tsImport` API from a JavaScript bootstrap; published
 * `.mjs` workers run as-is.
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

  if (isSource) {
    // Node 22.15 resolves a worker's entry before tsx's --import hook can
    // handle its .ts extension. Bootstrap JS, then load the entry through
    // tsx's supported API instead. Resolve from core, even when the app does
    // not depend on tsx directly.
    const require = createRequire(import.meta.url);
    const tsxApi = pathToFileURL(require.resolve("tsx/esm/api")).href;
    const bootstrap = `import(${JSON.stringify(tsxApi)}).then(({ tsImport }) => tsImport(${JSON.stringify(workerUrl.href)}, ${JSON.stringify(baseUrl)}));`;
    return new Worker(bootstrap, { ...workerOptions, eval: true });
  }

  return new Worker(workerFilePath, workerOptions);
}
