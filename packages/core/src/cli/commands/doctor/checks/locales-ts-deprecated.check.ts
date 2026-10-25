import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import * as ast from "../../../../tooling/syntax/ast";
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
  /**
   * The JSON file the conversion writes: the module's `locales.json`, or
   * `locales/legacy.json` when `locales.json` already exists.
   */
  target?: string;
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

function literalObject(node: ast.Node | undefined): Record<string, unknown> | undefined {
  if (node?.type !== "ObjectExpression") return undefined;
  const value: Record<string, unknown> = Object.create(null);
  for (const member of node.properties) {
    if (!ast.isPropertyAssignment(member)) return undefined;
    const key = ast.keyName(member.key);
    if (key === undefined) return undefined;
    if (ast.isStringLiteral(member.value) || ast.isNumericLiteral(member.value))
      value[key] = member.value.value;
    else {
      const nested = literalObject(member.value);
      if (nested === undefined) return undefined;
      value[key] = nested;
    }
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

/** Where a legacy file's translations go: `locales.json`, or a feature file beside an existing one. */
function targetOf(source: LocaleSource): { file: string; mergedWith?: string } | undefined {
  const directory = path.dirname(source.file);
  const jsonFile = path.join(directory, "locales.json");
  if (!existsSync(jsonFile)) return { file: jsonFile };
  const featureFile = path.join(directory, "locales", "legacy.json");
  return existsSync(featureFile) ? undefined : { file: featureFile, mergedWith: jsonFile };
}

function overlappingKeys(
  mergedWith: string,
  module: string,
  entries: LocaleDictionaryEntries,
): string[] {
  try {
    const existing = parseLocaleDictionary({
      sourceFile: rootPath(path.relative(process.cwd(), mergedWith)),
      source: readFileSync(mergedWith, "utf8"),
      defaultNamespace: module,
    });
    return Object.keys(entries).filter((key) => key in existing.entries);
  } catch {
    return Object.keys(entries);
  }
}

function inspect(source: LocaleSource): LocaleInspection {
  const target = targetOf(source);
  if (!target)
    return {
      ...source,
      convertible: false,
      reason: "locales.json and locales/legacy.json already exist",
    };

  const text = readFileSync(source.file, "utf8");
  const program = ast.parseSourceFile(source.file, text);
  if (parseSync(source.file, text).errors.length > 0)
    return { ...source, convertible: false, reason: "TypeScript syntax is invalid" };
  const [importStatement, callStatement] = program.body;
  const binding =
    importStatement?.type === "ImportDeclaration" ? importStatement.specifiers[0] : undefined;
  if (
    importStatement?.type !== "ImportDeclaration" ||
    importStatement.source.value !== "@warlock.js/core" ||
    importStatement.importKind === "type" ||
    importStatement.specifiers.length !== 1 ||
    binding?.type !== "ImportSpecifier" ||
    binding.importKind === "type" ||
    binding.local.name !== "groupedTranslations" ||
    ast.valueText(binding.imported) !== "groupedTranslations"
  )
    return {
      ...source,
      convertible: false,
      reason: "must import only groupedTranslations from @warlock.js/core",
    };

  if (program.body.length !== 2)
    return {
      ...source,
      convertible: false,
      reason: "must contain only the groupedTranslations import and one call",
    };

  if (
    !callStatement ||
    !ast.isExpressionStatement(callStatement) ||
    callStatement.expression.type !== "CallExpression"
  )
    return {
      ...source,
      convertible: false,
      reason: "must contain one top-level groupedTranslations call",
    };
  const call = callStatement.expression;
  if (
    !ast.isIdentifier(call.callee) ||
    ast.valueText(call.callee) !== "groupedTranslations" ||
    call.arguments.length !== 2 ||
    !call.arguments[0] ||
    !ast.isStringLiteral(call.arguments[0])
  )
    return {
      ...source,
      convertible: false,
      reason: "must call groupedTranslations with a string group and object",
    };
  const dictionary = literalObject(call.arguments[1]);
  if (!dictionary)
    return {
      ...source,
      convertible: false,
      reason: "translation object must contain only literal keys, objects, strings, or numbers",
    };
  const group = call.arguments[0].value;
  const entries: LocaleDictionaryEntries = Object.create(null);
  if (!flattenLiteral(dictionary, group, entries))
    return {
      ...source,
      convertible: false,
      reason: "translation object has no valid literal locale entries",
    };
  if (target.mergedWith) {
    const overlap = overlappingKeys(target.mergedWith, source.module, entries);
    if (overlap.length > 0)
      return {
        ...source,
        convertible: false,
        reason: `keys already defined in locales.json: ${overlap.slice(0, 3).join(", ")}${overlap.length > 3 ? ", ..." : ""}`,
      };
  }
  return {
    ...source,
    target: target.file,
    convertible: true,
    reason: target.mergedWith
      ? "pure groupedTranslations literal (goes to locales/legacy.json because locales.json exists)"
      : "pure groupedTranslations literal",
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
    if (
      !result.convertible ||
      !result.group ||
      !result.dictionary ||
      !result.entries ||
      !result.target
    )
      return result;
    const jsonFile = result.target;
    const directoryExisted = existsSync(path.dirname(jsonFile));
    mkdirSync(path.dirname(jsonFile), { recursive: true });
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
      if (!directoryExisted) rmdirSync(path.dirname(jsonFile));
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
      code: "WL9101",
      detail:
        `${details.join("; ")}. Auto-loaded locales.ts goes away in v6; ` +
        "run `warlock doctor --fix` to convert auto-convertible files.",
    };
  },
};
