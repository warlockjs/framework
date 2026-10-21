import type { InspectFile, InspectPage, InspectReport, InspectRoute } from "./inspect-report.types";
import { projectFile } from "./collect-files";

export type ExplainedFile = InspectFile & {
  /** Entry points whose static imports transitively reach this file. */
  routes: InspectRoute[];
  pages: InspectPage[];
  warnings: InspectReport["warnings"];
};

/** Explain a project-relative or absolute source path against one inspect snapshot. */
export function explainFile(requested: string, report: InspectReport): ExplainedFile {
  const requestedFile = projectFile(report.app.root, requested);
  const files = new Map((report.files ?? []).map((file) => [file.file, file]));
  const file = files.get(requestedFile);
  if (!file) throw new Error(`Source file ${JSON.stringify(requested)} was not found under src/.`);

  // Walk reverse edges once, including cycles and the entry point itself.
  const reached = new Set<string>();
  const pending = [file.file];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || reached.has(current)) continue;
    reached.add(current);
    pending.push(...(files.get(current)?.importedBy ?? []));
  }
  const reaches = (entry: string): boolean => reached.has(projectFile(report.app.root, entry));
  return {
    ...file,
    routes: (report.routes ?? []).filter(
      (route) => route.sourceFile !== null && reaches(route.sourceFile),
    ),
    pages: (report.pages ?? []).filter((page) =>
      [page.file, ...page.layouts, ...page.loaders].some(reaches),
    ),
    warnings: report.warnings,
  };
}

export function formatFileExplanation(file: ExplainedFile): string[] {
  return [
    `${file.file}  (${file.role})`,
    `  Module: ${file.module}`,
    `  Exports: ${file.exports.join(", ") || "none"}`,
    `  Imports: ${file.imports.map((entry) => entry.file ?? entry.specifier).join(", ") || "none"}`,
    `  Imported by: ${file.importedBy.join(", ") || "none"}`,
    `  Routes: ${file.routes.map((route) => `${route.method} ${route.path}`).join(", ") || "none"}`,
    `  Pages: ${file.pages.map((page) => page.path).join(", ") || "none"}`,
    ...file.warnings.map((warning) => `  Warning: ${warning.message}`),
  ];
}
