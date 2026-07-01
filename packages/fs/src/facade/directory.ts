import nodePath from "node:path";
import { dirs } from "./dirs";
import { File } from "./file";
import type { HashAlgorithm } from "../hash";
import type {
  CopyOptions,
  FileStats,
  ListOptions,
  MoveOptions,
  WalkEntry,
  WalkOptions,
} from "./options";

/**
 * A lazy, **immutable** handle to a directory path. The constructor does zero
 * IO; path helpers (`name`/`parent`/`file`/`dir`) are pure `node:path`.
 * `copy`/`move` return a NEW handle to the destination. `listFiles`/`listDirs`
 * return `File`/`Directory` handles (not bare strings).
 *
 * @example
 * const src = fs.dir("src");
 * for (const f of await src.listFiles({ recursive: true })) {
 *   if (f.extension === ".ts") { ... }
 * }
 */
export class Directory {
  public constructor(public readonly path: string) {}

  /** Basename of this directory (`"users"`). */
  public get name(): string {
    return nodePath.basename(this.path);
  }

  /** Handle to the parent directory (pure path — no IO). */
  public parent(): Directory {
    return new Directory(nodePath.dirname(this.path));
  }

  /** Handle to a child file (pure path — no IO). */
  public file(...segments: string[]): File {
    return new File(nodePath.join(this.path, ...segments));
  }

  /** Handle to a child directory (pure path — no IO). */
  public dir(...segments: string[]): Directory {
    return new Directory(nodePath.join(this.path, ...segments));
  }

  public ensure(): Promise<void> {
    return dirs.ensure(this.path);
  }

  public remove(): Promise<void> {
    return dirs.remove(this.path);
  }

  public empty(): Promise<void> {
    return dirs.empty(this.path);
  }

  public exists(): Promise<boolean> {
    return dirs.exists(this.path);
  }

  public isEmpty(): Promise<boolean> {
    return dirs.isEmpty(this.path);
  }

  public count(): Promise<number> {
    return dirs.count(this.path);
  }

  public async copy(to: string, options?: CopyOptions): Promise<Directory> {
    await dirs.copy(this.path, to, options);
    return new Directory(to);
  }

  public async move(to: string, options?: MoveOptions): Promise<Directory> {
    await dirs.move(this.path, to, options);
    return new Directory(to);
  }

  public stats(): Promise<FileStats> {
    return dirs.stats(this.path);
  }

  public size(): Promise<number> {
    return dirs.size(this.path);
  }

  public list(options?: ListOptions): Promise<string[]> {
    return dirs.list(this.path, options);
  }

  public async listFiles(options?: ListOptions): Promise<File[]> {
    return (await dirs.listFiles(this.path, options)).map((path) => new File(path));
  }

  public async listDirs(options?: ListOptions): Promise<Directory[]> {
    return (await dirs.listDirs(this.path, options)).map((path) => new Directory(path));
  }

  public walk(options?: WalkOptions): AsyncIterable<WalkEntry> {
    return dirs.walk(this.path, options);
  }

  public hash(algorithm?: HashAlgorithm): Promise<string> {
    return dirs.hash(this.path, algorithm);
  }
}
