import { pathToFileURL } from "node:url";
import { container } from "../container";
import type {
  DevelopmentAppModuleEntry,
  DevelopmentAppModules,
} from "../container/development-app-modules";

/**
 * The SAME key normalization the loader hook thread uses for its version map
 * (`loader/version-registry.ts`). It is what keeps `generation` equal to the
 * hook's version for a path: both sides count bumps per this key.
 */
function normalizeKey(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/").toLowerCase();
}

/** Internal writer for the container's read-only development app-module carrier. */
export class DevelopmentAppModuleRegistry implements DevelopmentAppModules {
  private readonly entries = new Map<string, DevelopmentAppModuleEntry>();
  private readonly listeners = new Set<(entry: DevelopmentAppModuleEntry) => void>();

  public get(absolutePath: string): DevelopmentAppModuleEntry | undefined {
    return this.entries.get(normalizeKey(absolutePath));
  }

  public subscribe(listener: (entry: DevelopmentAppModuleEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Record that the hook thread has processed one more bump of this file.
   * Call only after the hook thread acknowledged it (`flushVersionBumps`).
   */
  public bump(absolutePath: string): void {
    const key = normalizeKey(absolutePath);
    const entry: DevelopmentAppModuleEntry = {
      url: pathToFileURL(absolutePath).href,
      generation: (this.entries.get(key)?.generation ?? 0) + 1,
    };

    this.entries.set(key, entry);

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // A subscriber's invalidation failure must never abort the reload batch.
      }
    }
  }
}

export function getDevelopmentAppModuleRegistry(): DevelopmentAppModuleRegistry {
  const existing = container.tryGet("development.appModules");

  if (existing instanceof DevelopmentAppModuleRegistry) return existing;

  const registry = new DevelopmentAppModuleRegistry();
  container.set("development.appModules", registry);
  return registry;
}
