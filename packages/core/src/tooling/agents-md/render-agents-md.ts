import { readdirSync } from "node:fs";
import path from "node:path";
import type { InspectReport, InspectRoute } from "../inspect/inspect-report.types";
import { type InstalledSkill, shortSkillLine } from "./installed-skills";

/** Options of {@link renderAgentsMdSection}. */
export type RenderAgentsMdOptions = {
  /** Installed skills to list (see `listInstalledSkills`). Default: none listed. */
  skills?: readonly InstalledSkill[];
  /** Module folder names under `src/app` (see `listAppModules`); merged with the ones routes and models name. */
  modules?: readonly string[];
  /** How many routes the compact list shows before pointing at `warlock inspect`. Default: 60. */
  maxRoutes?: number;
};

/** Methods that change state; one of these without an auth guard is flagged. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Fixed method order for the per-method counts. */
const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * The module folders under `<cwd>/src/app`, sorted. Empty when there is none.
 *
 * @param cwd The project root.
 */
export function listAppModules(cwd: string): string[] {
  try {
    return readdirSync(path.join(cwd, "src", "app"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The module a project-relative source path belongs to (`src/app/<module>/…`). */
function moduleOf(file: string | null): string | undefined {
  return file ? /^src\/app\/([^/]+)\//.exec(file.split("\\").join("/"))?.[1] : undefined;
}

function compare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function isUnguardedWrite(route: InspectRoute): boolean {
  return MUTATING_METHODS.has(route.method.toUpperCase()) && !route.auth.required && !route.isPage;
}

function routeLine(route: InspectRoute): string {
  const guard = route.auth.required ? " [auth]" : "";
  const name = route.name ? ` ${route.name}` : "";

  return `- \`${route.method} ${route.path}\`${guard}${name}`;
}

function sortRoutes(routes: readonly InspectRoute[]): InspectRoute[] {
  return [...routes].sort(
    (first, second) =>
      compare(first.path, second.path) ||
      METHOD_ORDER.indexOf(first.method) - METHOD_ORDER.indexOf(second.method) ||
      compare(first.method, second.method),
  );
}

function appSection(report: InspectReport): string[] {
  const name = report.app.name ?? "This app";
  const version = report.app.version ? ` ${report.app.version}` : "";
  const lines = [`## ${name}${version} — generated facts`, ""];
  const packages = [...(report.packages ?? [])].sort((first, second) =>
    compare(first.name, second.name),
  );

  if (packages.length > 0) {
    lines.push(
      `Warlock packages: ${packages.map((entry) => `\`${entry.name}@${entry.version}\``).join(", ")}.`,
      "",
    );
  }

  return lines;
}

function modulesSection(report: InspectReport, extra: readonly string[]): string[] {
  const routeCounts = new Map<string, number>();
  const modelCounts = new Map<string, number>();

  for (const route of report.routes ?? []) {
    const module = moduleOf(route.sourceFile);
    if (module) routeCounts.set(module, (routeCounts.get(module) ?? 0) + 1);
  }

  for (const model of report.models ?? []) {
    const module = moduleOf(model.sourceFile);
    if (module) modelCounts.set(module, (modelCounts.get(module) ?? 0) + 1);
  }

  const modules = [...new Set([...extra, ...routeCounts.keys(), ...modelCounts.keys()])].sort();

  if (modules.length === 0) return [];

  return [
    "### Modules",
    "",
    "Each lives in `src/app/<module>/`.",
    "",
    "| Module | Routes | Models |",
    "| ------ | ------ | ------ |",
    ...modules.map(
      (module) =>
        `| \`${module}\` | ${routeCounts.get(module) ?? 0} | ${modelCounts.get(module) ?? 0} |`,
    ),
    "",
  ];
}

function routesSection(report: InspectReport, maxRoutes: number): string[] {
  const routes = sortRoutes(report.routes ?? []);

  if (routes.length === 0) return [];

  const counts = new Map<string, number>();

  for (const route of routes) {
    counts.set(route.method, (counts.get(route.method) ?? 0) + 1);
  }

  const methods = [...counts.keys()].sort(
    (first, second) =>
      (METHOD_ORDER.indexOf(first) + 1 || 99) - (METHOD_ORDER.indexOf(second) + 1 || 99) ||
      compare(first, second),
  );
  const unguarded = routes.filter(isUnguardedWrite);
  const lines = [
    "### Routes",
    "",
    `${routes.length} route(s): ${methods.map((method) => `${counts.get(method) ?? 0} ${method}`).join(", ")}.`,
    "",
  ];

  if (unguarded.length > 0) {
    lines.push(
      `Mutating routes without an auth guard (confirm each is meant to be public): ${unguarded
        .map((route) => `\`${route.method} ${route.path}\``)
        .join(", ")}.`,
      "",
    );
  }

  lines.push(...routes.slice(0, maxRoutes).map(routeLine));

  if (routes.length > maxRoutes) {
    lines.push(
      `- +${routes.length - maxRoutes} more — run \`npx warlock inspect --json --section routes\``,
    );
  }

  lines.push("");

  return lines;
}

function modelsSection(report: InspectReport): string[] {
  const models = [...(report.models ?? [])].sort((first, second) =>
    compare(first.name, second.name),
  );

  if (models.length === 0) return [];

  return [
    "### Models",
    "",
    ...models.map((model) => {
      const module = moduleOf(model.sourceFile);
      const table = model.table ? ` → \`${model.table}\`` : "";

      return `- \`${model.name}\`${table}${module ? ` (module \`${module}\`)` : ""}`;
    }),
    "",
  ];
}

/** The rules `warlock check` enforces (WL9001–WL9004) and the layout every skill assumes. */
const CONVENTIONS = [
  "- Features live in `src/app/<module>/`; flow is one-way: `routes.ts` → controllers → services → repositories → models. Resources only map output.",
  "- Never import auto-loaded files: `src/app/main.ts`, `src/app/<module>/routes.ts`, `main.ts`, `worker.ts`, `events/*.ts` (`WL9001`).",
  "- No `.js` extensions in import paths (`WL9002`).",
  "- Cross-module imports use the `app/<module>/...` alias, not `../../` (`WL9003`); relative paths stay inside a module.",
  '- Cascade uses standard decorators: never set `"experimentalDecorators": true` (`WL9004`).',
  "- Controllers are thin and read input with `request.validated()`; schemas live in `schema/<action>.schema.ts` and export the value and its `Infer` type.",
  "- Import each API from its home package: `v` from `@warlock.js/seal`, `Model` from `@warlock.js/cascade`, `router` from `@warlock.js/core`.",
];

function skillsSection(skills: readonly InstalledSkill[]): string[] {
  if (skills.length === 0) return [];

  const byPackage = new Map<string, InstalledSkill[]>();

  for (const skill of skills) {
    byPackage.set(skill.package, [...(byPackage.get(skill.package) ?? []), skill]);
  }

  const lines = [
    "### Skills",
    "",
    "Installed with the packages, at `node_modules/<package>/skills/<slug>/SKILL.md`. Read the matching one before changing that area.",
    "",
  ];

  for (const packageName of [...byPackage.keys()].sort()) {
    lines.push(`**${packageName}**`, "");

    const entries = [...(byPackage.get(packageName) ?? [])].sort((first, second) =>
      compare(first.slug, second.slug),
    );

    for (const skill of entries) {
      const line = shortSkillLine(skill.description);

      lines.push(`- \`${skill.slug}\`${line ? ` — ${line}` : ""}`);
    }

    lines.push("");
  }

  return lines;
}

const VERIFY = [
  "### Verify a change",
  "",
  "- `npx warlock check --changed --json` — typecheck, lint, affected tests and conventions; exit 1 = your code, 2 = this machine.",
  "- `npx warlock inspect --json` — routes, models, config keys, events, pages, jobs from the booted app.",
  "- `npx warlock explain <code>` — what a `WLxxxx` code means and how to fix it.",
  "- `npx warlock trace <method> <url> --json` — send a request to the running `warlock dev` and print its devtools timeline.",
  "- `npx warlock mcp` — the same facts and actions as an MCP server.",
  "",
];

/**
 * Render the app-specific AGENTS.md section from an inspect report: the app
 * and its Warlock packages, modules, a routes summary (unguarded writes
 * flagged), models, the conventions `warlock check` enforces, the installed
 * skills and the verify commands.
 *
 * Deterministic: no timestamps and stable ordering, so regenerating an
 * unchanged app yields the same bytes and `writeAgentsMd` writes nothing.
 * Returned without the markers.
 *
 * @param report An `inspectApp()` report (routes, models and packages are read when present).
 * @param options Skills and module folders to include.
 */
export function renderAgentsMdSection(
  report: InspectReport,
  options: RenderAgentsMdOptions = {},
): string {
  const lines = [
    "<!-- Generated by `warlock agents-md` and refreshed by `warlock dev`. Write your own notes outside the warlock:generated markers; everything between them is replaced. -->",
    "",
    ...appSection(report),
    ...modulesSection(report, options.modules ?? []),
    ...routesSection(report, options.maxRoutes ?? 60),
    ...modelsSection(report),
    "### Conventions in force",
    "",
    ...CONVENTIONS,
    "",
    ...skillsSection(options.skills ?? []),
    ...VERIFY,
  ];

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}
