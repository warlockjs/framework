import config from "@mongez/config";
import { storagePath, uploadsPath } from "../utils/paths";
import type { StorageDriverConfig } from "./types";

let runtimeConfigurations: (() => ReadonlyMap<string, StorageDriverConfig>) | undefined;

/** The first manager is the singleton; keep storage out of cache-housekeeping imports. */
export function registerLocalDiskConfigurations(
  read: () => ReadonlyMap<string, StorageDriverConfig>,
): void {
  runtimeConfigurations ??= read;
}

/** Configured and runtime-registered local roots, without instantiating any drivers. */
export function configuredLocalDiskRoots(): string[] {
  const configured = config.get("storage.drivers", {}) as Record<string, StorageDriverConfig>;
  const runtime = runtimeConfigurations?.();
  const entries = [...Object.values(configured), ...(runtime?.values() ?? [])];
  if (!Object.hasOwn(configured, "local") && !runtime?.has("local")) {
    entries.push({ driver: "local", root: uploadsPath() });
  }
  return entries
    .filter((entry) => entry.driver === "local")
    .map((entry) => entry.root ?? storagePath());
}
