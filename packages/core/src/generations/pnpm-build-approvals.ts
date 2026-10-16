import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Where a pnpm version reads install-script approvals from (measured with real
 * installs for create-warlock 5.30.0; the scaffold applies the same rule):
 *
 * - `packageJson`: pnpm 7–9 and 10.0–10.4 reject a `pnpm-workspace.yaml`
 *   without `packages:` ("packages field missing or empty"), and adding
 *   `packages: ["."]` breaks every later `pnpm add` (ERR_PNPM_ADDING_TO_ROOT).
 *   Approvals go under `pnpm.onlyBuiltDependencies` in package.json and no
 *   workspace file is created.
 * - `onlyBuiltDependencies`: pnpm 10.5–10.25 accept a settings-only workspace
 *   file but ignore `allowBuilds`; they read `onlyBuiltDependencies` from it.
 * - `allowBuilds`: pnpm 10.26 and later. An unknown version gets this layout.
 */
export type PnpmBuildApprovalLayout = "packageJson" | "onlyBuiltDependencies" | "allowBuilds";

export function pnpmBuildApprovalLayout(version: string | undefined): PnpmBuildApprovalLayout {
  const match = /^(\d+)\.(\d+)\./.exec(version?.trim() ?? "");

  if (!match) return "allowBuilds";

  const major = Number(match[1]);
  const minor = Number(match[2]);

  if (major < 10 || (major === 10 && minor < 5)) return "packageJson";
  if (major === 10 && minor < 26) return "onlyBuiltDependencies";

  return "allowBuilds";
}

/**
 * The installed pnpm's version, or `undefined` when it cannot be read.
 */
export function getPnpmVersion(cwd: string): string | undefined {
  try {
    return execFileSync("pnpm", ["--version"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
      shell: process.platform === "win32",
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * True when a directory ABOVE `projectRoot` holds a `pnpm-workspace.yaml`: the
 * app is a member of a parent workspace, which owns the build-approval policy.
 */
export function isInsideParentPnpmWorkspace(projectRoot: string): boolean {
  let dir = path.dirname(path.resolve(projectRoot));

  while (true) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return true;

    const parent = path.dirname(dir);

    if (parent === dir) return false;

    dir = parent;
  }
}

/**
 * Add packages to `pnpm.onlyBuiltDependencies` in a parsed package.json,
 * keeping existing entries and their order.
 */
export function mergePackageJsonBuildApprovals<T extends Record<string, unknown>>(
  packageJson: T,
  packages: readonly string[],
): T {
  const pnpm = (packageJson.pnpm ?? {}) as Record<string, unknown>;
  const current = Array.isArray(pnpm.onlyBuiltDependencies)
    ? (pnpm.onlyBuiltDependencies as string[])
    : [];
  const merged = [...current, ...packages.filter((name) => !current.includes(name))];

  return { ...packageJson, pnpm: { ...pnpm, onlyBuiltDependencies: merged } };
}

/**
 * Add packages to a block-style `onlyBuiltDependencies:` list in a workspace
 * file, creating the list when absent. A flow list or an alias is left alone.
 */
export function mergeOnlyBuiltDependencies(yaml: string, packages: readonly string[]): string {
  if (packages.length === 0) return yaml;

  const block = /^onlyBuiltDependencies:\s*(?:#.*)?(?:\r?\n|$)/m.exec(yaml);

  if (!block) {
    if (
      /^(?:onlyBuiltDependencies|"onlyBuiltDependencies"|'onlyBuiltDependencies')\s*:/m.test(yaml)
    ) {
      return yaml;
    }

    const items = packages.map((name) => `  - ${name}`).join("\n");

    return `${yaml.replace(/\s*$/, "")}\n\n# pnpm 10.5-10.25 read install-script approvals from this list.\nonlyBuiltDependencies:\n${items}\n`;
  }

  const start = block.index + block[0].length;
  const tail = yaml.slice(start);
  const nextTopLevel = /^(?!\s|#|$)[^\r\n]+/m.exec(tail);
  const end = nextTopLevel ? start + nextTopLevel.index : yaml.length;
  const list = yaml.slice(start, end);
  const listed = new Set(
    [...list.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)].map((entry) => entry[1]),
  );
  const missing = packages.filter((name) => !listed.has(name));

  if (missing.length === 0) return yaml;

  const indentation = /^([ \t]*)-/m.exec(list)?.[1] ?? "  ";
  const additions = missing.map((name) => `${indentation}- ${name}\n`).join("");

  return `${yaml.slice(0, start)}${additions}${list}${yaml.slice(end)}`;
}

/** Add sharp to the workspace `allowBuilds` policy (pnpm 10.26+, 11, 12). */
export function mergePnpmSharpApproval(yaml: string): string {
  const block = /^allowBuilds:\s*(?:#.*)?(?:\r?\n|$)/m.exec(yaml);
  if (!block) {
    // Do not hand-edit flow YAML: preserving an existing decision is safer
    // than risking duplicate keys or discarded comments.
    if (/^(?:allowBuilds|"allowBuilds"|'allowBuilds')\s*:/m.test(yaml)) return yaml;
    return `${yaml.replace(/\s*$/, "")}\nallowBuilds:\n  sharp: true\n`;
  }

  const start = block.index + block[0].length;
  const tail = yaml.slice(start);
  const nextTopLevel = /^(?!\s|#|$)[^\r\n]+/m.exec(tail);
  const end = nextTopLevel ? start + nextTopLevel.index : yaml.length;
  const mapping = yaml.slice(start, end);
  const entry = /^(\s*)(?:sharp|"sharp"|'sharp')\s*:\s*([^#\r\n]*)(.*)$/m.exec(mapping);
  if (entry) {
    const value = entry[2]!.trim();
    if (value === "true" || value === "false") return yaml;
    if (
      !/^(?:set this to true or false|"set this to true or false"|'set this to true or false')$/.test(
        value,
      )
    )
      return yaml;
    const comment = entry[3] ?? "";
    const replacement = `${entry[1]}sharp: true${comment.startsWith("#") ? " " : ""}${comment}`;
    return `${yaml.slice(0, start)}${mapping.slice(0, entry.index)}${replacement}${mapping.slice(entry.index + entry[0].length)}${yaml.slice(end)}`;
  }
  const indentation = /^([ \t]+)\S/m.exec(mapping)?.[1] ?? "  ";
  return `${yaml.slice(0, start)}${indentation}sharp: true\n${mapping}${yaml.slice(end)}`;
}
