/**
 * Shipped-docs package-manager gate.
 *
 * ## Why this exists
 *
 * `skills/**` and `llms.txt` / `llms-full.txt` ship INSIDE the published
 * tarballs — they are documentation users receive, not internal notes. This
 * workspace's own tooling is pnpm-only, but shipped docs must work for an
 * npm (or yarn) consumer too: `create-warlock` even offers a `--pm=npm`
 * flag. A doc that tells that user to run `pnpm warlock routes --json`
 * doesn't just look wrong — pnpm-specific invocation syntax (`pnpm
 * <binary>`) has no npm equivalent, so the command FAILS on their machine.
 *
 * Owner ruling: pnpm is for INTERNAL framework development. Shipped
 * documentation must not assume it.
 *
 * ## Why this is mechanical, not prose
 *
 * A rule that lives only in prose comes back — see the 5.4.0 release
 * postmortem: the JSONC rule was documented in `shadcn.feature.ts` and
 * ignored by `react-email.feature.ts`; the stdout/stderr rule was documented
 * for three functions and missed on a fourth. So this gate scans every
 * shipped doc file directly and fails, naming file and line, on any unallowlisted bare
 * `pnpm <anything>` / `yarn <anything>` invocation it finds — no matter how
 * carefully the prose elsewhere says "use npx".
 *
 * ## The allowlist is a decision, not an escape hatch
 *
 * Some doc line may show a genuine pnpm-workspace-only operation with no npm
 * equivalent (e.g. documenting THIS repo's own internal release tooling,
 * rather than something a consumer of the published package runs). Silently
 * excluding a whole file would hide future additions to it. Instead each
 * exception is a single `{ relPath, text, reason }` entry below — recorded,
 * reviewable, and pinned to exact content so an unrelated edit to that file
 * does not silently inherit the exemption.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The monorepo root (tools/release/scripts -> ../../..). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
/** Every shipped package is a direct child of this directory. */
export const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");

export interface DocFile {
  /** Absolute path to the file. */
  absPath: string;
  /** Repo-root-relative path, posix-separated, for stable reporting. */
  relPath: string;
}

export interface Violation {
  relPath: string;
  /** 1-based line number. */
  line: number;
  /** The offending line, trimmed. */
  text: string;
  /** Which manager the line invoked ("pnpm" or "yarn"). */
  manager: "pnpm" | "yarn";
}

/** Exact content and file exceptions survive edits above them without exempting new commands. */
export const ALLOWLIST: ReadonlyArray<{ relPath: string; text: string; reason: string }> = [
  {
    relPath: "core/skills/run-app/SKILL.md",
    text: ":::note[Fixed in 4.9.2 — pnpm users]",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/skills/run-app/SKILL.md",
    text: "Before 4.9.2 those imports were left bare. npm and yarn hoist every transitive dependency into one flat tree, so they resolved by accident; pnpm's strict layout does not, and the dev server failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'`. The workaround was declaring `esbuild` and `get-tsconfig` in your own `package.json` — no longer needed, and you can drop them.",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/skills/run-app/SKILL.md",
    text: "### pnpm needs esbuild's install script allowed",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/skills/run-app/SKILL.md",
    text: "Where the approval goes depends on the pnpm version (measured with real installs):",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/skills/run-app/SKILL.md",
    text: 'pnpm 11 and 12 ignore `package.json`\'s `pnpm` field and fail the install when the workspace file has only `onlyBuiltDependencies`, so keep `allowBuilds` there (listing both keys is fine). pnpm before 10.5 rejects a `pnpm-workspace.yaml` without a `packages:` field (`packages field missing or empty`), and adding `packages: ["."]` makes every later dependency add fail with `ERR_PNPM_ADDING_TO_ROOT` — so on those versions use the `package.json` field instead. `create-warlock` 5.30.0 checks the pnpm version and writes the right one, and `warlock add image` follows the same rule when it approves `sharp`.',
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/skills/update-packages/SKILL.md",
    text: "| `yarn.lock`              | `yarn install` | `yarn add`          |",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/skills/update-packages/SKILL.md",
    text: "| `pnpm-lock.yaml`         | `pnpm install` | `pnpm add`          |",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/skills/update-packages/SKILL.md",
    text: "Bun is checked **first**: a Bun project may also carry a `yarn.lock` (Bun writes one for tooling compatibility), and matching yarn there would run the wrong installer against the wrong lockfile. `warlock update` and `warlock add` share this detection, so they can never disagree.",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "create-warlock/skills/create-a-warlock-project/SKILL.md",
    text: "With `--pm=pnpm`, the scaffold reads `pnpm --version` and records install-script",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "seal/skills/bridge-standard-schema/SKILL.md",
    text: "From `packages/seal`, run `pnpm bench:types --check` after changes to inference or",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: ":::note[Fixed in 4.9.2 — pnpm users]",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: "Before 4.9.2 those imports were left bare. npm and yarn hoist every transitive dependency into one flat tree, so they resolved by accident; pnpm's strict layout does not, and the dev server failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'`. The workaround was declaring `esbuild` and `get-tsconfig` in your own `package.json` — no longer needed, and you can drop them.",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: "### pnpm needs esbuild's install script allowed",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: "Where the approval goes depends on the pnpm version (measured with real installs):",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: 'pnpm 11 and 12 ignore `package.json`\'s `pnpm` field and fail the install when the workspace file has only `onlyBuiltDependencies`, so keep `allowBuilds` there (listing both keys is fine). pnpm before 10.5 rejects a `pnpm-workspace.yaml` without a `packages:` field (`packages field missing or empty`), and adding `packages: ["."]` makes every later dependency add fail with `ERR_PNPM_ADDING_TO_ROOT` — so on those versions use the `package.json` field instead. `create-warlock` 5.30.0 checks the pnpm version and writes the right one, and `warlock add image` follows the same rule when it approves `sharp`.',
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: "| `yarn.lock`              | `yarn install` | `yarn add`          |",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: "| `pnpm-lock.yaml`         | `pnpm install` | `pnpm add`          |",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: "Bun is checked **first**: a Bun project may also carry a `yarn.lock` (Bun writes one for tooling compatibility), and matching yarn there would run the wrong installer against the wrong lockfile. `warlock update` and `warlock add` share this detection, so they can never disagree.",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "create-warlock/llms-full.txt",
    text: "With `--pm=pnpm`, the scaffold reads `pnpm --version` and records install-script",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "seal/llms-full.txt",
    text: "From `packages/seal`, run `pnpm bench:types --check` after changes to inference or",
    reason:
      "Describes package-manager-specific behavior or internal workspace development, not a default consumer invocation.",
  },
  {
    relPath: "core/llms-full.txt",
    text: ":::note[Fixed in 4.9.2 — pnpm users]",
    reason: "Historical hoisting bug explanation, not a package-manager command.",
  },
  {
    relPath: "core/llms-full.txt",
    text: "Before 4.9.2 those imports were left bare. npm and yarn hoist every transitive dependency into one flat tree, so they resolved by accident; pnpm's strict layout does not, and the dev server failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'`. The workaround was declaring `esbuild` and `get-tsconfig` in your own `package.json` — no longer needed, and you can drop them.",
    reason: "Historical hoisting bug explanation, not a package-manager command.",
  },
];

function isAllowlisted(relPath: string, text: string): boolean {
  return ALLOWLIST.some((entry) => entry.relPath === relPath && entry.text === text.trim());
}

/** `pnpm <word>` or `yarn <word>` — a real invocation, not just the bare word "pnpm"/"yarn" appearing in prose. */
const INVOCATION_RE = /\b(pnpm|yarn)\s+[A-Za-z@.-]/;

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Discovers every shipped-doc file under the workspace root: each package's
 * `skills/**\/*.md` and its `llms.txt` / `llms-full.txt` — one directory
 * level down from the root, mirroring how each package ships its own
 * `skills/` folder and `llms*.txt` at its own package root.
 */
export function discoverDocFiles(repoRoot: string): DocFile[] {
  const found: DocFile[] = [];

  for (const dir of readdirSync(repoRoot)) {
    const pkgAbsPath = path.join(repoRoot, dir);
    if (!isDirectory(pkgAbsPath)) continue;
    if (dir === "node_modules" || dir.startsWith(".")) continue;

    for (const llmsName of ["llms.txt", "llms-full.txt"]) {
      const llmsPath = path.join(pkgAbsPath, llmsName);
      if (fileExists(llmsPath)) {
        found.push({ absPath: llmsPath, relPath: toPosix(path.relative(repoRoot, llmsPath)) });
      }
    }

    const skillsRoot = path.join(pkgAbsPath, "skills");
    if (!isDirectory(skillsRoot)) continue;
    walkMarkdown(skillsRoot, repoRoot, found);
  }

  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function fileExists(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function walkMarkdown(dir: string, repoRoot: string, into: DocFile[]): void {
  for (const name of readdirSync(dir)) {
    const child = path.join(dir, name);
    if (isDirectory(child)) {
      walkMarkdown(child, repoRoot, into);
    } else if (name.endsWith(".md")) {
      into.push({ absPath: child, relPath: toPosix(path.relative(repoRoot, child)) });
    }
  }
}

/**
 * Pure matcher: scans one file's text for `pnpm <anything>` / `yarn
 * <anything>` invocations, returning file:line violations minus anything on
 * the ALLOWLIST. Exported standalone so unit tests can exercise it directly
 * on in-memory fixtures without touching the filesystem.
 */
export function findViolationsInText(relPath: string, text: string): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split(/\r\n|\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = INVOCATION_RE.exec(line);
    if (!match) continue;

    const lineNumber = i + 1;
    if (isAllowlisted(relPath, line)) continue;

    violations.push({
      relPath,
      line: lineNumber,
      text: line.trim(),
      manager: match[1] as "pnpm" | "yarn",
    });
  }

  return violations;
}

export function findViolationsInFile(file: DocFile): Violation[] {
  const text = readFileSync(file.absPath, "utf8");
  return findViolationsInText(file.relPath, text);
}

export interface GateReport {
  files: DocFile[];
  violations: Violation[];
}

export function runNoPnpmInShippedDocsGate(repoRoot: string): GateReport {
  const files = discoverDocFiles(repoRoot);
  const violations = files.flatMap((file) => findViolationsInFile(file));
  return { files, violations };
}

function formatReport(report: GateReport): { text: string; failed: boolean } {
  const lines: string[] = [];
  lines.push(
    `no-pnpm-in-shipped-docs: scanned ${report.files.length} file(s) (skills/**/*.md, llms.txt, llms-full.txt).`,
  );
  lines.push("");

  if (report.violations.length === 0) {
    lines.push("Clean — no pnpm/yarn invocations found in shipped docs.");
    return { text: lines.join("\n"), failed: false };
  }

  lines.push(`FAILED — ${report.violations.length} pnpm/yarn invocation(s) found in shipped docs:`);
  lines.push("");
  for (const v of report.violations) {
    lines.push(`  ${v.relPath}:${v.line}: [${v.manager}] ${v.text}`);
  }
  lines.push("");
  lines.push(
    "Shipped docs must not assume pnpm. Translate per the four shapes: " +
      "`pnpm warlock <cmd>` / `pnpm cascade <cmd>` -> `npx warlock <cmd>` / `npx cascade <cmd>`; " +
      "`pnpm add <pkg>` -> `npm install <pkg>`; `pnpm install` -> `npm install`; " +
      "`pnpm create warlock` -> `npm create warlock@latest`. " +
      "If a line is a genuine pnpm-workspace-only operation with no npm equivalent, " +
      "add a scoped { relPath, text, reason } entry to ALLOWLIST in this file.",
  );

  return { text: lines.join("\n"), failed: true };
}

async function main(): Promise<number> {
  const report = runNoPnpmInShippedDocsGate(PACKAGES_ROOT);
  const { text, failed } = formatReport(report);
  console.log(text);
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().then((code) => process.exit(code));
}
