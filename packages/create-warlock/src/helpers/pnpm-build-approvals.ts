/**
 * Install scripts the template itself needs, mirrored from the `allowBuilds`
 * map in templates/warlock/pnpm-workspace.yaml (a spec keeps the two equal).
 */
export const BASE_PNPM_BUILD_APPROVALS: readonly string[] = ["esbuild"];

/**
 * Where a pnpm version reads build approvals from, measured by real installs
 * of an esbuild dependency (create-warlock 5.30.0, FW / macOS report):
 *
 * - `packageJson`: pnpm 7–9 and 10.0–10.4. They reject a pnpm-workspace.yaml
 *   without `packages:` ("packages field missing or empty"), and adding
 *   `packages: ["."]` makes every later `pnpm add` fail with
 *   ERR_PNPM_ADDING_TO_ROOT. So the app gets no workspace file and lists the
 *   approvals under `pnpm.onlyBuiltDependencies` in package.json, which these
 *   versions honour.
 * - `onlyBuiltDependencies`: pnpm 10.5–10.25 accept the settings-only file but
 *   ignore `allowBuilds`; they read `onlyBuiltDependencies` from it.
 * - `allowBuilds`: pnpm 10.26 and later, 11 and 12. pnpm 11+ fails the install
 *   (ERR_PNPM_IGNORED_BUILDS) when only `onlyBuiltDependencies` is present.
 *
 * An unknown version gets the current layout, `allowBuilds`.
 */
export type PnpmBuildApprovalLayout =
  "packageJson" | "onlyBuiltDependencies" | "allowBuilds";

export function pnpmBuildApprovalLayout(
  version: string | undefined,
): PnpmBuildApprovalLayout {
  const match = /^(\d+)\.(\d+)\./.exec(version?.trim() ?? "");

  if (!match) return "allowBuilds";

  const major = Number(match[1]);
  const minor = Number(match[2]);

  if (major < 10 || (major === 10 && minor < 5)) return "packageJson";
  if (major === 10 && minor < 26) return "onlyBuiltDependencies";

  return "allowBuilds";
}

/**
 * Add packages to a block-style `onlyBuiltDependencies:` list, creating it when
 * absent. A flow list or an alias is left alone rather than rewritten.
 */
export function mergeOnlyBuiltDependencies(
  yaml: string,
  packages: readonly string[],
): string {
  if (packages.length === 0) return yaml;

  const block = /^onlyBuiltDependencies:\s*(?:#.*)?(?:\r?\n|$)/m.exec(yaml);

  if (!block) {
    if (
      /^(?:onlyBuiltDependencies|"onlyBuiltDependencies"|'onlyBuiltDependencies')\s*:/m.test(
        yaml,
      )
    ) {
      return yaml;
    }

    const items = packages.map(name => `  - ${name}`).join("\n");

    return `${yaml.replace(/\s*$/, "")}\n\n# pnpm 10.5-10.25 read install-script approvals from this list.\nonlyBuiltDependencies:\n${items}\n`;
  }

  const start = block.index + block[0].length;
  const tail = yaml.slice(start);
  const nextTopLevel = /^(?!\s|#|$)[^\r\n]+/m.exec(tail);
  const end = nextTopLevel ? start + nextTopLevel.index : yaml.length;
  const list = yaml.slice(start, end);
  const listed = new Set(
    [...list.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)].map(
      entry => entry[1],
    ),
  );
  const missing = packages.filter(name => !listed.has(name));

  if (missing.length === 0) return yaml;

  const indentation = /^([ \t]*)-/m.exec(list)?.[1] ?? "  ";
  const additions = missing.map(name => `${indentation}- ${name}\n`).join("");

  return `${yaml.slice(0, start)}${additions}${list}${yaml.slice(end)}`;
}

/**
 * Add packages to `pnpm.onlyBuiltDependencies` in a parsed package.json,
 * keeping existing entries and their order.
 */
export function mergePackageJsonBuildApprovals(
  packageJson: Record<string, unknown>,
  packages: readonly string[],
): Record<string, unknown> {
  const pnpm = (packageJson.pnpm ?? {}) as Record<string, unknown>;
  const current = Array.isArray(pnpm.onlyBuiltDependencies)
    ? (pnpm.onlyBuiltDependencies as string[])
    : [];
  const merged = [
    ...current,
    ...packages.filter(name => !current.includes(name)),
  ];

  return { ...packageJson, pnpm: { ...pnpm, onlyBuiltDependencies: merged } };
}

/** Native dependency build scripts required by features the scaffold explicitly selected. */
const FEATURE_BUILD_APPROVALS: Readonly<Record<string, readonly string[]>> = {
  image: ["sharp"],
};

export function requiredPnpmBuildApprovals(
  features: readonly string[],
): readonly string[] {
  return [
    ...new Set(
      features.flatMap(feature => FEATURE_BUILD_APPROVALS[feature] ?? []),
    ),
  ];
}

/**
 * Add only known feature-required builds to the workspace `allowBuilds` policy
 * (pnpm 10.26+, 11, 12).
 * Existing `false` values are user decisions and are never overridden.
 */
export function mergePnpmBuildApprovals(
  yaml: string,
  packages: readonly string[],
): string {
  let result = yaml;
  for (const packageName of packages) {
    result = mergeOneApproval(result, packageName);
  }
  return result;
}

const quotedKey = (name: string) => `(?:${name}|"${name}"|'${name}')`;

/** Edit one ordinary YAML mapping while preserving every untouched byte. */
function mergeOneApproval(yaml: string, packageName: string): string {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = /^allowBuilds:\s*(?:#.*)?(?:\r?\n|$)/m.exec(yaml);

  if (!block) {
    // Flow mappings are deliberately not rewritten. A hand parser must never
    // turn a decided flow entry into a duplicate block key.
    if (/^(?:allowBuilds|"allowBuilds"|'allowBuilds')\s*:/m.test(yaml))
      return yaml;
    return `${yaml.replace(/\s*$/, "")}\nallowBuilds:\n  ${packageName}: true\n`;
  }

  const start = block.index + block[0].length;
  const tail = yaml.slice(start);
  const nextTopLevel = /^(?!\s|#|$)[^\r\n]+/m.exec(tail);
  const end = nextTopLevel ? start + nextTopLevel.index : yaml.length;
  const mapping = yaml.slice(start, end);
  const key = quotedKey(escaped);
  const entry = new RegExp(
    `^(\\s*)${key}\\s*:\\s*([^#\\r\\n]*)(.*)$`,
    "m",
  ).exec(mapping);

  if (entry) {
    const value = entry[2]!.trim();
    if (value === "true" || value === "false") return yaml;
    if (
      !/^(?:set this to true or false|"set this to true or false"|'set this to true or false')$/.test(
        value,
      )
    )
      return yaml;
    // pnpm's undecided placeholder belongs to this generated mapping: decide it
    // in place rather than emitting a duplicate YAML key.
    const comment = entry[3] ?? "";
    const replacement = `${entry[1]}${packageName}: true${comment.startsWith("#") ? " " : ""}${comment}`;
    return `${yaml.slice(0, start)}${mapping.slice(0, entry.index)}${replacement}${mapping.slice(entry.index + entry[0].length)}${yaml.slice(end)}`;
  }

  const indentation = /^([ \t]+)\S/m.exec(mapping)?.[1] ?? "  ";
  return `${yaml.slice(0, start)}${indentation}${packageName}: true\n${mapping}${yaml.slice(end)}`;
}
