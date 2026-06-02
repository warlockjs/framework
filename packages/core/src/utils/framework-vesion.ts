import { getJsonFileAsync } from "@warlock.js/fs";
import path from "node:path";

/**
 * Cached version string
 */
let cachedVersion: string | null = null;

/**
 * Get the framework version from package.json (cached)
 */
export async function getWarlockVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;

  const frameworkPackageJson = (await getJsonFileAsync(
    path.join(import.meta.dirname, "./../../package.json"),
  )) as { version: string };

  const version = frameworkPackageJson.version.replace(/\^|\~/g, "");
  cachedVersion = version;
  return version;
}

export function getFrameworkVersion(): string | null {
  return cachedVersion;
}
