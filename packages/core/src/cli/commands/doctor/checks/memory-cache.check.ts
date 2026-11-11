import { MemoryCacheDriver } from "@warlock.js/cache";
import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";
import { warnOnError } from "./config-values";

/** Whether `driver` is the memory driver class or one built on it (`memoryExtended`). */
function isMemoryDriver(driver: unknown): boolean {
  return (
    typeof driver === "function" &&
    (driver === MemoryCacheDriver || driver.prototype instanceof MemoryCacheDriver)
  );
}

/**
 * Warns when the default cache store keeps entries in process memory with no
 * size limit (`maxSize: Infinity`, `0`, or any value the driver does not read
 * as a positive number, such as `null`).
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
export const memoryCacheCheck: DoctorCheck = warnOnError({
  name: "memory-cache",
  run: () => {
    const selected: unknown = config.get("cache.default");

    if (typeof selected !== "string" || selected.trim().length === 0) return undefined;

    const name = selected.trim();

    if (!isMemoryDriver(config.get(`cache.drivers.${name}`))) return undefined;

    const key = `cache.options.${name}.maxSize`;
    const options: unknown = config.get(`cache.options.${name}`);
    const maxSize: unknown =
      typeof options === "object" && options !== null
        ? (options as { maxSize?: unknown }).maxSize
        : undefined;

    // Only an absent `maxSize` takes the default, as in the driver.
    if (maxSize === undefined) {
      return {
        name: "memory-cache",
        status: "ok",
        detail: `the "${name}" cache keeps at most 10000 entries (the default ${key})`,
      };
    }

    // The driver keeps `maxSize` when it is above 0 and drops the limit
    // otherwise (`0`, a negative number, `null`, a non-numeric string).
    if (!((maxSize as number) > 0) || maxSize === Infinity) {
      return {
        name: "memory-cache",
        status: "warn",
        detail:
          `the default cache "${name}" has no size limit (${key}: ${String(maxSize)}) — keys built from ` +
          "request input can grow the process heap until it runs out of memory. Set " +
          `${key} to a bound such as 10_000; the least recently used entries are evicted past it.`,
      };
    }

    return {
      name: "memory-cache",
      status: "ok",
      detail: `the "${name}" cache keeps at most ${String(maxSize)} entries`,
    };
  },
});
