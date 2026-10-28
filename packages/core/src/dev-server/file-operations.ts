import events from "@mongez/events";
import type { DependencyGraph } from "./dependency-graph";
import { DEV_SERVER_EVENTS } from "./events";
import { FileManager } from "./file-manager";
import type { ManifestManager } from "./manifest-manager";
import { parseImports } from "./parse-imports";
import { Path } from "../utils/normalized-path";
import type { SpecialFilesCollector } from "./special-files-collector";
import { areSetsEqual } from "./utils";

/**
 * FileOperations — add/update/delete lifecycle for a single file.
 *
 * Coordinates the dependency graph, manifest, and special-files collector
 * so the orchestrator and event handler can stay declarative.
 */
export class FileOperations {
  /**
   * Import-specifier index: last path segment of every relative or aliased
   * string in a file's source, mapped to the files that mention it. Lets
   * `reloadFilesWaitingForDependency` look up the few files that could be
   * waiting for a new file instead of re-parsing every tracked file for each
   * file added (quadratic on a large app's boot).
   */
  private readonly specifierIndex = new Map<string, Set<string>>();

  /** Index keys each file contributed, so an update or delete can undo them. */
  private readonly indexedKeys = new Map<string, Set<string>>();

  public constructor(
    private readonly files: Map<string, FileManager>,
    private readonly dependencyGraph: DependencyGraph,
    private readonly manifest: ManifestManager,
    private readonly specialFilesCollector: SpecialFilesCollector,
  ) {}

  /**
   * Register and process a new file. Recursively pulls in any
   * not-yet-tracked dependencies so the dep graph is complete.
   *
   * `followDependencies: false` registers the file and its direct import edges
   * only. A caller that needs one file's own metadata (a config file, loaded
   * before the rest of the project is scanned) must not pay for walking every
   * module that file reaches, dynamic imports included.
   */
  public async addFile(
    relativePath: string,
    options: { followDependencies?: boolean } = {},
  ): Promise<FileManager> {
    const existing = this.files.get(relativePath);
    if (existing) return existing;

    const fileManager = new FileManager(Path.toAbsolute(relativePath), this.files, this);

    // Register before processing so recursive deps see us.
    this.files.set(relativePath, fileManager);

    await fileManager.process();
    this.indexSource(relativePath, fileManager);

    for (const depPath of options.followDependencies === false ? [] : fileManager.dependencies) {
      if (!this.files.has(depPath)) {
        try {
          await this.addFile(depPath);
        } catch {
          // External or missing — let the importer surface it at load time.
        }
      }
    }

    for (const dependency of fileManager.dependencies) {
      this.dependencyGraph.addDependency(relativePath, dependency);
    }

    this.specialFilesCollector.addFile(fileManager);

    await this.reloadFilesWaitingForDependency(relativePath);

    return fileManager;
  }

  /**
   * Reprocess a file after a change. Re-syncs the dep graph and special-files
   * collector when its imports or path classification shift.
   */
  public async updateFile(relativePath: string): Promise<boolean> {
    const fileManager = this.files.get(relativePath);
    if (!fileManager) {
      await this.addFile(relativePath);
      return true;
    }

    const oldDependencies = new Set(fileManager.dependencies);

    try {
      const hasChanged = await fileManager.process();
      if (!hasChanged) return false;

      this.indexSource(relativePath, fileManager);

      if (!areSetsEqual(oldDependencies, fileManager.dependencies)) {
        this.dependencyGraph.updateFile(
          relativePath,
          fileManager.dependencies,
          fileManager.typeOnlyDependencies,
        );
      }

      this.specialFilesCollector.updateFile(fileManager);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a file. Notifies dependents so they surface broken-import errors.
   */
  public async deleteFile(relativePath: string): Promise<void> {
    const fileManager = this.files.get(relativePath);
    if (!fileManager) return;

    const dependents = this.dependencyGraph.getDependents(relativePath);

    this.unindexSource(relativePath);
    this.dependencyGraph.removeFile(relativePath);
    this.specialFilesCollector.removeFile(relativePath);
    this.manifest.removeFile(relativePath);

    for (const dependentPath of dependents) {
      const dependentFile = this.files.get(dependentPath);
      if (dependentFile) {
        events.trigger(DEV_SERVER_EVENTS.FILE_READY, dependentFile);
      }
    }

    // Slight delay so in-flight reads still find the FileManager.
    setTimeout(() => this.files.delete(relativePath), 300);
  }

  /**
   * Re-process any file whose imports might now resolve to a freshly added
   * file. Covers "import A from './b'" where b.ts only just got created.
   */
  private async reloadFilesWaitingForDependency(newFilePath: string): Promise<void> {
    const dependents: string[] = [];
    const candidates = new Set<string>();

    for (const key of FileOperations.indexKeysForPath(newFilePath)) {
      for (const candidate of this.specifierIndex.get(key) ?? []) {
        candidates.add(candidate);
      }
    }

    for (const existingPath of candidates) {
      if (existingPath === newFilePath) continue;

      const existingFile = this.files.get(existingPath);
      if (!existingFile || existingFile.state !== "ready") continue;

      // Already resolved to the new file (the usual case while the boot scan
      // walks imports): nothing would change by re-processing it.
      if (existingFile.dependencies.has(newFilePath)) continue;

      try {
        const importMap = await parseImports(existingFile.source, existingFile.absolutePath);
        for (const [, resolved] of importMap) {
          if (resolved && Path.toRelative(resolved.absolutePath) === newFilePath) {
            dependents.push(existingPath);
            break;
          }
        }
      } catch {
        continue;
      }
    }

    for (const dependentPath of dependents) {
      const dependentFile = this.files.get(dependentPath);
      if (!dependentFile) continue;
      try {
        await dependentFile.process({ force: true });
        this.dependencyGraph.updateFile(
          dependentPath,
          dependentFile.dependencies,
          dependentFile.typeOnlyDependencies,
        );
      } catch {
        // File still has issues — ignore.
      }
    }
  }

  /** Index keys a file at `relativePath` can be imported under. */
  private static indexKeysForPath(relativePath: string): string[] {
    const segments = relativePath.split("/").filter(Boolean);
    const last = (segments.pop() ?? "").replace(/\.[^./]+$/, "");
    const keys = [last];

    // `./folder` resolves to `folder/index.ts`.
    if (last === "index" && segments.length > 0) keys.push(segments[segments.length - 1]!);

    return keys;
  }

  private indexSource(relativePath: string, fileManager: FileManager): void {
    this.unindexSource(relativePath);

    const keys = new Set<string>();
    const literal = /["']([^"'\n]{1,300})["']/g;
    let match: RegExpExecArray | null;

    while ((match = literal.exec(fileManager.source)) !== null) {
      const specifier = match[1]!;
      // Relative and aliased specifiers only; bare packages never resolve to
      // a project file.
      if (!/^(\.|[@~#$]?[\w-]*\/)/.test(specifier) && !specifier.startsWith("@")) continue;

      const segments = specifier.split("/").filter((segment) => segment && segment !== ".");
      const last = (segments.pop() ?? "").replace(/\.[^./]+$/, "");
      if (last && last !== "..") keys.add(last);
    }

    this.indexedKeys.set(relativePath, keys);

    for (const key of keys) {
      let paths = this.specifierIndex.get(key);
      if (!paths) this.specifierIndex.set(key, (paths = new Set()));
      paths.add(relativePath);
    }
  }

  private unindexSource(relativePath: string): void {
    const keys = this.indexedKeys.get(relativePath);
    if (!keys) return;

    for (const key of keys) {
      const paths = this.specifierIndex.get(key);
      paths?.delete(relativePath);
      if (paths?.size === 0) this.specifierIndex.delete(key);
    }

    this.indexedKeys.delete(relativePath);
  }

  public updateFileDependents(): void {
    for (const [relativePath, fileManager] of this.files) {
      fileManager.dependents = this.dependencyGraph.getDependents(relativePath);
    }
  }

  public syncFilesToManifest(): void {
    for (const [relativePath, fileManager] of this.files) {
      this.manifest.setFile(relativePath, fileManager.toManifest());
    }
  }
}
