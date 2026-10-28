import { isWarlockErrorCode } from "../../errors/error-codes";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "jsonc-parser";
import { importSpecifiers } from "../syntax/imports";
import * as ast from "../syntax/ast";
import { createProblem, type ToolingProblem } from "../problem";
import { importFixes } from "./fixes";
import { codeStyleFindings } from "./code-style-conventions";
import { securityFindings } from "./security-conventions";
import { webFindings, responseSchemaFindings, type ConventionOptions } from "./web-conventions";
import {
  apiRouteReferenceFindings,
  collectApiRouteFacts,
  EMPTY_API_ROUTE_FACTS,
  type ApiRouteFacts,
} from "./api-route-references";
import {
  collectModelFacts,
  EMPTY_MODEL_FACTS,
  modelMergeFindings,
  modelPropertyReadFindings,
  type ModelFacts,
} from "./model-property-reads";
import { translationProblems } from "./translation-conventions";
import { integrationSpecProblems } from "./integration-spec-conventions";
import { barrelFindings } from "./barrel-conventions";
import {
  clientBoundaryProblems,
  createClientBoundaryCache,
  type ClientBoundaryCache,
} from "./client-boundary-conventions";
import {
  createRuleBudget,
  DEFAULT_RULE_BUDGET_MS,
  withinBudget,
  type RuleBudget,
} from "./rule-budget";
import { configuredLocaleCodes, localeCoverageProblems } from "./locale-conventions";
import { positionOf, type SourceFinding } from "./source-ast";

/** The rules the time budget tracks, named by the codes they report. */
const RULES = {
  imports: "WL9001-WL9003 imports",
  clientBoundary: "WL9022 client boundary",
  translations: "WL9104 translations",
  integrationSpec: "WL9024 integration specs",
  security: "WL9005-WL9009 security",
  codeStyle: "WL9010-WL9012 code style",
  web: "WL9018 web components",
  responseSchema: "response schemas",
  apiRoutes: "WL9019-WL9020 browser routes",
  modelReads: "WL9021 model property reads",
  modelMerge: "WL9025 model merge",
  barrels: "WL9023 barrels",
} as const;

/** What one convention run shares between its files. */
export type ConventionRun = {
  /** Import chains already walked by the `.client` boundary rule. */
  boundary?: ClientBoundaryCache;
  /** Time each rule has used so far; a rule over budget is skipped. */
  budget?: RuleBudget;
};

/** Extensions tried when resolving an extension-less import. */
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

/** Test files may import anything on purpose. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

/** Matches a project-relative path of a file the framework loads by itself. */
export function isAutoLoadedFile(relativePath: string): boolean {
  return (
    /^src\/app\/main\.tsx?$/.test(relativePath) ||
    /^src\/app\/[^/]+\/(?:routes|main|worker)\.tsx?$/.test(relativePath) ||
    /^src\/app\/.+\/events\/[^/]+\.tsx?$/.test(relativePath)
  );
}

/** The module folder (`src/app/<module>`) a project-relative path lives in, if any. */
function moduleOf(relativePath: string): string | undefined {
  return /^src\/app\/([^/]+)\//.exec(relativePath)?.[1];
}

function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

/** Resolve a relative or `app/...` specifier to a project-relative file, if it exists. */
export function resolveSpecifier(
  specifier: string,
  importer: string,
  cwd: string,
): string | undefined {
  let base: string;

  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(path.join(cwd, importer)), specifier);
  } else if (specifier.startsWith("app/")) {
    base = path.join(cwd, "src", specifier);
  } else {
    return undefined;
  }

  const candidates = [base, ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`)];
  const withoutJs = base.replace(/\.jsx?$/, "");

  if (withoutJs !== base) {
    candidates.push(...RESOLVE_EXTENSIONS.map((extension) => `${withoutJs}${extension}`));
  }

  const found = candidates.find(
    (candidate) => existsSync(candidate) && path.extname(candidate) !== "",
  );

  return found ? toPosix(path.relative(cwd, found)) : undefined;
}

/** Every module specifier a source file imports, with its position. */
function importsOf(sourceFile: ast.SourceFile): { specifier: string; node: ast.Node }[] {
  return importSpecifiers(sourceFile.fileName, sourceFile);
}

/** `// warlock-check-ignore [WLxxxx …]` on a problem's line or the line above it. */
const IGNORE_COMMENT = /\/[/*]\s*warlock-check-ignore\b(.*)/;

/** Whether an ignore comment on `line` (1-based) or the line before covers `code`. */
function isIgnored(lines: readonly string[], line: number, code: string): boolean {
  for (const text of [lines[line - 1], lines[line - 2]]) {
    const match = text === undefined ? null : IGNORE_COMMENT.exec(text);

    if (!match) continue;

    const codes = match[1]?.match(/WL\d{4}/g);

    if (!codes || codes.includes(code)) return true;
  }

  return false;
}

/** The import conventions (`WL9001`–`WL9003`) of one parsed file. */
function importProblems(
  sourceFile: ast.SourceFile,
  relativePath: string,
  cwd: string,
): ToolingProblem[] {
  const problems: ToolingProblem[] = [];
  const fixes = importFixes(relativePath, sourceFile.text, sourceFile);
  const importerModule = moduleOf(relativePath);

  for (const { specifier, node } of importsOf(sourceFile)) {
    const at = { file: relativePath, ...positionOf(sourceFile, node) };

    if (specifier.startsWith(".") && /\.jsx?$/.test(specifier)) {
      problems.push(
        createProblem({
          code: "WL9002",
          fix: fixes.find((fix) => fix.end === node.end - 1),
          source: "convention",
          message: `Import "${specifier}" ends in a .js extension.`,
          ...at,
        }),
      );
    }

    const target = resolveSpecifier(specifier, relativePath, cwd);

    if (!target) continue;

    if (!TEST_FILE.test(relativePath) && isAutoLoadedFile(target)) {
      problems.push(
        createProblem({
          code: "WL9001",
          source: "convention",
          message: `"${specifier}" imports ${target}, which the framework loads by itself.`,
          ...at,
        }),
      );
    }

    const targetModule = moduleOf(target);

    if (
      specifier.startsWith(".") &&
      importerModule !== undefined &&
      targetModule !== undefined &&
      importerModule !== targetModule
    ) {
      const alias = `app/${target.replace(/^src\/app\//, "").replace(/\.[cm]?[jt]sx?$/, "")}`;

      problems.push(
        createProblem({
          code: "WL9003",
          source: "convention",
          message: `"${specifier}" reaches from module "${importerModule}" into "${targetModule}"; import "${alias}" instead.`,
          ...at,
        }),
      );
    }
  }

  return problems;
}

function findingProblem(
  sourceFile: ast.SourceFile,
  relativePath: string,
  finding: SourceFinding,
): ToolingProblem {
  return createProblem({
    code: finding.code,
    source: "convention",
    severity: finding.severity ?? "error",
    message: finding.message,
    fix: finding.fix,
    file: relativePath,
    ...positionOf(sourceFile, finding.node),
  });
}

/**
 * The convention problems in one source file, in source order:
 *
 * - `WL9001` an import of a file the framework loads by itself (`routes.ts`,
 *   `main.ts`, `worker.ts`, `events/*`) — importing it registers it twice;
 * - `WL9002` a relative import ending in `.js`;
 * - `WL9003` a relative import from one `src/app/<module>` into another, which
 *   should use the `app/<module>/...` alias;
 * - `WL9005`–`WL9009` the security conventions (see `securityFindings`):
 *   `request.all()` into a query or service, a mutating route with no guard
 *   and no `public: true`, a redirect target from request input, sensitive
 *   values in logs, unbounded regexes on request input;
 * - `WL9010`–`WL9012` warnings: `await log.*()`, a second controller in one
 *   file, a `kind` discriminator;
 * - `WL9019` (warning) and `WL9020` (error) the browser route references
 *   (see `apiRouteReferenceFindings`);
 * - `WL9021` (warning) a Cascade column read as a property, with a `get()` /
 *   `set()` fix (see `modelPropertyReadFindings`);
 * - `WL9025` (warning) `model.merge({ column })` on an object-typed schema column
 *   (see `modelMergeFindings`);
 * - `WL9024` (warning) an integration spec that imports nothing needing the app
 *   (see `integrationSpecProblems`).
 * - `WL9022` server-only code that imports a `.client.*` module, directly or
 *   through other files (see `clientBoundaryProblems`);
 * - `WL9023` an `index.ts` barrel in an app module, only when `rules.WL9023`
 *   in `.warlock-check.json` turns it on (see `barrelFindings`).
 *
 * Module dictionaries are checked by {@link runConventions}, not here, since
 * they are JSON files of the project and not source files.
 *
 * A `// warlock-check-ignore WL9006` comment on the problem's line or the line
 * above silences that code there; without codes it silences every one.
 */
export function checkFileConventions(
  relativePath: string,
  source: string,
  cwd: string,
  options: ConventionOptions = {},
  apiRouteFacts: ApiRouteFacts = EMPTY_API_ROUTE_FACTS,
  modelFacts: ModelFacts = EMPTY_MODEL_FACTS,
  run: ConventionRun = {},
): ToolingProblem[] {
  const sourceFile = ast.parseSourceFile(relativePath, source);
  const timed = <T>(rule: string, fallback: T, body: () => T): T =>
    withinBudget(run.budget, rule, fallback, body);
  const noProblems: ToolingProblem[] = [];
  const noFindings: SourceFinding[] = [];
  const problems = [
    ...timed(RULES.imports, noProblems, () => importProblems(sourceFile, relativePath, cwd)),
    ...timed(RULES.clientBoundary, noProblems, () =>
      clientBoundaryProblems(sourceFile, relativePath, cwd, run.boundary),
    ),
    ...timed(RULES.translations, noProblems, () => translationProblems(relativePath, source)),
    ...timed(RULES.integrationSpec, noProblems, () =>
      integrationSpecProblems(relativePath, source, cwd, (specifier, importer) =>
        resolveSpecifier(specifier, importer, cwd),
      ),
    ),
    ...[
      ...timed(RULES.security, noFindings, () => securityFindings(sourceFile)),
      ...timed(RULES.codeStyle, noFindings, () => codeStyleFindings(sourceFile)),
      ...timed(RULES.web, noFindings, () => webFindings(sourceFile, options)),
      ...timed(RULES.responseSchema, noFindings, () => responseSchemaFindings(sourceFile)),
      ...timed(RULES.apiRoutes, noFindings, () =>
        apiRouteReferenceFindings(sourceFile, apiRouteFacts),
      ),
      ...timed(RULES.modelReads, noFindings, () =>
        modelPropertyReadFindings(sourceFile, modelFacts),
      ),
      ...timed(RULES.modelMerge, noFindings, () => modelMergeFindings(sourceFile, modelFacts)),
      // Opt-in: a barrel is a finding only once `rules.WL9023` names a severity.
      ...(["warning", "error"].includes(options.rules?.WL9023 ?? "")
        ? timed(RULES.barrels, noFindings, () => barrelFindings(sourceFile))
        : []),
    ].map((finding) => findingProblem(sourceFile, relativePath, finding)),
  ];
  const lines = source.split(/\r?\n/);

  return problems
    .filter((problem) => options.rules?.[problem.code] !== "off")
    .map((problem) => ({
      ...problem,
      severity:
        options.rules?.[problem.code] === "error"
          ? ("error" as const)
          : options.rules?.[problem.code] === "warning"
            ? ("warning" as const)
            : problem.severity,
    }))
    .filter((problem) => problem.line === null || !isIgnored(lines, problem.line, problem.code))
    .sort(
      (first, second) =>
        (first.line ?? 0) - (second.line ?? 0) || (first.column ?? 0) - (second.column ?? 0),
    );
}

/** `WL9004` when the project tsconfig turns on legacy decorators. */
export function checkTsconfigConventions(cwd: string, project = "tsconfig.json"): ToolingProblem[] {
  const file = path.join(cwd, project);

  if (!existsSync(file)) return [];

  const text = readFileSync(file, "utf8");
  const config: unknown = parse(text);
  const options: unknown =
    typeof config === "object" && config !== null
      ? Reflect.get(config, "compilerOptions")
      : undefined;

  if (
    typeof options !== "object" ||
    options === null ||
    Reflect.get(options, "experimentalDecorators") !== true
  ) {
    return [];
  }

  const index = text.indexOf("experimentalDecorators");
  const before = index === -1 ? "" : text.slice(0, index);
  const line = index === -1 ? null : before.split("\n").length;
  const column = index === -1 ? null : index - before.lastIndexOf("\n");

  return [
    createProblem({
      code: "WL9004",
      source: "convention",
      message: '"experimentalDecorators": true switches TypeScript to legacy decorators.',
      file: toPosix(project),
      line,
      column,
    }),
  ];
}

/** Options of {@link runConventions} beyond the project. */
export type RunConventionsOptions = {
  /** Receives one human-readable line per milestone (start, every 1000 files, a rule over budget). */
  onProgress?: (message: string) => void;
  /** Overrides `ruleBudgetMs` from `.warlock-check.json`. */
  ruleBudgetMs?: number;
};

/**
 * Run every convention check over `files` (project-relative) plus the
 * project tsconfig.
 *
 * Each rule has a time budget over the whole run (`ruleBudgetMs`, default 30
 * seconds): a rule over it is skipped for the remaining files and reported as
 * a `WL9026` warning naming the rule and the time it used.
 */
export function runConventions(
  cwd: string,
  files: readonly string[],
  project?: string,
  apiRouteFacts?: ApiRouteFacts,
  modelFacts?: ModelFacts,
  runOptions: RunConventionsOptions = {},
): ToolingProblem[] {
  const { onProgress } = runOptions;
  const options = readConventionOptions(cwd);
  const severityOf = (problem: ToolingProblem): ToolingProblem => {
    const severity = options.rules?.[problem.code];
    return severity === "error" || severity === "warning" ? { ...problem, severity } : problem;
  };
  const problems = checkTsconfigConventions(cwd, project)
    .filter((problem) => options.rules?.[problem.code] !== "off")
    .map(severityOf);

  const timer = performance.now();
  const budgetMs = runOptions.ruleBudgetMs ?? options.ruleBudgetMs ?? DEFAULT_RULE_BUDGET_MS;
  const budget = createRuleBudget(budgetMs, (rule, elapsedMs) =>
    onProgress?.(
      `conventions: rule "${rule}" used ${formatSeconds(elapsedMs)} and is over its ${formatSeconds(budgetMs)} budget; skipping it for the remaining files`,
    ),
  );

  onProgress?.(`conventions: collecting project facts for ${files.length} file(s)`);

  const routeFacts = apiRouteFacts ?? collectApiRouteFacts(cwd, files);
  const models = modelFacts ?? collectModelFacts(cwd, files);
  const run: ConventionRun = { boundary: createClientBoundaryCache(), budget };

  onProgress?.(`conventions: checking ${files.length} file(s)`);

  let done = 0;

  for (const file of files) {
    let source: string | undefined;

    try {
      source = readFileSync(path.join(cwd, file), "utf8");
    } catch {
      source = undefined;
    }

    if (source !== undefined) {
      problems.push(...checkFileConventions(file, source, cwd, options, routeFacts, models, run));
    }

    done++;

    if (done % 1000 === 0 && done < files.length) {
      onProgress?.(
        `conventions: ${done}/${files.length} file(s) in ${formatSeconds(performance.now() - timer)}, slowest rule ${slowestRule(budget)}`,
      );
    }
  }

  // `WL9105`: every key of every module dictionary carries every configured locale.
  problems.push(
    ...localeCoverageProblems(cwd, configuredLocaleCodes(cwd, options.localeCodes))
      .filter((problem) => options.rules?.[problem.code] !== "off")
      .map(severityOf),
  );

  for (const [rule, { skippedFiles }] of budget.exhausted) {
    const problem = createProblem({
      code: "WL9026",
      source: "convention",
      severity: "warning",
      message: `Rule "${rule}" used ${formatSeconds(budget.elapsed.get(rule) ?? 0)}, over its ${formatSeconds(budgetMs)} budget, and was skipped for the remaining ${skippedFiles} file(s); its findings are incomplete.`,
    });

    if (options.rules?.[problem.code] !== "off") problems.push(severityOf(problem));
  }

  onProgress?.(
    `conventions: done in ${formatSeconds(performance.now() - timer)}, slowest rule ${slowestRule(budget)}`,
  );

  return problems;
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function slowestRule(budget: RuleBudget): string {
  let name = "none";
  let slowest = 0;

  for (const [rule, elapsed] of budget.elapsed) {
    if (elapsed > slowest) {
      name = rule;
      slowest = elapsed;
    }
  }

  return `${name} (${formatSeconds(slowest)})`;
}

/** Optional JSON configuration; malformed configuration is reported by the check step. */
export function readConventionOptions(cwd: string): ConventionOptions {
  const file = path.join(cwd, ".warlock-check.json");
  if (!existsSync(file)) return {};
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object")
    throw new Error(".warlock-check.json must be an object.");
  const limit: unknown = Reflect.get(value, "componentLineLimit");
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1))
    throw new Error("componentLineLimit must be a positive integer.");
  const localeCodes: unknown = Reflect.get(value, "localeCodes");
  if (
    localeCodes !== undefined &&
    (!Array.isArray(localeCodes) || !localeCodes.every((code) => typeof code === "string"))
  )
    throw new Error("localeCodes must be an array of locale code strings.");
  const ruleBudgetMs: unknown = Reflect.get(value, "ruleBudgetMs");
  if (
    ruleBudgetMs !== undefined &&
    (typeof ruleBudgetMs !== "number" || !Number.isFinite(ruleBudgetMs) || ruleBudgetMs < 0)
  )
    throw new Error("ruleBudgetMs must be a number of milliseconds, 0 or more.");
  const rules: unknown = Reflect.get(value, "rules");
  const overrides: NonNullable<ConventionOptions["rules"]> = {};
  if (rules !== undefined) {
    if (!rules || typeof rules !== "object" || Array.isArray(rules))
      throw new Error("rules must be an object.");
    for (const [code, severity] of Object.entries(rules)) {
      if (
        !isWarlockErrorCode(code) ||
        (severity !== "off" && severity !== "warning" && severity !== "error")
      )
        throw new Error("rules must map registered WL codes to off, warning or error.");
      overrides[code] = severity;
    }
  }
  return {
    ...(typeof limit === "number" ? { componentLineLimit: limit } : {}),
    ...(typeof ruleBudgetMs === "number" ? { ruleBudgetMs } : {}),
    ...(Array.isArray(localeCodes) ? { localeCodes: localeCodes as string[] } : {}),
    rules: overrides,
  };
}
