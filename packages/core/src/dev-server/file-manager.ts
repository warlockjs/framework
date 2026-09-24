import events from "@mongez/events";
import { getFileAsync, lastModifiedAsync } from "@warlock.js/fs";
import crypto from "crypto";
import { DEV_SERVER_EVENTS } from "./events";
import { type FileOperations } from "./file-operations";
import { isTypeOnlyFile, parseImports } from "./parse-imports";
import { Path } from "../utils/normalized-path";
import type { FileManifest, FileState, FileType } from "./types";

export type CleanupFunction = () => void;

/**
 * Whether `error` is a Node `ENOENT` (path does not exist) error. Used to
 * distinguish a file that has genuinely vanished between the watcher event
 * and its read/stat (a rename or move racing the filesystem) from a real
 * failure such as `EACCES` or a parse error, which must still surface.
 */
function isEnoentError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * FileManager â€” per-file metadata for the dependency graph.
 *
 * The loader hook transpiles and caches on-demand at import time, so this
 * class never touches disk for anything beyond reading source to hash it
 * and parse its imports. Its job is keeping the metadata that the
 * orchestrator needs to invalidate dependents on change.
 */
export class FileManager {
  public relativePath = "";
  public lastModified = 0;
  public hash = "";
  public source = "";

  /** Files this file imports (relative paths). */
  public dependencies = new Set<string>();

  /**
   * Subset of `dependencies` reached only through type-only imports â€” a single
   * runtime occurrence makes the whole edge runtime.
   */
  public typeOnlyDependencies = new Set<string>();

  /** Original specifier â†’ resolved absolute path. */
  public importMap = new Map<string, string>();

  /** Files that import this file (relative paths). */
  public dependents = new Set<string>();

  public type: FileType | undefined;

  /** Cleanup hooks the loaded module registered for itself. */
  public cleanup: CleanupFunction[] = [];

  /** Whether the source has zero runtime imports/exports. */
  public isTypeOnlyFile = false;

  public state: FileState = "idle";

  public constructor(
    public readonly absolutePath: string,
    public files: Map<string, FileManager>,
    public fileOperations: FileOperations,
  ) {}

  public addCleanup(cleanup: CleanupFunction | CleanupFunction[]) {
    const next = Array.isArray(cleanup) ? cleanup : [cleanup];
    this.cleanup.push(...next);
    this.cleanup = [...new Set(this.cleanup)];
  }

  public resetCleanup() {
    this.cleanup = [];
  }

  /**
   * Initial setup. Restores from manifest if the hash still matches,
   * otherwise re-processes from disk.
   */
  public async init(fileManifest?: Partial<FileManifest>): Promise<void> {
    this.relativePath = Path.toRelative(this.absolutePath);
    this.detectFileType();

    if (fileManifest) {
      await this.initFromManifest(fileManifest);
    } else {
      await this.process();
    }
  }

  /**
   * Read source, hash, parse imports, emit ready. The only file-system
   * touch happens here; transpilation is the loader hook's job.
   *
   * Both the read and the stat happen up front, before anything on this
   * instance is mutated. A path that disappears between the watcher event
   * and either of those calls (`ENOENT`) — typically a rename or move
   * racing the filesystem — is treated as a deletion rather than a thrown
   * error, and never leaves `source`/`hash` pointing at content that then
   * vanished. A real failure (`EACCES`, a permissions error, etc.) still
   * throws.
   *
   * @param force - re-parse even when the hash matches.
   * @returns true if the file was (re)parsed.
   */
  public async process({ force = false }: { force?: boolean } = {}): Promise<boolean> {
    if (!this.relativePath) this.relativePath = Path.toRelative(this.absolutePath);
    if (!this.type) this.detectFileType();

    this.state = "loading";

    let newSource: string;
    let modifiedTime: Date;

    try {
      newSource = await getFileAsync(this.absolutePath);
      modifiedTime = await lastModifiedAsync(this.absolutePath);
    } catch (error) {
      if (isEnoentError(error)) {
        this.state = "deleted";
        return false;
      }

      throw error;
    }

    const newHash = crypto.createHash("sha256").update(newSource).digest("hex");

    if (!force && newHash === this.hash) {
      this.state = "ready";
      return false;
    }

    this.source = newSource;
    this.hash = newHash;
    this.lastModified = modifiedTime.getTime();

    await this.rebuildImportMetadata();
    this.isTypeOnlyFile = isTypeOnlyFile(this.source);

    this.state = "ready";
    events.trigger(DEV_SERVER_EVENTS.FILE_READY, this);

    return true;
  }

  /**
   * Parse the current source and refresh `importMap`, `dependencies`, and
   * `typeOnlyDependencies`. A dependency is classified type-only iff every
   * import/export statement that resolves to it is type-only â€” a single
   * runtime reference makes the whole edge runtime.
   */
  protected async rebuildImportMetadata(): Promise<void> {
    const resolved = await parseImports(this.source, this.absolutePath);

    this.importMap = new Map();
    this.dependencies = new Set();
    this.typeOnlyDependencies = new Set();

    const runtimePaths = new Set<string>();

    for (const [originalPath, { absolutePath, isTypeOnly }] of resolved) {
      this.importMap.set(originalPath, absolutePath);

      const relativePath = Path.toRelative(absolutePath);
      this.dependencies.add(relativePath);

      if (!isTypeOnly) {
        runtimePaths.add(relativePath);
      }
    }

    for (const dependency of this.dependencies) {
      if (!runtimePaths.has(dependency)) {
        this.typeOnlyDependencies.add(dependency);
      }
    }
  }

  /**
   * Restore from a cached manifest entry. If the on-disk hash matches the
   * manifest hash, dep-graph metadata is restored from the manifest without
   * re-parsing. Otherwise the file is reprocessed.
   */
  protected async initFromManifest(fileManifest: Partial<FileManifest>): Promise<void> {
    this.type = fileManifest.type;

    this.state = "loading";

    try {
      this.source = await getFileAsync(this.absolutePath);
    } catch {
      this.state = "deleted";
      return;
    }

    const currentHash = crypto.createHash("sha256").update(this.source).digest("hex");

    if (currentHash !== fileManifest.hash) {
      await this.process({ force: true });
      return;
    }

    this.hash = fileManifest.hash!;
    this.lastModified = fileManifest.lastModified!;
    this.dependencies = new Set(fileManifest.dependencies || []);
    this.typeOnlyDependencies = new Set(fileManifest.typeOnlyDependencies || []);
    this.dependents = new Set(fileManifest.dependents || []);

    this.state = "ready";
    events.trigger(DEV_SERVER_EVENTS.FILE_READY, this);
  }

  protected detectFileType(): void {
    const path = this.relativePath;

    if (/(^|\/)main\.tsx?$/.test(path)) {
      this.type = "main";
    } else if (/\.model\.tsx?$/.test(path)) {
      // Before the folder-name checks below: `events/models/x.model.ts` is a model.
      this.type = "model";
    } else if (path.startsWith("src/config/")) {
      this.type = "config";
    } else if (path.endsWith("routes.ts") || path.endsWith("routes.tsx")) {
      this.type = "route";
    } else if (path.includes("/events/")) {
      this.type = "event";
    } else if (path.includes("controller")) {
      this.type = "controller";
    } else if (path.includes("service")) {
      this.type = "service";
    } else {
      this.type = "other";
    }
  }

  public toManifest(): FileManifest {
    return {
      absolutePath: this.absolutePath,
      relativePath: this.relativePath,
      lastModified: this.lastModified,
      hash: this.hash,
      dependencies: Array.from(this.dependencies),
      typeOnlyDependencies: Array.from(this.typeOnlyDependencies),
      dependents: Array.from(this.dependents),
      type: this.type!,
    };
  }
}
