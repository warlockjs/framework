/**
 * Lazily load `@warlock.js/queue` — the optional peer backing the `bullmq`
 * queue driver (`bullmqQueue()`). Mirrors `loadHerald`'s lazy-optional-peer
 * pattern: the dynamic import runs at most once and is memoized, and a
 * missing package surfaces a curated, named error at USE time rather than a
 * boot-time resolution error.
 *
 * The `loader` parameter exists so specs can inject a failing import without
 * needing the real package installed or uninstalled.
 */
import { QueuePackageNotInstalledError } from "./queue-package-not-installed.error";

/** A function that performs the dynamic import of `@warlock.js/queue`. */
export type QueuePackageLoader = () => Promise<typeof import("@warlock.js/queue")>;

const defaultLoader: QueuePackageLoader = () => import("@warlock.js/queue");

let queueModule: typeof import("@warlock.js/queue") | undefined;

/**
 * Resolve `@warlock.js/queue`, memoized after the first successful load.
 * Throws {@link QueuePackageNotInstalledError} when the import fails.
 */
export async function loadQueuePackage(
  loader: QueuePackageLoader = defaultLoader,
): Promise<typeof import("@warlock.js/queue")> {
  if (queueModule) {
    return queueModule;
  }

  try {
    queueModule = await loader();
    return queueModule;
  } catch {
    throw new QueuePackageNotInstalledError();
  }
}
