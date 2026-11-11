import { MemoryCacheDriver } from "@warlock.js/cache";
import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";

/** Whether `driver` is the memory driver class or one built on it (`memoryExtended`). */
function isMemoryDriver(driver: unknown): boolean {
  return (
    typeof driver === "function" &&
    (driver === MemoryCacheDriver || driver.prototype instanceof MemoryCacheDriver)
  );
}

/**
 * Warns when the default cache store keeps entries in process memory with no
 * size limit (`maxSize: Infinity` or `0`).
 *
 * Cached repository reads and `cached()` calls are keyed by request input, so
 * an unbounded in-memory store grows with every distinct request until the
 * process runs out of memory. Unset, `maxSize` is 10,000 entries, evicting the
 * least recently used.
 *
 * Only the DEFAULT store is read: `cache.drivers` is a menu the scaffold fills
 * with every driver the framework ships, and a store nobody selected holds
 * nothing.
 *
 * NEEDS NO BOOTED APP — it reads config only. Silent when the default store is
 * not a memory driver.
 */
export const memoryCacheCheck: DoctorCheck = {
  name: "memory-cache",
  run: () => {
    const selected: unknown = config.get("cache.default");

    if (typeof selected !== "string" || selected.trim().length === 0) return undefined;

    const name = selected.trim();

    if (!isMemoryDriver(config.get(`cache.drivers.${name}`))) return undefined;

    const key = `cache.options.${name}.maxSize`;
    const maxSize: unknown = config.get(key);

    if (typeof maxSize !== "number") {
      return {
        name: "memory-cache",
        status: "ok",
        detail: `the "${name}" cache keeps at most 10000 entries (the default ${key})`,
      };
    }

    // The driver treats anything but a positive finite number as "no limit".
    if (!(maxSize > 0) || maxSize === Infinity) {
      return {
        name: "memory-cache",
        status: "warn",
        detail:
          `the default cache "${name}" has no size limit (${key}: ${maxSize}) — keys built from ` +
          "request input can grow the process heap until it runs out of memory. Set " +
          `${key} to a bound such as 10_000; the least recently used entries are evicted past it.`,
      };
    }

    return {
      name: "memory-cache",
      status: "ok",
      detail: `the "${name}" cache keeps at most ${maxSize} entries`,
    };
  },
};
