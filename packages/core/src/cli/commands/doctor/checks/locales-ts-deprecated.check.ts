import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { config } from "../../../../config/config-getter";
import {
  parseLocaleDictionary,
  type LocaleDictionaryEntries,
} from "../../../../localization/parse-locale-dictionary";
import { appPath, rootPath } from "../../../../utils/paths";
import type { DoctorCheck } from "../check.types";

type LocaleSource = {
  file: string;
  module: string;
};

export type LocaleInspection = LocaleSource & {
  convertible: boolean;
  reason: string;
  group?: string;
  dictionary?: Record<string, unknown>;
  entries?: LocaleDictionaryEntries;
};

function localeSources(): LocaleSource[] {
  const appDirectory = appPath();
  if (!existsSync(appDirectory)) return [];

  return readdirSync(appDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      file: path.join(appDirectory, entry.name, "utils", "locales.ts"),
      module: entry.name,
    }))
    .filter(({ file }) => existsSync(file));
}

function propertyName(property: ts.PropertyAssignment): string | undefined {
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    return property.name.text;
  return undefined;
}

function literalObject(node: ts.Expression): Record<string, unknown> | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const value: Record<string, unknown> = Object.create(null);
  for (const member of node.properties) {
    if (!ts.isPropertyAssignment(member)) return undefined;
    const key = propertyName(member);
    if (key === undefined) return undefined;
    if (ts.isStringLiteral(member.initializer) || ts.isNumericLiteral(member.initializer)) {
      value[key] = ts.isNumericLiteral(member.initializer)
        ? Number(member.initializer.text)
        : member.initializer.text;
      continue;
    }
    const nested = literalObject(member.initializer);
    if (nested === undefined) return undefined;
    value[key] = nested;
  }
  return value;
}

function flattenLiteral(
  value: Record<string, unknown>,
  group: string,
  entries: LocaleDictionaryEntries,
): boolean {
  const values = Object.values(value);
  if (values.every((item) => typeof item === "string" || typeof item === "number")) {
    if (group === "") return false;
    if (!values.every((item) => typeof item === "string")) return false;
    entries[group] = value as Record<string, string>;
    return true;
  }
  if (!values.every((item) => item !== null && typeof item === "object" && !Array.isArray(item)))
    return false;
  return Object.entries(value).every(([key, nested]) =>
    flattenLiteral(
      nested as Record<string, unknown>,
      group === "" ? key : `${group}.${key}`,
      entries,
    ),
  );
}

function inspect(source: LocaleSource): LocaleInspection {
  const jsonFile = path.join(path.dirname(source.file), "locales.json");
  if (existsSync(jsonFile))
    return { ...source, convertible: false, reason: "locales.json already exists" };

  const text = readFileSync(source.file, "utf8");
  const program = ts.createSourceFile(source.file, text, ts.ScriptTarget.Latest, true);
  const syntaxDiagnostics = ts.transpileModule(text, {
    fileName: source.file,
    reportDiagnostics: true,
  }).diagnostics;
  if (syntaxDiagnostics !== undefined && syntaxDiagnostics.length > 0)
    return { ...source, convertible: false, reason: "TypeScript syntax is invalid" };
  const [importStatement, callStatement] = program.statements;
  if (
    !importStatement ||
    !ts.isImportDeclaration(importStatement) ||
    !ts.isStringLiteral(importStatement.moduleSpecifier) ||
    importStatement.moduleSpecifier.text !== "@warlock.js/core" ||
    !importStatement.importClause ||
    importStatement.importClause.isTypeOnly ||
    importStatement.importClause.name ||
    !importStatement.importClause.namedBindings ||
    !ts.isNamedImports(importStatement.importClause.namedBindings) ||
    importStatement.importClause.namedBindings.elements.length !== 1 ||
    importStatement.importClause.namedBindings.elements[0]?.name.text !== "groupedTranslations" ||
    importStatement.importClause.namedBindings.elements[0]?.propertyName
  )
    return {
      ...source,
      convertible: false,
      reason: "must import only groupedTranslations from @warlock.js/core",
    };

  if (program.statements.length !== 2)
    return {
      ...source,
      convertible: false,
      reason: "must contain only the groupedTranslations import and one call",
    };

  if (
    !callStatement ||
    !ts.isExpressionStatement(callStatement) ||
    !ts.isCallExpression(callStatement.expression)
  )
    return {
      ...source,
      convertible: false,
      reason: "must contain one top-level groupedTranslations call",
    };
  const call = callStatement.expression;
  if (
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "groupedTranslations" ||
    call.arguments.length !== 2 ||
    !ts.isStringLiteral(call.arguments[0]!)
  )
    return {
      ...source,
      convertible: false,
      reason: "must call groupedTranslations with a string group and object",
    };
  const dictionary = literalObject(call.arguments[1]!);
  if (!dictionary)
    return {
      ...source,
      convertible: false,
      reason: "translation object must contain only literal keys, objects, strings, or numbers",
    };
  const group = call.arguments[0].text;
  const entries: LocaleDictionaryEntries = Object.create(null);
  if (!flattenLiteral(dictionary, group, entries))
    return {
      ...source,
      convertible: false,
      reason: "translation object has no valid literal locale entries",
    };
  return {
    ...source,
    convertible: true,
    reason: "pure groupedTranslations literal",
    group,
    dictionary,
    entries,
  };
}

export function inspectLocaleSources(): LocaleInspection[] {
  return localeSources().map(inspect);
}

function localeCodes(): readonly string[] | undefined {
  const configured = config.key<unknown>("app.localeCodes");
  return Array.isArray(configured) && configured.every((code) => typeof code === "string")
    ? configured
    : undefined;
}

function sameEntries(left: LocaleDictionaryEntries, right: LocaleDictionaryEntries): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Convert safe legacy locale sources, retaining a TS file whenever verification cannot prove equivalence. */
export function fixLocaleSources(): LocaleInspection[] {
  return inspectLocaleSources().map((result) => {
    if (!result.convertible || !result.group || !result.dictionary || !result.entries)
      return result;
    const jsonFile = path.join(path.dirname(result.file), "locales.json");
    const document: Record<string, unknown> =
      result.group === result.module
        ? result.dictionary
        : { $group: result.group, ...result.dictionary };
    const json = `${JSON.stringify(document, null, 2)}\n`;
    writeFileSync(jsonFile, json);
    try {
      const parsed = parseLocaleDictionary({
        sourceFile: rootPath(path.relative(process.cwd(), jsonFile)),
        source: json,
        defaultNamespace: result.module,
        localeCodes: localeCodes(),
      });
      if (!sameEntries(result.entries, parsed.entries)) throw new Error("flattened entries differ");
    } catch (error) {
      unlinkSync(jsonFile);
      return {
        ...result,
        convertible: false,
        reason: `verification failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    unlinkSync(result.file);
    return {
      ...result,
      reason: "converted (comments in the TypeScript source are not retained)",
    };
  });
}

export const localesTsDeprecatedCheck: DoctorCheck = {
  name: "locales-ts-deprecated",
  run: () => {
    const sources = inspectLocaleSources();
    if (sources.length === 0) return undefined;
    const details = sources.map((source) => {
      const label = path.relative(process.cwd(), source.file).replaceAll("\\", "/");
      return `${label}: ${source.convertible ? "auto-convertible" : "manual"} (${source.reason})`;
    });
    return {
      name: "locales-ts-deprecated",
      status: "warn",
      detail:
        `${details.join("; ")}. Auto-loaded locales.ts goes away in v6; ` +
        "run `warlock doctor --fix` to convert auto-convertible files.",
    };
  },
};
