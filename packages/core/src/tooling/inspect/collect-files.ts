import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readTsconfig, resolvePathAlias } from "get-tsconfig";
import { parseSync, type Node } from "oxc-parser";
import {
  isConfigFile,
  isEventFile,
  isLocaleFile,
  isMainFile,
  isRouteFile,
  isWorkerFile,
} from "../../dev-server/special-file-patterns";
import { forEachChild } from "../syntax/ast";
import { createDocLookup, readFileHeader } from "./file-comments";
import type { InspectFile, InspectWarning } from "./inspect-report.types";

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
/** Roles a `*.<role>.ts` file name sets whatever folder holds it. */
const NAMED_ROLES = new Set(["use-case", "seed", "request", "mail", "job", "event", "client"]);
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"];

export function projectFile(cwd: string, file: string): string {
  return path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join("/");
}

/**
 * `src/app/<module>`, or the first two folders of the file's path (`src/config`,
 * `mobile/app`; `mobile` for a file at the top of a scanned folder).
 */
export function fileModule(file: string): string {
  const parts = file.split("/");

  return parts[0] === "src" && parts[1] === "app" && parts.length > 3
    ? parts.slice(0, 3).join("/")
    : path.posix.dirname(file).split("/").slice(0, 2).join("/");
}

/** Infer a role from file names and the framework's directory conventions. */
export function fileRole(file: string): string {
  const stem = path.posix.basename(file).replace(CODE, "");
  if (/(?:^|\.)(?:spec|test)$/.test(stem)) return "spec";
  if (file.endsWith(".d.ts")) return "type";
  if (isConfigFile(file)) return "config";
  if (isRouteFile(file)) return "routes";
  if (isMainFile(file)) return "main";
  if (isWorkerFile(file)) return "worker";
  if (isEventFile(file)) return "event";
  if (isLocaleFile(file)) return "locale";
  // A file named for one of these says what it is, whatever folder holds it.
  for (const role of NAMED_ROLES) {
    if (stem.endsWith(`.${role}`)) return role;
  }
  // Apps that call their mails `*.email.ts` get the same role.
  if (stem.endsWith(".email")) return "mail";
  for (const role of ["routes", "page", "setup", "layout", "root"]) {
    if (stem === role || stem.endsWith(`.${role}`)) return role;
  }
  const folders = file.split("/");
  // For these roles the module folder itself does not count: `src/app/events/`
  // or `src/app/jobs/` is a module named after the word, not a folder of events.
  const innerFolders = folders.slice(folders[0] === "src" && folders[1] === "app" ? 3 : 0);
  for (const role of [
    "controller",
    "service",
    "repository",
    "model",
    "use-case",
    "seed",
    "request",
    "mail",
    "job",
    "event",
    "client",
    "migration",
    "schema",
    "resource",
    "hook",
    "component",
    "util",
    "type",
    "config",
  ]) {
    if (
      stem.endsWith(`.${role}`) ||
      (role === "mail" && innerFolders.includes("emails")) ||
      (NAMED_ROLES.has(role) ? innerFolders : folders).includes(
        role === "repository" ? "repositories" : `${role}s`,
      )
    )
      return role;
  }
  if (file.startsWith("src/config/")) return "config";
  if (file.split("/").includes("utils")) return "util";
  if (/^use[A-Z]/.test(stem)) return "hook";
  if (/\.tsx$|\.jsx$/.test(file)) return "component";
  return "source";
}

function countLines(source: string): number {
  if (source === "") return 0;
  let count = 1;
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1))
    if (index < source.length - 1) count++;
  return count;
}

function bindingNames(node: Node): string[] {
  if (node.type === "Identifier") return [node.name];
  if (node.type === "ObjectPattern")
    return node.properties.flatMap((property) =>
      bindingNames(property.type === "RestElement" ? property.argument : property.value),
    );
  if (node.type === "ArrayPattern")
    return node.elements.flatMap((element) => (element ? bindingNames(element) : []));
  if (node.type === "AssignmentPattern") return bindingNames(node.left);
  if (node.type === "RestElement") return bindingNames(node.argument);
  return [];
}

/** Options of {@link collectFiles}. */
export type CollectFilesOptions = {
  /**
   * Project-relative folders to scan. Default `["src"]`. `node_modules` and
   * hidden folders (`.expo`, `.git`) inside them are skipped.
   */
  dirs?: readonly string[];
};

/** Read each source module once; never import or execute application code. */
export function collectFiles(
  cwd: string,
  warnings: InspectWarning[] = [],
  options: CollectFilesOptions = {},
): InspectFile[] {
  cwd = path.resolve(cwd);
  const paths: string[] = [];
  const scan = (directory: string): void => {
    if (!existsSync(directory)) return;
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        // A scanned app folder (a mobile app) has its own installs and tool caches.
        if (entry.isDirectory() && (entry.name === "node_modules" || entry.name.startsWith(".")))
          continue;
        if (entry.isDirectory()) scan(file);
        else if (entry.isFile()) paths.push(file);
      }
    } catch (error) {
      warnings.push({ code: null, source: projectFile(cwd, directory), message: String(error) });
    }
  };
  for (const dir of options.dirs ?? ["src"]) scan(path.join(cwd, dir));
  const known = new Set(paths);
  paths.length = 0;
  paths.push(...[...known].sort());
  let tsconfig: ReturnType<typeof readTsconfig> | undefined;
  try {
    if (existsSync(path.join(cwd, "tsconfig.json")))
      tsconfig = readTsconfig(path.join(cwd, "tsconfig.json"), { typescriptVersion: false });
  } catch (error) {
    warnings.push({ code: null, source: "tsconfig.json", message: String(error) });
  }
  const probe = (requested: string): string | undefined => {
    // `resolvePathAlias` returns forward slashes on Windows; the scanned set holds native paths.
    const base = path.normalize(requested);
    const extension = path.extname(base);
    const stem = /\.[cm]?jsx?$/.test(extension) ? base.slice(0, -extension.length) : base;
    const candidates = stem !== base ? EXTENSIONS.map((ext) => stem + ext) : [];
    candidates.push(
      base,
      ...EXTENSIONS.map((ext) => base + ext),
      ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
    );
    return candidates.find((candidate) => known.has(candidate));
  };
  const files = paths.map((absolute): InspectFile => {
    const file = projectFile(cwd, absolute);
    const record: InspectFile = {
      file,
      module: fileModule(file),
      role: fileRole(file),
      exports: [],
      imports: [],
      importedBy: [],
    };
    if (!CODE.test(file)) return record;
    try {
      const source = readFileSync(absolute, "utf8");
      const parsed = parseSync(absolute, source);
      record.lines = countLines(source);
      for (const error of parsed.errors)
        warnings.push({ code: null, source: file, message: error.message });
      const exports = new Set<string>();
      const imports = new Set<string>();
      const exportDocs: Record<string, string> = {};
      const docAbove = createDocLookup(source, parsed.comments);
      const body = parsed.program.body;
      const header = readFileHeader(source, parsed.comments, body[0]?.start ?? source.length);
      record.about = header.about;
      record.tags = header.tags;
      for (const statement of body) {
        const names: string[] = [];
        const add = (name: string): void => {
          exports.add(name);
          names.push(name);
        };
        if (statement.type === "ExportDefaultDeclaration") add("default");
        if (statement.type === "ExportAllDeclaration")
          add(
            statement.exported
              ? statement.exported.type === "Identifier"
                ? statement.exported.name
                : String(statement.exported.value)
              : "*",
          );
        if (statement.type === "ExportNamedDeclaration") {
          for (const specifier of statement.specifiers)
            add(
              specifier.exported.type === "Identifier"
                ? specifier.exported.name
                : String(specifier.exported.value),
            );
          const declaration = statement.declaration;
          if (declaration?.type === "VariableDeclaration") {
            for (const item of declaration.declarations)
              for (const name of bindingNames(item.id)) add(name);
          } else if (declaration && "id" in declaration && declaration.id?.type === "Identifier")
            add(declaration.id.name);
        }
        if (names.length === 0) continue;
        const doc = docAbove(statement.start);
        if (doc.text && !doc.fileoverview) for (const name of names) exportDocs[name] ??= doc.text;
      }
      // A specifier is type-only when every occurrence of it in the file is erased at runtime.
      const typeOnlySpecifier = new Map<string, boolean>();
      const addImport = (specifier: string, typeOnly: boolean): void => {
        imports.add(specifier);
        typeOnlySpecifier.set(specifier, (typeOnlySpecifier.get(specifier) ?? true) && typeOnly);
      };
      const visit = (node: Node): void => {
        if (node.type === "ImportDeclaration" && node.source) {
          const specifiers = node.specifiers ?? [];
          addImport(
            String(node.source.value),
            node.importKind === "type" ||
              (specifiers.length > 0 &&
                specifiers.every(
                  (item) => item.type === "ImportSpecifier" && item.importKind === "type",
                )),
          );
        } else if (
          (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
          node.source
        )
          addImport(
            String(node.source.value),
            node.exportKind === "type" ||
              (node.type === "ExportNamedDeclaration" &&
                node.specifiers.length > 0 &&
                node.specifiers.every((item) => item.exportKind === "type")),
          );
        else if (node.type === "TSImportType" && node.source)
          addImport(String(node.source.value), true);
        if (
          node.type === "ImportExpression" &&
          node.source.type === "Literal" &&
          typeof node.source.value === "string"
        )
          addImport(node.source.value, false);
        if (
          node.type === "TSImportEqualsDeclaration" &&
          node.moduleReference.type === "TSExternalModuleReference" &&
          typeof node.moduleReference.expression.value === "string"
        )
          addImport(node.moduleReference.expression.value, node.importKind === "type");
        forEachChild(node, visit);
      };
      visit(parsed.program);
      record.exports = [...exports].sort();
      record.exportDocs = exportDocs;
      record.imports = [...imports].sort().map((specifier) => {
        const bases = specifier.startsWith(".")
          ? [path.resolve(path.dirname(absolute), specifier)]
          : tsconfig
            ? resolvePathAlias(tsconfig, specifier)
            : [];
        const resolved = bases.map(probe).find((candidate) => candidate !== undefined);
        const file = resolved ? projectFile(cwd, resolved) : null;
        return typeOnlySpecifier.get(specifier) === true
          ? { specifier, file, typeOnly: true }
          : { specifier, file };
      });
    } catch (error) {
      warnings.push({ code: null, source: file, message: String(error) });
    }
    return record;
  });
  const byFile = new Map(files.map((file) => [file.file, file]));
  for (const file of files)
    for (const imported of file.imports) {
      if (imported.file) byFile.get(imported.file)?.importedBy.push(file.file);
    }
  for (const file of files) file.importedBy = [...new Set(file.importedBy)].sort();
  return files;
}
