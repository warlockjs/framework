/**
 * Runs the source scan (`collectFiles`) in a worker thread, so a large app's scan never blocks the event loop of
 * the process that serves the app. The scan reads and parses every source file synchronously; on thousands of
 * files that is seconds. The worker only reads files; the result comes back as plain data.
 *
 * Returns `null` when the worker cannot run (the tooling entry does not resolve to a plain module a worker can
 * load, or the worker fails); the caller then scans in the current thread, which gives the same answer.
 */
import { Worker } from "node:worker_threads";

/** The worker's body: load the tooling entry, scan, post the files back. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
import(workerData.entry)
  .then(({ collectFiles }) => {
    parentPort.postMessage({ files: collectFiles(workerData.root, [], workerData.options) });
  })
  .catch((error) => {
    parentPort.postMessage({ error: String(error && error.message ? error.message : error) });
  });
`;

/** The scan options the worker passes to `collectFiles`. */
export type OffThreadScan = {
  root: string;
  dirs: readonly string[];
  files: readonly string[];
};

/** Scan in a worker thread; `null` when it could not (scan in the current thread instead). */
export async function collectOffThread<File>(scan: OffThreadScan): Promise<File[] | null> {
  let entry: string;

  try {
    if (typeof import.meta.resolve !== "function") return null;

    entry = import.meta.resolve("@warlock.js/core/tooling");

    // A worker loads plain JavaScript only: a TypeScript source entry (a checkout of the framework) is scanned in-thread.
    if (/\.[cm]?tsx?$/.test(entry)) return null;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let worker: Worker;

    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
          entry,
          root: scan.root,
          options: { dirs: [...scan.dirs], files: [...scan.files] },
        },
      });
    } catch {
      resolve(null);

      return;
    }

    let settled = false;
    const finish = (files: File[] | null): void => {
      if (settled) return;

      settled = true;
      void worker.terminate();
      resolve(files);
    };

    worker.once("message", (message: { files?: File[]; error?: string }) =>
      finish(message.files ?? null),
    );
    worker.once("error", () => finish(null));
    worker.once("exit", () => finish(null));
  });
}
