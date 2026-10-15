import { warlockPath } from "../utils";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";

export const MANIFEST_PATH = warlockPath("manifest.json");

/**
 * Number of files to process in parallel per batch
 * Adjust this value to optimize performance vs memory usage
 * - Lower values (10-20): More stable, less memory, slower
 * - Higher values (100-200): Faster, more memory, potential instability
 * - Recommended: 50 for most projects
 */
export const FILE_PROCESSING_BATCH_SIZE = 500;

/**
 * Whether the opt-in per-phase reload timing line (`devServer.timings`) is
 * on. Read through the same `warlockConfigManager` every other dev-server
 * debug knob already goes through (e.g. `transpileCacheDebug`) rather than
 * an env var, so a project author looks in one place for every dev-server
 * debug switch. `isLoaded` guards the synchronous `get()` call — which
 * throws before config has loaded — so this stays safe to call from
 * anywhere in the reload pipeline, including paths that could in principle
 * run before boot finishes.
 */
export function isTimingsEnabled(): boolean {
  if (!warlockConfigManager.isLoaded) return false;
  return warlockConfigManager.get("devServer")?.timings === true;
}
