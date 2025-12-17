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
 * Modules currently being loaded
 * Used to detect and handle circular dependencies
 */
const loadingModules = new Set<string>();

/**
 * Module import promise cache
 * Maps module paths to their import promises
 * Prevents duplicate imports and handles circular dependencies
 */
const modulePromises = new Map<string, Promise<any>>();

/**
 * Get last version of timestamp for a module
 * if not found set it then return it
 */
function useModuleVersion(modulePath: string): number {
  const cleanPath = modulePath.startsWith("./") ? modulePath.slice(2) : modulePath;

  if (!moduleVersions.has(cleanPath)) {
    moduleVersions.set(cleanPath, Date.now());
  }

  return moduleVersions.get(cleanPath)!;
}

function getModuleVersion(modulePath: string): number {
  const cleanPath = modulePath.startsWith("./") ? modulePath.slice(2) : modulePath;

  return moduleVersions.get(cleanPath) || Date.now();
}

/**
 * Dynamic import with cache busting and circular dependency protection
 *
 * @param modulePath - The relative cache path (e.g., "./src-app-users-shared-utils.js")
 * @returns The imported module
 */
async function __import(modulePath: string): Promise<any> {
  // Normalize the module path (remove leading "./" if present)
  const cleanPath = modulePath.startsWith("./") ? modulePath.slice(2) : modulePath;

  // Check if this module is already being loaded (circular dependency detected)
  if (loadingModules.has(cleanPath)) {
    // Return the existing promise - this prevents deadlock
    // The promise should already be cached since we cache it before marking as loading
    const existingPromise = modulePromises.get(cleanPath);
    if (existingPromise) {
      return existingPromise;
    }

    // This should rarely happen, but handle the edge case where promise isn't cached yet
    // This can occur in a race condition scenario
    throw new Error(
      `Circular dependency detected: Module "${cleanPath}" is being loaded but no promise is cached. This may indicate a timing issue in module loading.`,
    );
  }

  // Get the current version timestamp for this module
  const timestamp = useModuleVersion(modulePath);

  // Resolve the module path relative to the cache directory
  const absolutePath = warlockCachePath(cleanPath);

  // Convert to file:// URL for cross-platform compatibility
  const fileUrl = pathToFileURL(absolutePath).href;

  // Append timestamp as query parameter to bust cache
  const moduleUrl = `${fileUrl}?t=${timestamp}`;

  // Create the import promise and cache it BEFORE marking as loading
  // This ensures circular dependencies can always find the promise
  const importPromise = import(moduleUrl);
  modulePromises.set(cleanPath, importPromise);

  // Mark module as loading AFTER caching the promise
  // This order is critical for circular dependency handling
  loadingModules.add(cleanPath);

  try {
    // Wait for the import to complete
    const module = await importPromise;

    return module;
  } catch (error) {
    // Remove from cache on error so it can be retried
    modulePromises.delete(cleanPath);
    throw error;
  } finally {
    // Mark module as no longer loading
    loadingModules.delete(cleanPath);
  }
}

/**
 * Update the version timestamp for a module
 * This forces the next import to load a fresh version
 *
 * @param modulePath - The path to the module
 * @param timestamp - Optional timestamp (defaults to current time)
 */
function __updateModuleVersion(modulePath: string, timestamp?: number): void {
  // Normalize the module path
  const cleanPath = modulePath.startsWith("./") ? modulePath.slice(2) : modulePath;

  // Update the version timestamp
  moduleVersions.set(modulePath, timestamp || Date.now());

  // Clear the cached promise so the new version gets loaded
  // Only clear if the module is not currently loading (to avoid breaking circular deps)
  if (!loadingModules.has(cleanPath)) {
    modulePromises.delete(cleanPath);
  }
}

/**
 * Clear version for a module (reset to default behavior)
 *
 * @param modulePath - The path to the module
 */
function __clearModuleVersion(modulePath: string): void {
  const cleanPath = modulePath.startsWith("./") ? modulePath.slice(2) : modulePath;

  moduleVersions.delete(modulePath);

  // Clear cached promise if not currently loading
  if (!loadingModules.has(cleanPath)) {
    modulePromises.delete(cleanPath);
  }
}

/**
 * Clear all module versions and caches
 */
function __clearAllModuleVersions(): void {
  moduleVersions.clear();

  // Clear all cached promises that aren't currently loading
  for (const [path] of modulePromises) {
    if (!loadingModules.has(path)) {
      modulePromises.delete(path);
    }
  }
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
