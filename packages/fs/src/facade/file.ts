import nodePath from "node:path";
import { files } from "./files";
import { Directory } from "./directory";
import type { HashAlgorithm } from "../hash";
import type {
  CopyOptions,
  FileStats,
  MergeJsonOptions,
  MoveOptions,
  ReadJsonOptions,
  ReadOptions,
  WriteJsonOptions,
  WriteOptions,
} from "./options";

function dirPathOf(dir: string | Directory): string {
  return typeof dir === "string" ? dir : dir.path;
}

/**
 * A lazy, **immutable** handle to a file path. The constructor does zero IO;
 * path helpers (`name`/`extension`/`basename`/`parent`) are pure `node:path`.
 * `copy`/`move`/`copyTo`/`moveTo`/`rename` return a NEW handle to the
 * destination and never mutate `this.path`.
 *
 * @example
 * const pkg = fs.file("package.json");
 * await pkg.editJson<Pkg>((p) => ({ ...p, version: "4.7.0" }));
 * pkg.extension; // ".json"
 */
export class File {
  public constructor(public readonly path: string) {}

  /** Basename including extension (`"user.model.ts"`). */
  public get name(): string {
    return nodePath.basename(this.path);
  }

  /** Basename without extension (`"user.model"`). */
  public get basename(): string {
    return nodePath.basename(this.path, nodePath.extname(this.path));
  }

  /** Extension including the dot (`".ts"`), or `""` when there is none. */
  public get extension(): string {
    return nodePath.extname(this.path);
  }

  /** Handle to the parent directory (pure path — no IO). */
  public parent(): Directory {
    return new Directory(nodePath.dirname(this.path));
  }

  public get(): Promise<string>;
  public get(options: ReadOptions & { encoding: null }): Promise<Buffer>;
  public get(options: ReadOptions): Promise<string | Buffer>;
  public get(options?: ReadOptions): Promise<string | Buffer> {
    return files.get(this.path, (options ?? {}) as ReadOptions);
  }

  public getJson<T = unknown>(options?: ReadJsonOptions<T>): Promise<T> {
    return files.getJson<T>(this.path, options);
  }

  public put(content: string | Buffer, options?: WriteOptions): Promise<void> {
    return files.put(this.path, content, options);
  }

  public putJson(value: unknown, options?: WriteJsonOptions): Promise<void> {
    return files.putJson(this.path, value, options);
  }

  public append(content: string | Buffer, options?: WriteOptions): Promise<void> {
    return files.append(this.path, content, options);
  }

  public prepend(content: string | Buffer, options?: WriteOptions): Promise<void> {
    return files.prepend(this.path, content, options);
  }

  public appendJsonLine(value: unknown): Promise<void> {
    return files.appendJsonLine(this.path, value);
  }

  public edit(editor: (content: string) => string | Promise<string>): Promise<void> {
    return files.edit(this.path, editor);
  }

  public editJson<T = unknown>(
    editor: (value: T) => T | Promise<T>,
    options?: WriteJsonOptions,
  ): Promise<void> {
    return files.editJson<T>(this.path, editor, options);
  }

  public mergeJson<T = Record<string, unknown>>(
    partial: Partial<T>,
    options?: MergeJsonOptions,
  ): Promise<void> {
    return files.mergeJson<T>(this.path, partial, options);
  }

  public exists(): Promise<boolean> {
    return files.exists(this.path);
  }

  public isEmpty(): Promise<boolean> {
    return files.isEmpty(this.path);
  }

  public ensure(): Promise<void> {
    return files.ensure(this.path);
  }

  public touch(): Promise<void> {
    return files.touch(this.path);
  }

  public remove(): Promise<void> {
    return files.remove(this.path);
  }

  public async copy(to: string, options?: CopyOptions): Promise<File> {
    await files.copy(this.path, to, options);
    return new File(to);
  }

  /** Copy into a directory, keeping this file's name. */
  public async copyTo(dir: string | Directory, options?: CopyOptions): Promise<File> {
    const target = nodePath.join(dirPathOf(dir), this.name);
    await files.copy(this.path, target, options);
    return new File(target);
  }

  public async move(to: string, options?: MoveOptions): Promise<File> {
    await files.move(this.path, to, options);
    return new File(to);
  }

  /** Move into a directory, keeping this file's name. */
  public async moveTo(dir: string | Directory, options?: MoveOptions): Promise<File> {
    const target = nodePath.join(dirPathOf(dir), this.name);
    await files.move(this.path, target, options);
    return new File(target);
  }

  /** Rename within the same parent directory. */
  public async rename(newName: string, options?: MoveOptions): Promise<File> {
    const target = nodePath.join(nodePath.dirname(this.path), newName);
    await files.move(this.path, target, options);
    return new File(target);
  }

  public stats(): Promise<FileStats> {
    return files.stats(this.path);
  }

  public size(): Promise<number> {
    return files.size(this.path);
  }

  public lastModified(): Promise<Date> {
    return files.lastModified(this.path);
  }

  public hash(algorithm?: HashAlgorithm): Promise<string> {
    return files.hash(this.path, algorithm);
  }

  public readLines(): AsyncIterable<string> {
    return files.readLines(this.path);
  }
}
