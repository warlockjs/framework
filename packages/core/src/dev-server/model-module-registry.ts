import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { container } from "../container";
import type {
  DevelopmentModelModuleEntry,
  DevelopmentModelModules,
} from "../container/development-model-modules";

type StoredEntry = DevelopmentModelModuleEntry & { readonly namespace?: object };

function normalizeInputPath(absolutePath: string): string {
  const slashNormalized = path.resolve(absolutePath).replaceAll("\\", "/");
  return process.platform === "win32" ? slashNormalized.toLowerCase() : slashNormalized;
}

function canonicalPath(absolutePath: string): string {
  let resolvedPath = path.resolve(absolutePath);

  try {
    resolvedPath = fs.realpathSync.native(resolvedPath);
  } catch {
    // A deleted model must still resolve to the key it had before deletion.
  }

  return normalizeInputPath(resolvedPath);
}

/** Internal writer for the container's read-only development model carrier. */
export class DevelopmentModelModuleRegistry implements DevelopmentModelModules {
  private readonly entries = new Map<string, StoredEntry>();
  private readonly aliases = new Map<string, string>();
  private readonly listeners = new Set<(entry: DevelopmentModelModuleEntry) => void>();

  public get(absolutePath: string): DevelopmentModelModuleEntry | undefined {
    const inputPath = normalizeInputPath(absolutePath);
    const key = this.aliases.get(inputPath) ?? canonicalPath(absolutePath);
    const entry = this.entries.get(key);
    if (entry !== undefined) this.aliases.set(inputPath, key);
    return entry === undefined ? undefined : this.toPublicEntry(entry);
  }

  public subscribe(listener: (entry: DevelopmentModelModuleEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public publish(absolutePath: string, url: string, namespace: object): void {
    const inputPath = normalizeInputPath(absolutePath);
    const key = canonicalPath(absolutePath);
    this.aliases.set(inputPath, key);
    const current = this.entries.get(key);

    if (current?.state === "ready" && current.namespace === namespace) return;

    const entry: StoredEntry = {
      url,
      generation: (current?.generation ?? 0) + 1,
      hasDefault: Object.hasOwn(namespace, "default"),
      state: "ready",
      namespace,
    };
    this.entries.set(key, entry);
    this.notify(entry);
  }

  public remove(absolutePath: string): void {
    const inputPath = normalizeInputPath(absolutePath);
    const key = this.aliases.get(inputPath) ?? canonicalPath(absolutePath);
    this.aliases.set(inputPath, key);
    const current = this.entries.get(key);

    if (current?.state === "removed") return;

    const entry: DevelopmentModelModuleEntry = {
      url: current?.url ?? pathToFileURL(absolutePath).href,
      generation: (current?.generation ?? 0) + 1,
      hasDefault: false,
      state: "removed",
    };
    this.entries.set(key, entry);
    this.notify(entry);
  }

  private notify(entry: DevelopmentModelModuleEntry): void {
    const publicEntry = this.toPublicEntry(entry);
    for (const listener of this.listeners) listener(publicEntry);
  }

  private toPublicEntry(entry: DevelopmentModelModuleEntry): DevelopmentModelModuleEntry {
    return {
      url: entry.url,
      generation: entry.generation,
      hasDefault: entry.hasDefault,
      state: entry.state,
    };
  }
}

export function getDevelopmentModelModuleRegistry(): DevelopmentModelModuleRegistry {
  const existing = container.tryGet("development.modelModules");

  if (existing instanceof DevelopmentModelModuleRegistry) return existing;

  const registry = new DevelopmentModelModuleRegistry();
  container.set("development.modelModules", registry);
  return registry;
}
