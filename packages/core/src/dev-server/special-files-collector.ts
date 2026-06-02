import { FileManager } from "./file-manager";

export type SpecialFileType = "config" | "main" | "route" | "event" | "locale";

/**
 * Categorises files into the kinds the dev server treats specially
 * (config / main / route / event / locale) and exposes typed accessors.
 */
export class SpecialFilesCollector {
  private readonly buckets: Record<SpecialFileType, Map<string, FileManager>> = {
    config: new Map(),
    main: new Map(),
    route: new Map(),
    event: new Map(),
    locale: new Map(),
  };

  public collect(files: Map<string, FileManager>): void {
    for (const bucket of Object.values(this.buckets)) bucket.clear();
    for (const [relativePath, fileManager] of files) {
      this.categorise(relativePath, fileManager);
    }
  }

  public addFile(fileManager: FileManager): void {
    this.categorise(fileManager.relativePath, fileManager);
  }

  public removeFile(relativePath: string): void {
    for (const bucket of Object.values(this.buckets)) bucket.delete(relativePath);
  }

  public updateFile(fileManager: FileManager): void {
    this.removeFile(fileManager.relativePath);
    this.categorise(fileManager.relativePath, fileManager);
  }

  public getFileType(relativePath: string): SpecialFileType | null {
    for (const [type, bucket] of Object.entries(this.buckets) as [
      SpecialFileType,
      Map<string, FileManager>,
    ][]) {
      if (bucket.has(relativePath)) return type;
    }
    return null;
  }

  public getFilesByType(type: SpecialFileType): FileManager[] {
    const files = Array.from(this.buckets[type].values());
    // Routes are loaded sequentially in alphabetical order so registration
    // is deterministic across runs.
    if (type === "route") {
      files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }
    return files;
  }

  public getStats(): Record<SpecialFileType, number> {
    return {
      config: this.buckets.config.size,
      main: this.buckets.main.size,
      route: this.buckets.route.size,
      event: this.buckets.event.size,
      locale: this.buckets.locale.size,
    };
  }

  public clear(): void {
    for (const bucket of Object.values(this.buckets)) bucket.clear();
  }

  private categorise(relativePath: string, fileManager: FileManager): void {
    if (isConfigFile(relativePath)) {
      this.buckets.config.set(relativePath, fileManager);
    } else if (isMainFile(relativePath)) {
      this.buckets.main.set(relativePath, fileManager);
    } else if (isRouteFile(relativePath)) {
      this.buckets.route.set(relativePath, fileManager);
    } else if (isEventFile(relativePath)) {
      this.buckets.event.set(relativePath, fileManager);
    } else if (isLocaleFile(relativePath)) {
      this.buckets.locale.set(relativePath, fileManager);
    }
  }
}

const isConfigFile = (path: string) => /^src\/config\/.*\.(ts|tsx)$/.test(path);
const isMainFile = (path: string) =>
  /^src\/app\/[^/]+\/main\.(ts|tsx)$/.test(path) ||
  path === "src/app/main.ts" ||
  path === "src/app/main.tsx";
const isRouteFile = (path: string) => /^src\/app\/[^/]+\/routes\.(ts|tsx)$/.test(path);
const isEventFile = (path: string) => /^src\/app\/[^/]+\/events\/[^/]+\.(ts|tsx)$/.test(path);
const isLocaleFile = (path: string) => /^src\/app\/[^/]+\/utils\/locales\.(ts|tsx)$/.test(path);
