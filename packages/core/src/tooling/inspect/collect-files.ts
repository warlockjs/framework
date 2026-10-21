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
import type { InspectFile, InspectWarning } from "./inspect-report.types";

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"];

export function projectFile(cwd: string, file: string): string {
  return path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join("/");
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
  for (const role of ["routes", "page", "setup", "layout", "root"]) {
    if (stem === role || stem.endsWith(`.${role}`)) return role;
  }
  for (const role of [
    "controller",
    "service",
    "repository",
    "model",
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
      file.split("/").includes(role === "repository" ? "repositories" : `${role}s`)
    )
      return role;
  }
  if (file.startsWith("src/config/")) return "config";
  if (file.split("/").includes("utils")) return "util";
  if (/^use[A-Z]/.test(stem)) return "hook";
  if (/\.tsx$|\.jsx$/.test(file)) return "component";
  return "source";
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

/** Read each source module once; never import or execute application code. */
export function collectFiles(cwd: string, warnings: InspectWarning[] = []): InspectFile[] {
  cwd = path.resolve(cwd);
  const paths: string[] = [];
  const scan = (directory: string): void => {
    if (!existsSync(directory)) return;
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (entry.isFile()) paths.push(file);
      }
    } catch (error) {
      warnings.push({ code: null, source: projectFile(cwd, directory), message: String(error) });
    }
  };
  scan(path.join(cwd, "src"));
  paths.sort();
  const known = new Set(paths);
  let tsconfig: ReturnType<typeof readTsconfig> | undefined;
  try {
    if (existsSync(path.join(cwd, "tsconfig.json")))
      tsconfig = readTsconfig(path.join(cwd, "tsconfig.json"), { typescriptVersion: false });
  } catch (error) {
    warnings.push({ code: null, source: "tsconfig.json", message: String(error) });
  }
  const probe = (base: string): string | undefined => {
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
    const parts = file.split("/");
    const record: InspectFile = {
      file,
      module:
        parts[1] === "app" && parts.length > 3
          ? parts.slice(0, 3).join("/")
          : path.posix.dirname(file).split("/").slice(0, 2).join("/"),
      role: fileRole(file),
      exports: [],
      imports: [],
      importedBy: [],
    };
    if (!CODE.test(file)) return record;
    try {
      const parsed = parseSync(absolute, readFileSync(absolute, "utf8"));
      for (const error of parsed.errors)
        warnings.push({ code: null, source: file, message: error.message });
      const exports = new Set<string>();
      const imports = new Set<string>();
      for (const statement of parsed.program.body) {
        if (statement.type === "ExportDefaultDeclaration") exports.add("default");
        if (statement.type === "ExportAllDeclaration")
          exports.add(
            statement.exported
              ? statement.exported.type === "Identifier"
                ? statement.exported.name
                : String(statement.exported.value)
              : "*",
          );
        if (statement.type !== "ExportNamedDeclaration") continue;
        for (const specifier of statement.specifiers)
          exports.add(
            specifier.exported.type === "Identifier"
              ? specifier.exported.name
              : String(specifier.exported.value),
          );
        const declaration = statement.declaration;
        if (declaration?.type === "VariableDeclaration") {
          for (const item of declaration.declarations)
            for (const name of bindingNames(item.id)) exports.add(name);
        } else if (declaration && "id" in declaration && declaration.id?.type === "Identifier")
          exports.add(declaration.id.name);
      }
      const visit = (node: Node): void => {
        if (
          (node.type === "ImportDeclaration" ||
            node.type === "ExportNamedDeclaration" ||
            node.type === "ExportAllDeclaration" ||
            node.type === "TSImportType") &&
          node.source
        )
          imports.add(String(node.source.value));
        if (
          node.type === "ImportExpression" &&
          node.source.type === "Literal" &&
          typeof node.source.value === "string"
        )
          imports.add(node.source.value);
        if (
          node.type === "TSImportEqualsDeclaration" &&
          node.moduleReference.type === "TSExternalModuleReference" &&
          typeof node.moduleReference.expression.value === "string"
        )
          imports.add(node.moduleReference.expression.value);
        forEachChild(node, visit);
      };
      visit(parsed.program);
      record.exports = [...exports].sort();
      record.imports = [...imports].sort().map((specifier) => {
        const bases = specifier.startsWith(".")
          ? [path.resolve(path.dirname(absolute), specifier)]
          : tsconfig
            ? resolvePathAlias(tsconfig, specifier)
            : [];
        const resolved = bases.map(probe).find((candidate) => candidate !== undefined);
        return { specifier, file: resolved ? projectFile(cwd, resolved) : null };
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
