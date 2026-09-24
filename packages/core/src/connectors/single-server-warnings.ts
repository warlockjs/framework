import type { Environment } from "../utils/environment";

const IN_PROCESS_CACHE_NAMES = ["memory", "memoryextended", "lru"];
const IN_PROCESS_CACHE_CLASSES = ["memorycachedriver", "memoryextendedcachedriver", "lrumemorycachedriver"];

/**
 * Warning for a production app whose default cache driver keeps data in this
 * process only. Returns `undefined` when there is nothing to warn about.
 */
export function memoryCacheWarning(
  defaultDriverName: string | undefined,
  driverClassName: string | undefined,
  env: Environment,
  silenced = false,
): string | undefined {
  if (env !== "production" || silenced || !defaultDriverName) return undefined;

  const byName = IN_PROCESS_CACHE_NAMES.includes(defaultDriverName.toLowerCase());
  const byClass =
    !!driverClassName && IN_PROCESS_CACHE_CLASSES.includes(driverClassName.toLowerCase());

  if (!byName && !byClass) return undefined;

  return (
    `cache: the default driver '${defaultDriverName}' keeps data in this process only. ` +
    "With more than one server, repository cache clears, locks and counters don't reach the other servers. " +
    "Use the redis or pg cache driver in production, or set cache.silenceSingleServerWarning = true."
  );
}

/**
 * Warning for a production app whose default storage driver is the local disk.
 */
export function localStorageWarning(
  defaultDriverName: string | undefined,
  env: Environment,
  silenced = false,
): string | undefined {
  if (env !== "production" || silenced || defaultDriverName !== "local") return undefined;

  return (
    "storage: the default driver 'local' keeps files on this server's disk only. " +
    "With more than one server, uploads written on one server are missing on the others. " +
    "Use an S3 or R2 storage driver in production, or set storage.silenceSingleServerWarning = true."
  );
}
