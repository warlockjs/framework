import { pathToFileURL } from "node:url";
import { warlockCachePath } from "./utils";

/**
 * Runtime Import Helper
 *
 * This module provides a global __import function that handles cache busting
 * for HMR. Instead of static imports, we transform them to use this helper
 * which appends timestamps to force module reloads.
 *
 * Example transformation:
 *   FROM: import { foo } from "./bar.js"
 *   TO:   const { foo } = await __import("./bar.js")
 */

/**
 * Module version registry
 * Maps module paths to their current version timestamp
 */
const moduleVersions = new Map<string, number>();

/**
 * Dynamic import with cache busting
 *
 * @param modulePath - The relative cache path (e.g., "./src-app-users-shared-utils.js")
 * @returns The imported module
 */
async function __import(modulePath: string): Promise<any> {
  // Get the current version timestamp for this module
  const timestamp = moduleVersions.get(modulePath) || Date.now();

  // Resolve the module path relative to the cache directory
  // Remove leading "./" if present
  const cleanPath = modulePath.startsWith("./")
    ? modulePath.slice(2)
    : modulePath;
  const absolutePath = warlockCachePath(cleanPath);

  // Convert to file:// URL for cross-platform compatibility
  const fileUrl = pathToFileURL(absolutePath).href;

  // Append timestamp as query parameter to bust cache
  const moduleUrl = `${fileUrl}?t=${timestamp}`;

  // Dynamic import with cache busting
  return await import(moduleUrl);
}

/**
 * Update the version timestamp for a module
 * This forces the next import to load a fresh version
 *
 * @param modulePath - The path to the module
 * @param timestamp - Optional timestamp (defaults to current time)
 */
function __updateModuleVersion(modulePath: string, timestamp?: number): void {
  moduleVersions.set(modulePath, timestamp || Date.now());
}

/**
 * Clear version for a module (reset to default behavior)
 *
 * @param modulePath - The path to the module
 */
function __clearModuleVersion(modulePath: string): void {
  moduleVersions.delete(modulePath);
}

/**
 * Clear all module versions
 */
function __clearAllModuleVersions(): void {
  moduleVersions.clear();
}

/**
 * Get current version timestamp for a module
 *
 * @param modulePath - The path to the module
 * @returns The timestamp or undefined if not set
 */
function __getModuleVersion(modulePath: string): number | undefined {
  return moduleVersions.get(modulePath);
}

// Make functions available globally
declare global {
  var __import: (modulePath: string) => Promise<any>;
  var __updateModuleVersion: (modulePath: string, timestamp?: number) => void;
  var __clearModuleVersion: (modulePath: string) => void;
  var __clearAllModuleVersions: () => void;
  var __getModuleVersion: (modulePath: string) => number | undefined;
}

// Export for initialization
export function initializeRuntimeImportHelper(): void {
  (global as any).__import = __import;
  (global as any).__updateModuleVersion = __updateModuleVersion;
  (global as any).__clearModuleVersion = __clearModuleVersion;
  (global as any).__clearAllModuleVersions = __clearAllModuleVersions;
  (global as any).__getModuleVersion = __getModuleVersion;
}
