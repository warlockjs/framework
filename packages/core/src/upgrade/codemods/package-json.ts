import type { Codemod, CodemodOutput } from "../types";
import { compareVersions, parseVersion } from "../version";

const NODE_MINIMUM = "22.15.0";

type PackageJson = {
  engines?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

/** Keep the file's indentation and trailing newline when rewriting JSON. */
function serialize(original: string, value: unknown): string {
  const indent = /^[ \t]+(?=")/m.exec(original)?.[0];
  // A one-line (minified) manifest stays on one line.
  const json = indent ? JSON.stringify(value, null, indent) : JSON.stringify(value);
  return json + (original.endsWith("\n") ? "\n" : "");
}

function lineOf(source: string, needle: string): number {
  const index = source.indexOf(needle);
  return index < 0 ? 1 : source.slice(0, index).split("\n").length;
}

/**
 * 5.31: the CLI needs Node.js 22.15 or newer. Raises `engines.node` in
 * package.json and the version in `.nvmrc` / `.node-version` when they allow
 * an older Node.
 */
export const node2215: Codemod = {
  id: "node-22-15",
  version: "5.31.0",
  package: "@warlock.js/core",
  title: "Require Node.js 22.15 or newer",
  skill: "run-app",
  run(context) {
    const output: CodemodOutput = { edits: [], manual: [] };

    const source = context.text.read("package.json");
    if (source !== undefined) {
      const pkg = JSON.parse(source) as PackageJson;
      const current = pkg.engines?.node;
      if (typeof current === "string") {
        const minimum = parseVersion(current);
        if (minimum && compareVersions(minimum.join("."), NODE_MINIMUM) < 0) {
          const line = lineOf(source, '"node"');
          pkg.engines = { ...pkg.engines, node: ">=22.15" };
          context.text.write("package.json", serialize(source, pkg), {
            line,
            description: `engines.node "${current}" → ">=22.15"`,
          });
        }
      }
    }

    for (const file of [".nvmrc", ".node-version"]) {
      const content = context.text.read(file);
      if (content === undefined) continue;
      const value = content.trim();
      const parsed = /^v?\d/.test(value) ? parseVersion(value) : undefined;
      if (!parsed) {
        if (value !== "" && !/^lts\/|^node$|^latest$/i.test(value)) {
          output.manual.push({
            file,
            line: 1,
            hint: `Make sure "${value}" resolves to Node.js 22.15 or newer.`,
          });
        }
        continue;
      }
      if (compareVersions(parsed.join("."), NODE_MINIMUM) >= 0) continue;
      const next = `${value.startsWith("v") ? "v" : ""}22.15.0`;
      context.text.write(file, `${next}\n`, { line: 1, description: `Node ${value} → ${next}` });
    }

    return output;
  },
};

/** Version specs that are not a plain range and must not be rewritten. */
const NON_REGISTRY_SPEC =
  /^(workspace:|file:|link:|portal:|git|github:|https?:|npm:)|^\*$|^latest$/;

/**
 * Every upgrade: set each `@warlock.js/*` (and `create-warlock`) dependency to
 * the target version, keeping its `^`/`~`/exact style. The family is
 * released in lockstep, so mixed versions are not supported.
 */
export const warlockVersions: Codemod = {
  id: "warlock-versions",
  version: "target",
  package: "@warlock.js/core",
  title: "Move the @warlock.js packages to the target version",
  skill: "update-packages",
  run(context) {
    const output: CodemodOutput = { edits: [], manual: [] };
    const source = context.text.read("package.json");
    if (source === undefined) return output;

    const pkg = JSON.parse(source) as PackageJson;
    const changes: { name: string; from: string; to: string }[] = [];
    const skipped: { name: string; spec: string }[] = [];

    for (const field of ["dependencies", "devDependencies"] as const) {
      const dependencies = pkg[field];
      if (!dependencies) continue;
      for (const [name, spec] of Object.entries(dependencies)) {
        if (!name.startsWith("@warlock.js/") && name !== "create-warlock") continue;
        if (typeof spec !== "string" || NON_REGISTRY_SPEC.test(spec)) continue;
        const declared = parseVersion(spec);
        // Never move a package down: one already past the target stays where it is.
        if (declared && compareVersions(declared.join("."), context.targetVersion) > 0) {
          skipped.push({ name, spec });
          continue;
        }
        const prefix = /^[\^~]/.exec(spec)?.[0] ?? (/^\d/.test(spec) ? "" : "^");
        const next = `${prefix}${context.targetVersion}`;
        if (next === spec) continue;
        dependencies[name] = next;
        changes.push({ name, from: spec, to: next });
      }
    }

    const firstSkipped = skipped[0];
    if (firstSkipped) {
      output.manual.push({
        file: "package.json",
        line: lineOf(source, `"${firstSkipped.name}"`),
        hint: `Left unchanged because it is already newer than ${context.targetVersion}: ${skipped
          .map((item) => `${item.name} ${item.spec}`)
          .join(
            ", ",
          )}. Packages are never moved down; run \`warlock update\` to bring the rest of the family up to the same version.`,
      });
    }

    if (changes.length === 0) return output;

    const first = changes[0];
    context.text.write("package.json", serialize(source, pkg), {
      line: first ? lineOf(source, `"${first.name}"`) : 1,
      description: changes
        .map((change) => `${change.name} ${change.from} → ${change.to}`)
        .join(", "),
    });

    return output;
  },
};
