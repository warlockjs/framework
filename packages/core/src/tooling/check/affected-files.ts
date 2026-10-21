import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CompilerSession } from "../typescript/compiler";
import { importSpecifiers } from "../syntax/imports";
import { resolveSpecifier } from "./conventions-step";
import { listSourceFiles, listTestFiles } from "./source-files";

/** Transitive reverse import closure, including re-exports and type-only imports. */
export async function affectedFiles(
  cwd: string,
  changed: readonly string[],
  project = "tsconfig.json",
): Promise<string[]> {
  if (!changed.length) return [];
  const selected = new Set(changed.map((file) => path.resolve(cwd, file)));
  const session = existsSync(path.resolve(cwd, project))
    ? new CompilerSession(cwd, path.resolve(cwd, project))
    : undefined;
  try {
    const files = new Set([
      ...(await listSourceFiles(cwd)),
      ...(await listTestFiles(cwd)),
      ...(session?.fileNames ?? [])
        .filter(
          (file) =>
            file.startsWith(cwd + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`),
        )
        .map((file) => path.relative(cwd, file)),
    ]);
    const edges = [...files].map((file) => {
      const absolute = path.resolve(cwd, file);
      const imports = [
        ...(session?.importFiles(absolute) ?? []),
        ...importSpecifiers(file, readFileSync(absolute, "utf8")).flatMap(({ specifier }) => {
          const target = resolveSpecifier(specifier, file, cwd);
          if (!target && (specifier.startsWith(".") || specifier.startsWith("app/"))) {
            const base = specifier.startsWith(".")
              ? path.resolve(cwd, path.dirname(file), specifier)
              : path.resolve(cwd, "src", specifier);
            const candidates = [
              base,
              ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"].map(
                (extension) => base + extension,
              ),
            ];
            return candidates.filter((candidate) => selected.has(candidate));
          }
          return target ? [path.resolve(cwd, target)] : [];
        }),
      ];
      return { absolute, imports };
    });
    let added = true;
    while (added) {
      added = false;
      for (const edge of edges)
        if (
          !selected.has(edge.absolute) &&
          edge.imports.some((file) => selected.has(path.resolve(file)))
        ) {
          selected.add(edge.absolute);
          added = true;
        }
    }
    return [...selected]
      .filter((file) => existsSync(file))
      .map((file) => path.relative(cwd, file).split(path.sep).join("/"))
      .sort();
  } finally {
    session?.close();
  }
}
