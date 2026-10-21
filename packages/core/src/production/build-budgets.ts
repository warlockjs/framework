import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PageBudget = { js?: string; css?: string };
export type BuildBudgets = {
  page?: PageBudget;
  /** Route-path globs supporting *, ** and ?. Later matching entries win per field. */
  pages?: Record<string, PageBudget>;
  /** Defaults to error when budgets are configured. */
  mode?: "error" | "warn";
};
export type BudgetPage = {
  page: string;
  source: string;
  js: number;
  css: number;
  dynamic: { js: number; css: number };
  files: string[];
  modules: { id: string; bytes: number }[];
  delta?: { js: number; css: number };
};
export type BudgetViolation = {
  page: string;
  type: "js" | "css";
  budget: number;
  actual: number;
  modules: BudgetPage["modules"];
};
export type BuildBudgetReport = {
  version: 1;
  compression: "gzip";
  pages: BudgetPage[];
  violations: BudgetViolation[];
};
export const BUILD_BUDGET_REPORT_FILE = "build-budgets.json";

export function parseBudgetSize(size: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb)$/i.exec(size.trim());
  if (!match)
    throw new Error(
      `Invalid build budget ${JSON.stringify(size)}: use bytes, kb or mb, e.g. "150kb".`,
    );
  const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024 };
  const bytes = Number(match[1]) * (units[match[2]?.toLowerCase() ?? ""] ?? 0);
  if (!Number.isFinite(bytes)) throw new Error(`Invalid build budget ${JSON.stringify(size)}.`);
  return bytes;
}

function routeMatches(pattern: string, route: string): boolean {
  if (["[", "]", "{", "}", "(", ")", "!", "\\"].some((token) => pattern.includes(token))) {
    throw new Error(
      `Invalid build budget glob ${JSON.stringify(pattern)}: supported wildcards are *, ** and ?.`,
    );
  }
  let expression = "^";
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i];
    if (character === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        expression += "(?:.*/)?";
        i++;
      } else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character?.replace(/[.+^$|]/g, "\\$&") ?? "";
  }
  return new RegExp(`${expression}$`).test(route);
}

export function evaluateBuildBudgets(
  pages: BudgetPage[],
  budgets?: BuildBudgets,
  previous?: BuildBudgetReport,
): BuildBudgetReport {
  if (budgets?.mode !== undefined && budgets.mode !== "error" && budgets.mode !== "warn") {
    throw new Error('build.budgets.mode must be "error" or "warn".');
  }
  // Validate even overrides that do not match any current route.
  for (const budget of [budgets?.page, ...Object.values(budgets?.pages ?? {})]) {
    for (const size of Object.values(budget ?? {})) {
      if (size !== undefined) parseBudgetSize(size);
    }
  }
  for (const pattern of Object.keys(budgets?.pages ?? {})) routeMatches(pattern, "");
  const violations: BudgetViolation[] = [];
  const result = pages
    .map((page) => {
      let limits = { ...budgets?.page };
      for (const [pattern, override] of Object.entries(budgets?.pages ?? {})) {
        if (routeMatches(pattern, page.page)) limits = { ...limits, ...override };
      }
      for (const type of ["js", "css"] as const) {
        const configured = limits[type];
        if (configured === undefined) continue;
        const budget = parseBudgetSize(configured);
        if (page[type] > budget)
          violations.push({
            page: page.page,
            type,
            budget,
            actual: page[type],
            modules: page.modules,
          });
      }
      const old = previous?.pages.find(
        (entry) => entry.page === page.page && entry.source === page.source,
      );
      return {
        ...page,
        delta: old ? { js: page.js - old.js, css: page.css - old.css } : undefined,
      };
    })
    .sort((a, b) => b.js + b.css - a.js - a.css || a.page.localeCompare(b.page));
  return { version: 1, compression: "gzip", pages: result, violations };
}

export async function readBuildBudgetReport(
  outdir: string,
): Promise<BuildBudgetReport | undefined> {
  try {
    const report: BuildBudgetReport = JSON.parse(
      await readFile(path.join(outdir, BUILD_BUDGET_REPORT_FILE), "utf8"),
    );
    if (
      !report ||
      typeof report !== "object" ||
      report.version !== 1 ||
      report.compression !== "gzip" ||
      !Array.isArray(report.pages)
    )
      return undefined;
    return report;
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && "code" in error && error.code === "ENOENT")
    )
      return undefined;
    throw error;
  }
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(2)}kb`;
const delta = (value: number | undefined) =>
  value === undefined ? "—" : `${value >= 0 ? "+" : ""}${kb(value)}`;
export function formatBuildBudgets(report: BuildBudgetReport): string {
  return [
    "First-visit client assets (gzip); dynamic imports excluded from budgets",
    "Page | JS | Δ JS | CSS | Δ CSS | Dynamic JS | Dynamic CSS | Largest modules (rendered bytes)",
    ...report.pages.map(
      (page) =>
        `${page.page} | ${kb(page.js)} | ${delta(page.delta?.js)} | ${kb(page.css)} | ${delta(page.delta?.css)} | ${kb(page.dynamic.js)} | ${kb(page.dynamic.css)} | ${page.modules
          .slice(0, 3)
          .map((module) => `${module.id} (${module.bytes}b)`)
          .join(", ")}`,
    ),
  ].join("\n");
}
export function formatBudgetViolations(report: BuildBudgetReport): string {
  return report.violations
    .map(
      (violation) =>
        `Page ${violation.page}: ${violation.type.toUpperCase()} budget ${kb(violation.budget)}, actual ${kb(violation.actual)} (limit ${violation.budget}b, actual ${violation.actual}b). Biggest modules (rendered bytes): ${violation.modules.map((module) => `${module.id} (${module.bytes}b)`).join(", ") || "none"}`,
    )
    .join("\n");
}
export async function writeBuildBudgetReport(
  outdir: string,
  report: BuildBudgetReport,
): Promise<void> {
  await writeFile(
    path.join(outdir, BUILD_BUDGET_REPORT_FILE),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
