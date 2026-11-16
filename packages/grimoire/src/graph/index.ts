/**
 * Walks over the import graph of the book's files. Shared by the book maps
 * (files behind a step), `scry --route` (files behind a handler) and
 * `scry --impact` (files that reach a file).
 */
import type { BookFile } from "../contracts/adapter";

/** Files indexed by path, for the walks below. */
export type FileGraph = ReadonlyMap<string, Pick<BookFile, "file" | "imports" | "importedBy">>;

/** Index files by path. */
export function fileGraph(files: readonly Pick<BookFile, "file" | "imports" | "importedBy">[]): FileGraph {
  return new Map(files.map((file) => [file.file, file]));
}

function walk(graph: FileGraph, start: readonly string[], next: (file: string) => string[]): string[] {
  const seen = new Set<string>();
  const pending = [...start];

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined || seen.has(current) || !graph.has(current)) continue;

    seen.add(current);
    pending.push(...next(current));
  }

  return [...seen].sort();
}

/**
 * The start files and every project file they import, transitively, sorted.
 * Files not in the graph are left out. Cycles are walked once.
 */
export function importClosure(graph: FileGraph, start: readonly string[]): string[] {
  return walk(graph, start, (file) =>
    (graph.get(file)?.imports ?? []).flatMap((entry) => (entry.file === null ? [] : [entry.file])),
  );
}

/** The start files and every project file that imports them, transitively, sorted. */
export function importerClosure(graph: FileGraph, start: readonly string[]): string[] {
  return walk(graph, start, (file) => [...(graph.get(file)?.importedBy ?? [])]);
}

/**
 * The package name of a bare import specifier (`@warlock.js/core/tooling` →
 * `@warlock.js/core`, `dayjs/plugin/utc` → `dayjs`), or `null` for a relative
 * path, a `node:` builtin or an alias that starts with a path character.
 */
export function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return null;
  }

  const parts = specifier.split("/");

  if (specifier.startsWith("@")) {
    return parts.length >= 2 && parts[1] ? `${parts[0]}/${parts[1]}` : null;
  }

  return parts[0] || null;
}
