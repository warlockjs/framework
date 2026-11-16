/**
 * Advisory gate.
 *
 * Fails the release when the range a published package declares for a direct
 * dependency (dependencies, peerDependencies, optionalDependencies) can only
 * resolve to versions that carry a known security advisory, that is, the range
 * excludes every patched version. The highest version the range admits is
 * checked against the npm advisory database; a range that still admits a patched
 * version passes, because an install can pick it.
 *
 * Network access is required. A lookup that fails is a failure of the gate, not
 * a pass. A reviewed advisory is waived in `advisory-allowances.jsonc`
 * (`{ "<advisory url>": "<reason>" }`).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import semver from "semver";

import { readJsonc } from "./read-jsonc.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const REGISTRY = "https://registry.npmjs.org";
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

export interface DependencyDeclaration {
  /** Package that declares the range. */
  declaredBy: string;
  name: string;
  range: string;
}

export interface Advisory {
  id: number;
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
}

export interface AdvisoryFinding extends DependencyDeclaration {
  /** Highest version the declared range admits. */
  version: string;
  advisories: readonly Advisory[];
}

export interface AdvisoryGateDependencies {
  /** Every published version of `name`. */
  listVersions(name: string): Promise<readonly string[]>;
  /** Advisories that affect each `name@version` (empty when none). */
  fetchAdvisories(query: Record<string, string[]>): Promise<Record<string, readonly Advisory[]>>;
}

type Manifest = {
  name?: string;
  private?: boolean;
} & Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>;

/** Ranges that are not registry ranges (workspace links, urls, tags) cannot be checked here. */
function isCheckableRange(range: string): boolean {
  return semver.validRange(range) !== null && !range.includes(":");
}

/** The direct, non-family dependency ranges every manifest declares. */
export function collectDeclarations(manifests: readonly Manifest[]): DependencyDeclaration[] {
  const found: DependencyDeclaration[] = [];
  for (const manifest of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (name.startsWith("@warlock.js/") || name === "create-warlock") continue;
        if (!isCheckableRange(range)) continue;
        found.push({ declaredBy: manifest.name ?? "(unnamed)", name, range });
      }
    }
  }
  return found;
}

/** Declarations whose highest admitted version carries an advisory that is not waived. */
export async function findExcludedPatchedRanges(
  declarations: readonly DependencyDeclaration[],
  dependencies: AdvisoryGateDependencies,
  waived: ReadonlySet<string> = new Set(),
): Promise<AdvisoryFinding[]> {
  const versionsByName = new Map<string, readonly string[]>();
  const resolved: Array<DependencyDeclaration & { version: string }> = [];

  for (const declaration of declarations) {
    let versions = versionsByName.get(declaration.name);
    if (!versions) {
      versions = await dependencies.listVersions(declaration.name);
      versionsByName.set(declaration.name, versions);
    }
    const version = semver.maxSatisfying(versions as string[], declaration.range);
    if (version) resolved.push({ ...declaration, version });
  }

  const query: Record<string, string[]> = {};
  for (const { name, version } of resolved) {
    const list = (query[name] ??= []);
    if (!list.includes(version)) list.push(version);
  }
  if (Object.keys(query).length === 0) return [];

  const advisories = await dependencies.fetchAdvisories(query);
  const findings: AdvisoryFinding[] = [];
  for (const entry of resolved) {
    const affecting = (advisories[entry.name] ?? []).filter(
      (advisory) =>
        !waived.has(advisory.url) &&
        semver.satisfies(entry.version, advisory.vulnerable_versions, {
          includePrerelease: true,
        }),
    );
    if (affecting.length > 0) findings.push({ ...entry, advisories: affecting });
  }
  return findings;
}

export function formatFindings(findings: readonly AdvisoryFinding[]): string {
  return findings
    .map((finding) =>
      [
        `${finding.declaredBy} declares ${finding.name}@${finding.range}; its highest version ` +
          `${finding.version} is affected, so the range excludes every patched version:`,
        ...finding.advisories.map(
          (advisory) => `  - [${advisory.severity}] ${advisory.title} ${advisory.url}`,
        ),
      ].join("\n"),
    )
    .join("\n");
}

const registryDependencies: AdvisoryGateDependencies = {
  async listVersions(name) {
    const response = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!response.ok) throw new Error(`npm registry answered ${response.status} for ${name}.`);
    const body = (await response.json()) as { versions?: Record<string, unknown> };
    return Object.keys(body.versions ?? {});
  },
  async fetchAdvisories(query) {
    const response = await fetch(`${REGISTRY}/-/npm/v1/security/advisories/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
    });
    if (!response.ok) throw new Error(`npm advisory lookup answered ${response.status}.`);
    return (await response.json()) as Record<string, Advisory[]>;
  },
};

function readPublishedManifests(repoRoot: string): Manifest[] {
  const packagesDirectory = path.join(repoRoot, "packages");
  const manifests: Manifest[] = [];
  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    const file = path.join(packagesDirectory, entry.name, "package.json");
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
    if (!manifest.private) manifests.push(manifest);
  }
  return manifests;
}

function readWaivers(file: string): Set<string> {
  if (!existsSync(file)) return new Set();
  const parsed = readJsonc(readFileSync(file, "utf8"));
  if (parsed.error || !parsed.config) throw new Error(`${file} is not valid JSONC.`);
  return new Set(Object.keys(parsed.config));
}

async function main(): Promise<void> {
  const declarations = collectDeclarations(readPublishedManifests(REPO_ROOT));
  const waived = readWaivers(path.join(import.meta.dirname, "advisory-allowances.jsonc"));
  const findings = await findExcludedPatchedRanges(declarations, registryDependencies, waived);
  if (findings.length > 0) {
    console.error(`${formatFindings(findings)}\n`);
    throw new Error(
      `${findings.length} declared dependency range(s) exclude the patched versions of a known advisory.`,
    );
  }
  console.log(`Advisory gate passed (${declarations.length} declared dependency ranges checked).`);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
