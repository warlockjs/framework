import type { EnvironmentOverride } from "./detect-environment-overrides";

/**
 * The environment overrides {@link detectEnvironmentOverrides} found on this
 * boot, kept so a LATER point in the boot can ask which `.env` keys the ambient
 * process environment beat — WITHOUT re-reading `.env` or `process.env` a second
 * time, and without re-deriving the comparison.
 *
 * Why this exists: `reportPortInUse` (`src/http/boot-port-preflight.ts`) runs
 * far downstream of `loadEnvironmentFiles()` and needs to know whether the
 * colliding `http.port` came from an ambient `HTTP_PORT` (in which case
 * "edit src/config/http.ts and rebuild" is ACTIVELY WRONG — the env var wins,
 * so the rebuild changes nothing) or from config (where that advice is right).
 * The detector already knows this at env-load time; the provenance has to
 * travel to the point of use rather than be recomputed there (finding
 * 8782b840, requirement 3).
 *
 * Keyed by env var name, last-write-wins — a single boot loads env at most once
 * (`loadEnvironmentFiles` latches), and a deliberate dev-server reload re-records
 * the current truth.
 */
let recorded = new Map<string, EnvironmentOverride>();

/**
 * Record the overrides detected on this boot. Replaces any prior record, so a
 * re-load reflects the current environment rather than accumulating stale keys.
 */
export function recordEnvironmentOverrides(overrides: EnvironmentOverride[]): void {
  recorded = new Map(overrides.map((override) => [override.key, override]));
}

/**
 * The recorded override for `key`, or `undefined` if the ambient environment
 * did not beat a `.env` value for it on this boot. The returned object is the
 * detector's own finding (effective value + the `.env` value it overrode), so a
 * caller can name both without recomputing either.
 */
export function getRecordedEnvironmentOverride(key: string): EnvironmentOverride | undefined {
  return recorded.get(key);
}

/**
 * Forget every recorded override.
 *
 * @internal For tests, which run many boots inside one process.
 */
export function clearRecordedEnvironmentOverrides(): void {
  recorded = new Map();
}
