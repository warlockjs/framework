/**
 * Skill coverage gate.
 *
 * Agents see only a grouped package's `skills/index.md` description before they
 * decide to open it, so a feature the skills never name is unreachable. This
 * gate keeps the skills honest about the package they describe.
 *
 * ## Hard failures
 *
 * - a package with two or more topic skills and no `skills/index.md`;
 * - an `index.md` without a frontmatter `description`, or one outside 400-700
 *   characters (agent-kit's recommended budget);
 * - a topic `SKILL.md` without a frontmatter `name` or `description`.
 *
 * ## Ratcheted count
 *
 * Per package, the public VALUE exports (names exported from `src/index.ts`
 * and, recursively, from the relative modules it re-exports) that no skill of
 * that package mentions as an identifier inside backticks or a fenced code
 * block. The count is recorded in `skill-coverage-allowances.jsonc` and the
 * gate fails when a package's count goes UP. Counts may only go down; never
 * raise an allowance to make a run pass.
 *
 * Types-only exports (`interface`, `type`, `export type { … }`) are not
 * counted: skills teach behaviour, and types are reached through the values
 * that use them. They are still shown by `--list` for information.
 *
 * Re-exports from external packages (`export * from "@mongez/x"`) are not
 * followed: they are not this package's API.
 *
 * `--list` prints every uncovered name per package. `--list <pkg>` narrows it.
 *
 * The export reader is a pragmatic line-anchored parse (comments stripped,
 * top-level `export` statements only), not the compiler API: the release tooling
 * deliberately avoids depending on a compiler build.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonc } from "./read-jsonc";
import { readSkillDescription } from "./skill-path-refs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");
const ALLOWANCES_PATH = path.join(__dirname, "skill-coverage-allowances.jsonc");

export const INDEX_DESCRIPTION_MIN = 400;
export const INDEX_DESCRIPTION_MAX = 700;

export type ExportedName = { name: string; typeOnly: boolean };

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function resolveModule(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    base,
  ]) {
    if (isFile(candidate) && /\.tsx?$/.test(candidate) && !candidate.endsWith(".d.ts"))
      return candidate;
  }
  return undefined;
}

const DECLARATION_RE =
  /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(const\s+enum|enum|const|let|var|function\*?|class|interface|type|namespace)\s+([A-Za-z_$][\w$]*)/gm;
const BRACE_RE = /^export\s+(type\s+)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/gm;
const STAR_RE = /^export\s+(type\s+)?\*(?:\s+as\s+([A-Za-z_$][\w$]*))?\s+from\s*["']([^"']+)["']/gm;

/** The names a module entry exports, following relative `export *` chains. */
export function readExports(entry: string, seen = new Set<string>()): ExportedName[] {
  if (seen.has(entry) || !isFile(entry)) return [];
  seen.add(entry);
  const text = stripComments(readFileSync(entry, "utf8"));
  const out = new Map<string, boolean>();
  const add = (name: string, typeOnly: boolean) => {
    // A value declaration wins over a same-named type (declaration merging).
    out.set(name, (out.get(name) ?? true) && typeOnly);
  };

  for (const match of text.matchAll(DECLARATION_RE)) {
    const kind = match[1] ?? "";
    if (/^export\s+(?:declare\s+)?default\b/.test(match[0])) continue;
    add(match[2] ?? "", kind === "interface" || kind === "type");
  }

  for (const match of text.matchAll(BRACE_RE)) {
    const whole = Boolean(match[1]);
    for (const part of (match[2] ?? "").split(",")) {
      const item = part.trim();
      if (!item) continue;
      const typeOnly = whole || /^type\s+/.test(item);
      const cleaned = item.replace(/^type\s+/, "");
      const name =
        cleaned
          .split(/\s+as\s+/)
          .pop()
          ?.trim() ?? "";
      if (name && name !== "default") add(name, typeOnly);
      else if (name === "default") continue;
    }
  }

  for (const match of text.matchAll(STAR_RE)) {
    const spec = match[3] ?? "";
    if (!spec.startsWith(".")) continue;
    if (match[2]) {
      add(match[2], Boolean(match[1]));
      continue;
    }
    const target = resolveModule(entry, spec);
    if (!target) continue;
    for (const item of readExports(target, seen))
      add(item.name, item.typeOnly || Boolean(match[1]));
  }

  return [...out].map(([name, typeOnly]) => ({ name, typeOnly }));
}

/** Text a reader would copy as an identifier: inline code and fenced blocks. */
export function codeText(markdown: string): string {
  // Frontmatter stays: a topic description is read by agents and counts as a mention.
  const body = markdown.replace(/^\uFEFF/, "");
  const parts: string[] = [];
  const withoutFences = body.replace(/^(```|~~~)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm, (_m, _f, code) => {
    parts.push(String(code));
    return "";
  });
  for (const match of withoutFences.matchAll(/`([^`\n]+)`/g)) parts.push(match[1] ?? "");
  return parts.join("\n");
}

function walkMarkdown(dir: string, into: string[]): void {
  for (const name of readdirSync(dir)) {
    const child = path.join(dir, name);
    if (isDirectory(child)) walkMarkdown(child, into);
    else if (name.endsWith(".md")) into.push(child);
  }
}

function identifierSet(text: string): Set<string> {
  return new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

export type CoverageIssue = {
  package: string;
  relPath: string;
  type:
    | "missing-index"
    | "missing-index-description"
    | "index-description-length"
    | "missing-topic-name"
    | "missing-topic-description";
  message: string;
};

export type PackageCoverage = {
  dir: string;
  /** Value exports no skill names. */
  uncovered: string[];
  /** Types-only exports no skill names (informational). */
  uncoveredTypes: string[];
  valueExports: number;
};

export type CoverageReport = { issues: CoverageIssue[]; packages: PackageCoverage[] };

function frontmatterField(text: string, field: "name" | "description"): string | undefined {
  if (field === "description") return readSkillDescription(text);
  const front = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const value = front?.[1]
    ?.match(/^name:[ \t]*(.*)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return value || undefined;
}

/** `packagesRoot` holds `<pkg>/skills` and `<pkg>/src/index.ts`. */
export function runSkillCoverageGate(packagesRoot: string): CoverageReport {
  const issues: CoverageIssue[] = [];
  const packages: PackageCoverage[] = [];

  for (const dir of readdirSync(packagesRoot).sort()) {
    if (dir.startsWith(".") || dir === "node_modules") continue;
    const skillsRoot = path.join(packagesRoot, dir, "skills");
    if (!isDirectory(skillsRoot)) continue;
    const label = dir === "create-warlock" ? dir : `@warlock.js/${dir}`;
    const add = (type: CoverageIssue["type"], file: string, message: string) =>
      issues.push({
        package: label,
        relPath: path.relative(packagesRoot, path.join(skillsRoot, file)).split(path.sep).join("/"),
        type,
        message,
      });

    const topics = readdirSync(skillsRoot)
      .sort()
      .filter((name) => isFile(path.join(skillsRoot, name, "SKILL.md")));
    const indexFile = path.join(skillsRoot, "index.md");

    if (topics.length >= 2 && !isFile(indexFile)) {
      add(
        "missing-index",
        "index.md",
        `${topics.length} topic skills but no skills/index.md: agent-kit exports them as ${topics.length} flat skills instead of one grouped skill`,
      );
    }

    if (isFile(indexFile)) {
      const description = readSkillDescription(readFileSync(indexFile, "utf8"));
      if (!description) {
        add("missing-index-description", "index.md", "index.md needs a frontmatter description");
      } else if (
        description.length < INDEX_DESCRIPTION_MIN ||
        description.length > INDEX_DESCRIPTION_MAX
      ) {
        add(
          "index-description-length",
          "index.md",
          `index.md description has ${description.length} characters; it must be ${INDEX_DESCRIPTION_MIN}-${INDEX_DESCRIPTION_MAX}`,
        );
      }
    }

    for (const topic of topics) {
      const text = readFileSync(path.join(skillsRoot, topic, "SKILL.md"), "utf8");
      if (!frontmatterField(text, "name"))
        add("missing-topic-name", `${topic}/SKILL.md`, "topic SKILL.md needs a frontmatter name");
      if (!frontmatterField(text, "description"))
        add(
          "missing-topic-description",
          `${topic}/SKILL.md`,
          "topic SKILL.md needs a single-line frontmatter description",
        );
    }

    const entry = path.join(packagesRoot, dir, "src", "index.ts");
    if (!existsSync(entry)) continue;
    const files: string[] = [];
    walkMarkdown(skillsRoot, files);
    const mentioned = identifierSet(files.map((f) => codeText(readFileSync(f, "utf8"))).join("\n"));
    const exported = readExports(entry);
    packages.push({
      dir,
      valueExports: exported.filter((item) => !item.typeOnly).length,
      uncovered: exported
        .filter((item) => !item.typeOnly && !mentioned.has(item.name))
        .map((item) => item.name)
        .sort(),
      uncoveredTypes: exported
        .filter((item) => item.typeOnly && !mentioned.has(item.name))
        .map((item) => item.name)
        .sort(),
    });
  }

  return { issues, packages };
}

export function readAllowances(filePath = ALLOWANCES_PATH): Record<string, number> {
  const { config, error } = readJsonc(readFileSync(filePath, "utf8"));
  if (error || !config) throw new Error(`Cannot read skill coverage allowances at ${filePath}.`);
  return config as Record<string, number>;
}

/** Packages whose uncovered count exceeds the recorded allowance (or has none). */
export function overAllowance(
  packages: PackageCoverage[],
  allowances: Record<string, number>,
): { dir: string; count: number; allowance: number | undefined }[] {
  return packages
    .filter((pkg) => {
      const allowance = allowances[pkg.dir];
      return allowance === undefined || pkg.uncovered.length > allowance;
    })
    .map((pkg) => ({ dir: pkg.dir, count: pkg.uncovered.length, allowance: allowances[pkg.dir] }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const only = args.filter((arg) => !arg.startsWith("--"));
  const report = runSkillCoverageGate(PACKAGES_ROOT);
  const allowances = readAllowances();
  const over = overAllowance(report.packages, allowances);

  for (const issue of report.issues) {
    console.error(`${issue.package} ${issue.relPath} [${issue.type}] ${issue.message}`);
  }

  console.log("skill-coverage: uncovered value exports / allowance");
  for (const pkg of report.packages) {
    const allowance = allowances[pkg.dir];
    const flag = over.some((item) => item.dir === pkg.dir)
      ? allowance === undefined
        ? " NO ALLOWANCE"
        : ` OVER by ${pkg.uncovered.length - allowance}`
      : "";
    console.log(`  ${pkg.dir}: ${pkg.uncovered.length} / ${allowance ?? "-"}${flag}`);
    if (list && (only.length === 0 || only.includes(pkg.dir))) {
      for (const name of pkg.uncovered) console.log(`      ${name}`);
      for (const name of pkg.uncoveredTypes) console.log(`      ${name} (type)`);
    }
  }

  if (report.issues.length > 0 || over.length > 0) {
    console.error(
      `\nskill-coverage: ${report.issues.length} skill issue(s), ${over.length} package(s) over their allowance. ` +
        "Mention the missing exports in the package skills; never raise an allowance.",
    );
    process.exitCode = 1;
  }
}
