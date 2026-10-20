/**
 * Skill-snippet compile gate.
 *
 * ## Why this exists
 *
 * Our published skills taught the *previous major version's* handler
 * signature. Fixing that let TypeScript see those examples for the first
 * time, and four further defects fell out that no grep would have found —
 * including every validated file upload typing as `unknown` and
 * `warlock create.controller` generating code that does not compile.
 *
 * A snippet that cannot be compiled cannot be proven wrong in public. So this
 * gate's bar is NOT "the signature looks current" — it is **extractable and
 * compilable as written**. It:
 *
 *   1. Derives its subject list from the filesystem — every `skills/**\/SKILL.md`
 *      under a workspace package (a directory with both `package.json` and a
 *      `skills/` folder), never a hardcoded list.
 *   2. Extracts every fenced ```ts / ```tsx block from each skill.
 *   3. Compiles the ones that look like real files against the REAL
 *      declarations — each package's own `src/index.ts`, resolved through an
 *      absolute-path `paths` map, the same mechanism `core/tsconfig.typecheck.json`,
 *      `web/tsconfig.typecheck.json`, and the reference app `v5/app/tsconfig.json`
 *      already use in this repo.
 *   4. Reports pass/fail per snippet with the compiler's own error text.
 *   5. Exits non-zero on any failure.
 *
 * ## Partial vs. broken — the design decision this file must not hide
 *
 * Not every fenced block is a complete file. A three-line body fragment
 * ("here's what goes inside the handler") has no imports by design and was
 * never meant to compile alone. But a block that DOES claim to be a real file
 * — it carries a docs `title="path/to/file.ts"` — has no such excuse: if it
 * can't compile, the reader can't paste it and get working code.
 *
 * So the rule is:
 *
 *   - A block with a path-shaped `title="..."` attribute is a claimed real
 *     file. It is ALWAYS compiled, imports or not. This is what catches "no
 *     import lines at all, its types and helpers all undefined" — a titled
 *     handler snippet with no imports is exactly the shape of that defect,
 *     and this rule does not exempt it.
 *   - An untitled block IS compiled if it contains at least one `import`
 *     statement — the author chose to show a self-contained unit.
 *   - An untitled block with no `import` at all is treated as a deliberate
 *     fragment and SKIPPED (counted, but not pass/failed).
 *
 * What this lets through uncaught: an untitled, import-free fragment that
 * happens to reference an undefined helper (e.g. a snippet showing three
 * lines of a controller body that calls `someHelper()` never imported
 * anywhere). That fragment shape is common and deliberate throughout these
 * skills (see e.g. `core/skills/upload-file/SKILL.md`'s "Image processing
 * pipeline" example), so compiling it would fail almost every skill on
 * content that was never meant to stand alone. The line drawn here is
 * "claims to be a file (titled) or claims to be self-sufficient (has
 * imports)" — anything short of that claim is not held to the compile bar.
 *
 * ## Where compilation happens
 *
 * Each compiled skill gets an ISOLATED directory under
 * `<packagesRoot>/.skill-snippet-gate-tmp/<package>/<skill-slug>/`, populated with
 * one real file per compiled block at its `title=` path (or a synthetic
 * `__untitled/block-N.ts` for untitled-but-import-bearing blocks). This
 * directory is removed in `finally` after diagnostics are collected, including
 * failed runs. It sits inside the monorepo so `@mongez/*` third-party types resolve
 * through the ROOT `node_modules` (pnpm's `publicHoistPattern` hoists
 * `@mongez/*` and `@types/*` there — see `pnpm-workspace.yaml`).
 *
 * A generated `tsconfig.json` is written into that directory (not merely held
 * in memory) and is what gets compiled — see the "known-freshness" note in
 * `runSkillSnippetGate`'s return value. It does NOT use `extends`: TypeScript
 * re-resolves an extended config's relative `paths`/`baseUrl` against the
 * BASE file's own directory in ways that are easy to get subtly wrong when
 * the extending file lives somewhere else entirely. Instead every
 * `@warlock.js/*` package is mapped by an ABSOLUTE path straight at that
 * package's `src/index.ts` — computed from the SAME filesystem discovery this
 * gate uses for its subject list, so it can never drift from what packages
 * actually exist. `app/*` and `web/*` — the app-scaffold aliases every
 * controller/schema example is written against — map to that skill's own
 * isolated `src/app/*` and `src/web/*`, exactly mirroring the real
 * `v5/app/tsconfig.json` alias shape. This is what catches defect #1 from the
 * card: a controller titled to live at `src/app/uploads/controllers/x.ts`
 * importing `"../schema/upload-avatar.schema"` fails to resolve — a real
 * "Cannot find module" — when no sibling block in that same skill was titled
 * that path.
 *
 * Deliberately NOT covered by compilation: the same type documented at two
 * different app paths across DIFFERENT skills (defect #3 from the card).
 * Compiling each skill in its own isolated directory cannot see across
 * skills. `findCrossSkillTypePathConflicts` below is a separate, explicitly
 * heuristic, non-compiler check for exactly that case — it walks every
 * COMPILED block's title path, looks for `export type X` / `export interface
 * X`, and flags any name whose title path is not the same across every skill
 * that documents it. It is intentionally simple (no import resolution, no
 * structural comparison) and reported separately from compiler diagnostics.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonc } from "./read-jsonc";
import { runCompiler } from "../../../packages/core/src/tooling/typescript/compiler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The monorepo root (tools/release/scripts -> ../../..). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
/** Every shipped package is a direct child of this directory. */
export const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");
export const GATE_TMP_DIR_NAME = ".skill-snippet-gate-tmp";
/** The committed ratchet baseline the gate reads. */
export const ALLOWANCES_PATH = path.join(__dirname, "skill-snippet-allowances.jsonc");

export interface WorkspacePackage {
  /** Directory name at the repo root, e.g. "core". */
  dir: string;
  /** Absolute path to the package directory. */
  absPath: string;
  /** package.json "name" field, e.g. "@warlock.js/core" or "create-warlock". */
  name: string;
}

export interface DiscoveredSkill {
  package: WorkspacePackage;
  /** Absolute path to SKILL.md. */
  filePath: string;
  /** Slug: the skills/-relative directory path, e.g. "upload-file". */
  slug: string;
}

export type BlockLang = "ts" | "tsx";

export interface ExtractedBlock {
  skill: DiscoveredSkill;
  /** 0-based index of this fenced block within its SKILL.md. */
  index: number;
  lang: BlockLang;
  /** Raw info string after the language tag on the opening fence line. */
  info: string;
  body: string;
  /** 1-based line number of the opening fence, for locating the block by hand. */
  line: number;
  /** Path-shaped `title="..."` attribute, if present and valid. */
  titlePath?: string;
}

export type ClassifiedBlock =
  | {
      kind: "compile";
      block: ExtractedBlock;
      virtualPath: string;
      reason: "titled" | "untitled-with-import";
    }
  | { kind: "skip"; block: ExtractedBlock; reason: string };

export interface CompiledFileResult {
  virtualPath: string;
  absolutePath: string;
  block: ExtractedBlock;
  diagnostics: string[];
}

export interface SkillCompileResult {
  skill: DiscoveredSkill;
  skillRoot: string;
  tsconfigPath: string;
  files: CompiledFileResult[];
  skipped: Array<{ block: ExtractedBlock; reason: string }>;
  duplicateTitles: Array<{ block: ExtractedBlock; titlePath: string; syntheticPath: string }>;
}

export interface TypePathConflict {
  typeName: string;
  occurrences: Array<{ skill: DiscoveredSkill; titlePath: string }>;
}

export interface GateReport {
  packages: WorkspacePackage[];
  skills: DiscoveredSkill[];
  results: SkillCompileResult[];
  typePathConflicts: TypePathConflict[];
}

/** A `title="..."` value that plausibly names a real file, not prose. */
const PATH_LIKE_TITLE = /^[A-Za-z0-9_.\-/]+\.tsx?$/;

// "tsx" before "ts" in the alternation — "ts" alone would match the first two
// characters of a ```tsx fence and leave a stray "x" glued onto the info
// string, silently corrupting every tsx block's language tag.
const FENCE_RE = /```(tsx|ts)\b([^\n]*)\n([\s\S]*?)```/g;
const TITLE_ATTR_RE = /title\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/**
 * Every top-level workspace directory that is a real package (has its own
 * `package.json`) AND ships skills (has a `skills/` directory). Filesystem
 * derived — nothing here is a hardcoded package list. Directories such as
 * `.claude`, `.codex`, `builder`, and the top-level `./skills` (the
 * workspace's own dev-only skill, not a shipped package skill) are excluded
 * automatically because they fail one half of that test.
 */
export function discoverPackages(repoRoot: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const dir of readdirSync(repoRoot)) {
    const absPath = path.join(repoRoot, dir);
    if (!isDirectory(absPath)) continue;
    const packageJsonPath = path.join(absPath, "package.json");
    const skillsPath = path.join(absPath, "skills");
    if (!existsSync(packageJsonPath) || !isDirectory(skillsPath)) continue;
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
    if (!manifest.name) continue;
    packages.push({ dir, absPath, name: manifest.name });
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** Root `skills/SKILL.md` and all grouped topic SKILL.md files, filesystem derived. */
export function discoverSkillFiles(pkg: WorkspacePackage): DiscoveredSkill[] {
  const skillsRoot = path.join(pkg.absPath, "skills");
  const found: DiscoveredSkill[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const child = path.join(dir, name);
      if (isDirectory(child)) {
        walk(child);
      } else if (name === "SKILL.md") {
        const slug = path.relative(skillsRoot, dir).split(path.sep).join("/");
        found.push({ package: pkg, filePath: child, slug: slug || "." });
      }
    }
  };
  if (isDirectory(skillsRoot)) walk(skillsRoot);
  return found.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Every fenced ```ts / ```tsx block in one SKILL.md. */
export function extractFencedBlocks(markdown: string, skill: DiscoveredSkill): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let index = 0;
  let match: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(markdown))) {
    const [, lang, info, body] = match;
    const line = markdown.slice(0, match.index).split("\n").length;
    const titleMatch = TITLE_ATTR_RE.exec(info);
    const rawTitle = titleMatch ? (titleMatch[1] ?? titleMatch[2] ?? "") : undefined;
    const titlePath = rawTitle && PATH_LIKE_TITLE.test(rawTitle) ? rawTitle : undefined;
    blocks.push({ skill, index, lang: lang as BlockLang, info, body, line, titlePath });
    index += 1;
  }
  return blocks;
}

const HAS_IMPORT_RE = /^\s*import\s/m;

/**
 * "Partial vs. broken" heuristic — see the file header for the full
 * rationale. A titled block is always compiled (it claims to BE a file). An
 * untitled block is compiled only if it contains an import (it claims to
 * stand alone). Everything else is a fragment and is skipped, not failed.
 */
export function classifyBlock(block: ExtractedBlock): ClassifiedBlock {
  if (block.titlePath) {
    return {
      kind: "compile",
      block,
      virtualPath: normalizeVirtualPath(block.titlePath),
      reason: "titled",
    };
  }
  if (HAS_IMPORT_RE.test(block.body)) {
    const ext = block.lang === "tsx" ? "tsx" : "ts";
    return {
      kind: "compile",
      block,
      virtualPath: `__untitled/block-${block.index}.${ext}`,
      reason: "untitled-with-import",
    };
  }
  return { kind: "skip", block, reason: "untitled fragment with no import statement" };
}

function normalizeVirtualPath(titlePath: string): string {
  return titlePath.replace(/^\.\//, "");
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Builds the isolated compile unit for one skill: which files get written
 * where, resolving duplicate `title=` paths within the SAME skill (two
 * blocks that both claim to be `src/config/http.ts`, for example — real
 * cases exist, e.g. `core/skills/health-checks/SKILL.md`) by keeping the
 * first occurrence at its real path and routing the rest to a synthetic
 * path so neither is silently dropped nor allowed to overwrite the other.
 */
const RELATIVE_IMPORT_RE = /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g;
const SIBLING_EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * The latest earlier titled block each relative import of `block` names, keyed
 * by that block's title path. A skill shows a file evolving: a page that imports
 * `./x.setup` means the most recent `x.setup` shown before it.
 */
function resolveSiblings(
  block: ExtractedBlock,
  virtualPath: string,
  latest: ReadonlyMap<string, ExtractedBlock>,
): Map<string, ExtractedBlock> {
  const siblings = new Map<string, ExtractedBlock>();
  for (const [, specifier] of block.body.matchAll(RELATIVE_IMPORT_RE)) {
    const target = path.posix.normalize(
      path.posix.join(path.posix.dirname(virtualPath), specifier),
    );
    for (const extension of SIBLING_EXTENSIONS) {
      const candidate = latest.get(target + extension);
      if (candidate) {
        siblings.set(target + extension, candidate);
        break;
      }
    }
  }
  return siblings;
}

export function planSkillCompileUnit(
  skill: DiscoveredSkill,
  blocks: ExtractedBlock[],
): {
  files: Map<string, ExtractedBlock>;
  /** Copies of earlier blocks that a paired block imports: compiled, never reported. */
  support: Set<string>;
  skipped: Array<{ block: ExtractedBlock; reason: string }>;
  duplicateTitles: Array<{ block: ExtractedBlock; titlePath: string; syntheticPath: string }>;
} {
  const files = new Map<string, ExtractedBlock>();
  const support = new Set<string>();
  const latest = new Map<string, ExtractedBlock>();
  const skipped: Array<{ block: ExtractedBlock; reason: string }> = [];
  const duplicateTitles: Array<{
    block: ExtractedBlock;
    titlePath: string;
    syntheticPath: string;
  }> = [];

  for (const block of blocks) {
    const classified = classifyBlock(block);
    if (classified.kind === "skip") {
      skipped.push({ block, reason: classified.reason });
      continue;
    }
    let virtualPath = classified.virtualPath;
    const duplicate = files.has(virtualPath);
    const siblings = block.titlePath ? resolveSiblings(block, virtualPath, latest) : new Map();
    // Isolate a block whose relative imports would otherwise resolve to a
    // different version of a sibling than the one shown just before it.
    const needsPairing = [...siblings].some(
      ([siblingPath, sibling]) => files.get(siblingPath) !== sibling,
    );
    if (needsPairing || (duplicate && siblings.size > 0)) {
      const directory = `__paired/block-${block.index}`;
      if (duplicate)
        duplicateTitles.push({
          block,
          titlePath: virtualPath,
          syntheticPath: `${directory}/${virtualPath}`,
        });
      for (const [siblingPath, sibling] of siblings) {
        files.set(`${directory}/${siblingPath}`, sibling);
        support.add(`${directory}/${siblingPath}`);
      }
      virtualPath = `${directory}/${virtualPath}`;
    } else if (duplicate) {
      const ext = block.lang === "tsx" ? "tsx" : "ts";
      const synthetic = `__duplicate-title/block-${block.index}.${ext}`;
      duplicateTitles.push({ block, titlePath: virtualPath, syntheticPath: synthetic });
      virtualPath = synthetic;
    }
    files.set(virtualPath, block);
    if (block.titlePath) latest.set(classified.virtualPath, block);
  }
  return { files, support, skipped, duplicateTitles };
}

/**
 * Absolute-path `@warlock.js/*` map, derived from the SAME package discovery
 * the subject list uses — never hand-listed, so it cannot drift from what
 * packages actually exist.
 */
function buildPackagePaths(packages: WorkspacePackage[]): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  for (const pkg of packages) {
    const manifest = JSON.parse(readFileSync(path.join(pkg.absPath, "package.json"), "utf8"));
    if (Object.prototype.hasOwnProperty.call(manifest, "exports")) {
      const exports = manifest.exports;
      const entries =
        exports &&
        typeof exports === "object" &&
        !Array.isArray(exports) &&
        Object.keys(exports).some((key) => key.startsWith("."))
          ? Object.entries(exports)
          : [[".", exports]];
      for (const [subpath, target] of entries) {
        if (typeof subpath !== "string" || (subpath !== "." && !subpath.startsWith("./"))) continue;
        const source = exportSource(target);
        if (source) {
          paths[subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`] = [
            toPosix(path.resolve(pkg.absPath, source)),
          ];
        }
      }
      continue;
    }
    const entry = path.join(pkg.absPath, "src", "index.ts");
    if (existsSync(entry)) {
      paths[pkg.name] = [toPosix(entry)];
      // Published subpaths (for example core/tests and core/errors) have
      // independent source entries. Do not send them through the root barrel.
      paths[`${pkg.name}/*`] = [
        toPosix(path.join(pkg.absPath, "src", "*", "index.ts")),
        toPosix(path.join(pkg.absPath, "src", "*.ts")),
      ];
    }
  }
  return paths;
}

/** Follow the declaration/import conditions without exposing unexported source files. */
function exportSource(target: unknown): string | undefined {
  if (typeof target === "string") return target.startsWith("./") ? target : undefined;
  if (Array.isArray(target)) {
    for (const entry of target) {
      const source = exportSource(entry);
      if (source) return source;
    }
  } else if (target && typeof target === "object") {
    const conditions = target as Record<string, unknown>;
    for (const condition of ["types", "import", "default"]) {
      const source = exportSource(conditions[condition]);
      if (source) return source;
    }
  }
  return undefined;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Only `@warlock.js/*` gets a `paths` entry — absolute, derived from the same
 * package discovery the subject list uses. `app/*` and `web/*` are NOT a
 * `paths` wildcard here: a wildcard target is one fixed directory for the
 * whole program, and this gate compiles every skill's files in ONE shared
 * program (see `compileManySkills`), so a single `app/*` target would let
 * skill A's `app/…` import silently resolve to skill B's file of the same
 * relative name — masking exactly the "file does not exist" defect this gate
 * exists to catch. Instead `createCombinedHost` below resolves `app/*` /
 * `web/*` per FILE, scoped to that file's own isolated skill directory.
 */
function buildTsconfig(packages: WorkspacePackage[]): object {
  return {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      strict: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["node"],
      paths: buildPackagePaths(packages),
    },
    include: ["**/*.ts", "**/*.tsx"],
  };
}

interface WrittenSkillUnit {
  skill: DiscoveredSkill;
  skillRoot: string;
  tsconfigPath: string;
  written: Array<{
    virtualPath: string;
    absolutePath: string;
    block: ExtractedBlock;
    support: boolean;
  }>;
  skipped: Array<{ block: ExtractedBlock; reason: string }>;
  duplicateTitles: Array<{ block: ExtractedBlock; titlePath: string; syntheticPath: string }>;
}

/**
 * Writes one skill's isolated compile unit to disk: every compiled block at
 * its virtual path, plus a `tsconfig.json` — kept per-skill purely as
 * evidence a human (or a future `--only` per-skill CLI run) can point `tsc`
 * at directly; the actual gate run compiles from `compileManySkills` below,
 * which reads its OWN shared config, not this one.
 */
function writeSkillUnit(
  skill: DiscoveredSkill,
  packages: WorkspacePackage[],
  gateTmpRoot: string,
): WrittenSkillUnit {
  const markdown = readFileSync(skill.filePath, "utf8");
  const blocks = extractFencedBlocks(markdown, skill);
  const { files, support, skipped, duplicateTitles } = planSkillCompileUnit(skill, blocks);

  const skillRoot = path.join(gateTmpRoot, skill.package.dir, skill.slug.replace(/[\\/]/g, "__"));
  rmSync(skillRoot, { recursive: true, force: true });
  mkdirSync(skillRoot, { recursive: true });

  const written: WrittenSkillUnit["written"] = [];
  for (const [virtualPath, block] of files) {
    const absolutePath = path.join(skillRoot, ...virtualPath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, block.body, "utf8");
    written.push({ virtualPath, absolutePath, block, support: support.has(virtualPath) });
  }

  const tsconfigPath = path.join(skillRoot, "tsconfig.json");
  writeFileSync(tsconfigPath, `${JSON.stringify(buildTsconfig(packages), null, 2)}\n`, "utf8");

  return { skill, skillRoot, tsconfigPath, written, skipped, duplicateTitles };
}

function normalizeForCompare(p: string): string {
  return path.resolve(p).toLowerCase();
}

/** Each skill gets its own bare app/web packages and its owner's dependency scope. */
function linkSkillDependencies(unit: WrittenSkillUnit): void {
  const modules = path.join(unit.skillRoot, "node_modules");
  mkdirSync(modules, { recursive: true });
  const ownerModules = path.join(unit.skill.package.absPath, "node_modules");
  if (existsSync(ownerModules)) {
    for (const entry of readdirSync(ownerModules)) {
      if (entry === "app" || entry === "web" || entry.startsWith(".")) continue;
      symlinkSync(path.join(ownerModules, entry), path.join(modules, entry), "junction");
    }
  }
  for (const alias of ["app", "web"])
    symlinkSync(path.join(unit.skillRoot, "src", alias), path.join(modules, alias), "junction");
}

/** Compile ordinary snippets together, isolating declaration-merging skills. */
export function compileManySkills(
  skills: DiscoveredSkill[],
  packages: WorkspacePackage[],
  gateTmpRoot: string,
): SkillCompileResult[] {
  const units = skills.map((skill) => writeSkillUnit(skill, packages, gateTmpRoot));
  for (const unit of units) linkSkillDependencies(unit);
  const allWritten = units.flatMap((u) => u.written);
  // Declaration merging changes the meaning of shared package types. Keep
  // those application registries in their own program, just like separate apps.
  const augmentingUnits = units.filter((unit) =>
    unit.written.some(({ block }) => /\bdeclare\s+(?:module|global)\b/.test(block.body)),
  );
  const plainUnits = units.filter((unit) => !augmentingUnits.includes(unit));
  const compileGroups = [
    plainUnits.flatMap((unit) => unit.written),
    ...augmentingUnits.map((unit) => unit.written),
  ];

  let diagnosticsByFile = new Map<string, string[]>();
  if (allWritten.length > 0) {
    const sharedTsconfigPath = path.join(gateTmpRoot, "tsconfig.json");
    writeFileSync(
      sharedTsconfigPath,
      `${JSON.stringify(buildTsconfig(packages), null, 2)}\n`,
      "utf8",
    );
    const assetsPath = path.join(gateTmpRoot, "assets.d.ts");
    writeFileSync(assetsPath, 'declare module "*.css" {}\n', "utf8");
    const diagnostics = compileGroups
      .filter((group) => group.length > 0)
      .flatMap((group, index) => {
        const configPath = path.join(gateTmpRoot, `tsconfig.group-${index}.json`);
        writeFileSync(
          configPath,
          JSON.stringify({
            ...buildTsconfig(packages),
            files: [assetsPath, ...group.map((file) => file.absolutePath)],
            include: [],
          }),
          "utf8",
        );
        return runCompiler(gateTmpRoot, ["-p", configPath, "--noEmit"]).diagnostics;
      });

    const gateTmpNormalized = normalizeForCompare(gateTmpRoot);
    for (const diagnostic of diagnostics) {
      if (!diagnostic.fileName) continue;
      const fileName = normalizeForCompare(diagnostic.fileName);
      // Only diagnostics against files INSIDE the gate's own tmp tree are
      // ours to report — a cascading error surfaced against a real
      // package's own source (e.g. a snippet passed it a wrong argument
      // type) is still attributed to the snippet that misused it, never to
      // the package source itself.
      if (!fileName.startsWith(gateTmpNormalized)) continue;
      const list = diagnosticsByFile.get(fileName) ?? [];
      list.push(
        `${path.basename(diagnostic.fileName)}(${diagnostic.line},${diagnostic.column}): ${diagnostic.severity} TS${diagnostic.code}: ${diagnostic.message}`,
      );
      diagnosticsByFile.set(fileName, list);
    }
  }

  return units.map((unit) => ({
    skill: unit.skill,
    skillRoot: unit.skillRoot,
    tsconfigPath: unit.tsconfigPath,
    files: unit.written
      .filter(({ support }) => !support)
      .map(({ virtualPath, absolutePath, block }) => ({
        virtualPath,
        absolutePath,
        block,
        diagnostics: diagnosticsByFile.get(normalizeForCompare(absolutePath)) ?? [],
      })),
    skipped: unit.skipped,
    duplicateTitles: unit.duplicateTitles,
  }));
}

/** Compiles a single skill. A thin wrapper over `compileManySkills` used by tests and any future per-skill CLI filter. */
export function compileSkill(
  skill: DiscoveredSkill,
  packages: WorkspacePackage[],
  gateTmpRoot: string,
): SkillCompileResult {
  return compileManySkills([skill], packages, gateTmpRoot)[0];
}

const EXPORTED_TYPE_RE = /export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g;

/**
 * Explicitly heuristic, non-compiler check for defect #3: the same type
 * documented at two different app paths across DIFFERENT skills. Walks every
 * COMPILED, TITLED block, collects `export type X` / `export interface X`
 * declarations, and flags any name whose title path is not identical across
 * every skill that declares it. No import graph, no structural comparison —
 * a same-named type at the same path in two skills is assumed to be the same
 * documented type; a same-named type at two different paths is flagged.
 */
export function findCrossSkillTypePathConflicts(results: SkillCompileResult[]): TypePathConflict[] {
  const byType = new Map<string, Array<{ skill: DiscoveredSkill; titlePath: string }>>();
  for (const result of results) {
    for (const file of result.files) {
      if (file.block.titlePath === undefined) continue;
      EXPORTED_TYPE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = EXPORTED_TYPE_RE.exec(file.block.body))) {
        const list = byType.get(match[1]) ?? [];
        list.push({ skill: result.skill, titlePath: file.virtualPath });
        byType.set(match[1], list);
      }
    }
  }
  const conflicts: TypePathConflict[] = [];
  for (const [typeName, occurrences] of byType) {
    const distinctSkills = new Set(occurrences.map((o) => o.skill.filePath));
    const distinctPaths = new Set(occurrences.map((o) => o.titlePath));
    if (distinctSkills.size > 1 && distinctPaths.size > 1) {
      conflicts.push({ typeName, occurrences });
    }
  }
  return conflicts.sort((a, b) => a.typeName.localeCompare(b.typeName));
}

export function runSkillSnippetGate(repoRoot: string): GateReport {
  const gateTmpRoot = path.join(repoRoot, GATE_TMP_DIR_NAME);
  rmSync(gateTmpRoot, { recursive: true, force: true });
  try {
    mkdirSync(gateTmpRoot, { recursive: true });
    const packages = discoverPackages(repoRoot);
    const skills = packages.flatMap((pkg) => discoverSkillFiles(pkg));
    const results = compileManySkills(skills, packages, gateTmpRoot);
    const typePathConflicts = findCrossSkillTypePathConflicts(results);

    return { packages, skills, results, typePathConflicts };
  } finally {
    rmSync(gateTmpRoot, { recursive: true, force: true });
  }
}

/**
 * Reads the committed per-package ratchet baseline. Same `.jsonc` shape and
 * same "these numbers may only go DOWN" contract as `strictness-allowances.jsonc`
 * — the value is the number of failing compiled snippets a package is allowed to
 * still carry, measured at baseline. A new failure pushes a package OVER and
 * fails the gate; a fixed one can only lower a baseline.
 */
export function readAllowances(filePath = ALLOWANCES_PATH): Record<string, number> {
  const parsed = readJsonc(readFileSync(filePath, "utf8"));
  if (parsed.error || !parsed.config || typeof parsed.config !== "object") {
    throw new Error(`Cannot read skill-snippet allowances at ${filePath}.`);
  }
  return parsed.config as Record<string, number>;
}

export interface PackageFailureCount {
  /** Package directory name, e.g. "core". */
  dir: string;
  /** Compiled snippets in this package that failed to type-check. */
  failed: number;
}

/**
 * Counts failing COMPILED snippets per package from a gate report. A snippet is
 * "failed" when its compiled file carried at least one compiler diagnostic —
 * exactly the pass/fail unit `formatReport` already prints. Skipped fragments
 * are never counted. Cross-skill type/path conflicts are tracked separately (a
 * hard zero, not allowanced) and are not part of this per-package tally.
 */
export function countFailuresByPackage(report: GateReport): PackageFailureCount[] {
  const byDir = new Map<string, number>();
  for (const pkg of report.packages) byDir.set(pkg.dir, 0);
  for (const result of report.results) {
    const dir = result.skill.package.dir;
    const failed = result.files.filter((file) => file.diagnostics.length > 0).length;
    byDir.set(dir, (byDir.get(dir) ?? 0) + failed);
  }
  return [...byDir.entries()]
    .map(([dir, failed]) => ({ dir, failed }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

export interface RatchetReport {
  /** Per-package failing count against its recorded allowance. */
  rows: Array<{ dir: string; failed: number; allowance: number; over: number }>;
  /** Total failing compiled snippets across every package. */
  totalFailed: number;
  /** Sum of every recorded allowance — the stated, tracked scope. */
  totalAllowance: number;
  /** Cross-skill type/path conflicts — held at a hard zero, never allowanced. */
  typePathConflicts: number;
  /** True when any package is OVER its allowance, has no allowance, or a conflict exists. */
  failed: boolean;
}

/**
 * Evaluates the report against the committed baseline: a package OVER its
 * allowance fails; a measured package with NO recorded allowance fails (an
 * unmeasured allowance is never silently treated as zero, matching
 * `strictness-gate.ts`); any cross-skill type/path conflict fails (hard zero).
 */
export function evaluateRatchet(
  report: GateReport,
  allowances: Record<string, number>,
): RatchetReport {
  const counts = countFailuresByPackage(report);
  const rows = counts.map(({ dir, failed }) => {
    const allowance = allowances[dir];
    if (allowance === undefined) {
      throw new Error(
        `No skill-snippet allowance recorded for package '${dir}'. Add it to ${path.basename(ALLOWANCES_PATH)}.`,
      );
    }
    return { dir, failed, allowance, over: failed - allowance };
  });
  const totalFailed = rows.reduce((sum, row) => sum + row.failed, 0);
  const totalAllowance = rows.reduce((sum, row) => sum + row.allowance, 0);
  const typePathConflicts = report.typePathConflicts.length;
  const failed = rows.some((row) => row.over > 0) || typePathConflicts > 0;
  return { rows, totalFailed, totalAllowance, typePathConflicts, failed };
}

function formatReport(report: GateReport): { text: string; failed: boolean } {
  const lines: string[] = [];
  let totalBlocks = 0;
  let totalCompiled = 0;
  let totalSkipped = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const failures: string[] = [];

  lines.push(
    `skill-snippet-gate: ${report.packages.length} package(s) with skills, ${report.skills.length} SKILL.md file(s).`,
  );
  lines.push(`packages: ${report.packages.map((p) => p.dir).join(", ")}`);
  lines.push("");

  for (const result of report.results) {
    const skillLabel = toPosix(path.relative(PACKAGES_ROOT, result.skill.filePath));
    totalSkipped += result.skipped.length;
    for (const file of result.files) {
      totalBlocks += 1;
      totalCompiled += 1;
      if (file.diagnostics.length === 0) {
        totalPassed += 1;
      } else {
        totalFailed += 1;
        failures.push(
          `FAIL ${skillLabel} :: ${file.virtualPath} (compiled at ${file.absolutePath})`,
        );
        for (const d of file.diagnostics) failures.push(`    ${d}`);
      }
    }
    totalBlocks += result.skipped.length;
  }

  for (const conflict of report.typePathConflicts) {
    failures.push(
      `FAIL cross-skill-type-path :: "${conflict.typeName}" documented at ${new Set(conflict.occurrences.map((o) => o.titlePath)).size} different paths:`,
    );
    for (const occ of conflict.occurrences) {
      failures.push(`    ${occ.skill.package.dir}/skills/${occ.skill.slug} -> ${occ.titlePath}`);
    }
  }

  lines.push(
    `blocks found: ${totalBlocks} (ts/tsx fences only; see file header re. "typescript"-language fences being out of the literal scope this gate was asked for)`,
  );
  lines.push(`  compiled: ${totalCompiled} (passed ${totalPassed}, failed ${totalFailed})`);
  lines.push(`  skipped as deliberate fragments (no title, no import): ${totalSkipped}`);
  lines.push(`  cross-skill type/path conflicts: ${report.typePathConflicts.length}`);
  lines.push("");

  if (failures.length > 0) {
    lines.push("--- failures ---");
    lines.push(...failures);
  } else {
    lines.push("All compiled snippets passed.");
  }

  return { text: lines.join("\n"), failed: totalFailed > 0 || report.typePathConflicts.length > 0 };
}

function formatRatchet(ratchet: RatchetReport): string {
  const lines: string[] = [
    "--- ratchet (failing compiled snippets / allowance; baseline may only go DOWN) ---",
  ];
  for (const row of ratchet.rows) {
    const status =
      row.over > 0
        ? ` OVER by ${row.over}`
        : row.failed < row.allowance
          ? ` (${row.allowance - row.failed} under — lower the baseline)`
          : " OK";
    lines.push(`  ${row.dir}: ${row.failed} / ${row.allowance}${status}`);
  }
  lines.push("");
  lines.push(`total failing: ${ratchet.totalFailed} / ${ratchet.totalAllowance} allowance`);
  lines.push(
    `cross-skill type/path conflicts: ${ratchet.typePathConflicts} (hard zero — never allowanced)`,
  );
  lines.push(
    ratchet.failed
      ? "RATCHET FAILED: a package is OVER its allowance (a NEW failure) or a conflict exists."
      : "RATCHET OK: no package exceeds its recorded baseline.",
  );
  return lines.join("\n");
}

async function main(): Promise<number> {
  const report = runSkillSnippetGate(PACKAGES_ROOT);
  const { text } = formatReport(report);
  console.log(text);
  const ratchet = evaluateRatchet(report, readAllowances());
  console.log("");
  console.log(formatRatchet(ratchet));
  return ratchet.failed ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().then((code) => process.exit(code));
}
