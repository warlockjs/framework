// @ts-check
/**
 * Generate the unified Warlock.js changelog from each package's CHANGELOG.md
 * plus the release-level metadata in src/data/releases.json.
 *
 * Sources:
 *   - <pkg>/CHANGELOG.md   → the typed CHANGES (### Added/Changed/Fixed/...).
 *   - src/data/releases.json → the release DATE + "what shipped" SUMMARY.
 *
 * Output (src/data/changelog.json) is grouped FOR A UNIFIED MONOREPO RELEASE:
 * each release lists its changes by TYPE (Added, Changed, Fixed, Deprecated,
 * Removed), and every line records which package it belongs to — so a reader
 * scans "what was Added across the whole release", with the package on each
 * line. A release with no typed changes (the baseline) lists its packages as
 * chips instead.
 *
 * Run via `yarn sync:changelog` (also on predev/prebuild). Commit the JSON.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(here, "..");
const WORKSPACE_ROOT = resolve(DOCS_ROOT, "..");
const PNPM_WORKSPACE = resolve(WORKSPACE_ROOT, "pnpm-workspace.yaml");
const RELEASES_META = resolve(DOCS_ROOT, "src/data/releases.json");
const OUT_DIR = resolve(DOCS_ROOT, "src/data");
const OUT_FILE = resolve(OUT_DIR, "changelog.json");

// `## [Unreleased]` blocks are staged in each package but kept off the site.
const SHOW_UNRELEASED = false;

// Section order on the page (Keep-a-Changelog, the order requested).
// `⚠ BREAKING` is surfaced first when a package's CHANGELOG flags a
// breaking change with that heading, so the most consequential change
// in a release reads at the top of the package block.
const TYPE_ORDER = [
  "⚠ BREAKING",
  "New",
  "Added",
  "Changed",
  "Fixed",
  "Deprecated",
  "Removed",
  "Security",
  "Dependencies",
];

function slugOf(name) {
  const i = name.lastIndexOf("/");
  return i === -1 ? name : name.slice(i + 1);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Minimal, controlled inline-markdown → HTML (inline code, links, bold). */
function renderInline(md) {
  let s = escapeHtml(md.trim());
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => `<a href="${url}">${text}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, b) => `<strong>${b}</strong>`);
  return s;
}

function parseVersionHeading(raw) {
  let text = raw.trim();
  let version = text;
  let date = null;
  const m = text.match(/^(.*?)\s+(?:—|–|-)\s+(.+)$/);
  if (m) {
    version = m[1].trim();
    date = m[2].trim();
  }
  version = version.replace(/^\[(.+)\]$/, "$1").trim();
  return { version, date };
}

/** Parse one CHANGELOG.md into ordered version blocks. */
function parseChangelog(md) {
  const lines = md.split(/\r?\n/);
  const versions = [];
  let cur = null;
  let curCat = null;
  let inItem = false;

  for (const line of lines) {
    const vMatch = line.match(/^##\s+(.+?)\s*$/);
    if (vMatch && !line.startsWith("###")) {
      const { version, date } = parseVersionHeading(vMatch[1]);
      cur = { version, date, categories: [] };
      versions.push(cur);
      curCat = null;
      inItem = false;
      continue;
    }
    if (!cur) continue;

    const cMatch = line.match(/^###\s+(.+?)\s*$/);
    if (cMatch) {
      curCat = { title: cMatch[1].trim(), items: [] };
      cur.categories.push(curCat);
      inItem = false;
      continue;
    }

    const bMatch = line.match(/^[-*]\s+(.+)$/);
    if (bMatch) {
      if (!curCat) {
        curCat = { title: null, items: [] };
        cur.categories.push(curCat);
      }
      curCat.items.push(bMatch[1].trim());
      inItem = true;
      continue;
    }

    if (!line.trim()) {
      inItem = false;
      continue;
    }
    if (inItem && curCat && curCat.items.length) {
      curCat.items[curCat.items.length - 1] += " " + line.trim();
    }
  }

  return versions;
}

// Full SemVer 2.0.0 grammar (https://semver.org/#backusnaur-form-grammar-for-valid-semver-versions).
// Numeric core identifiers must not carry leading zeros; prerelease identifiers
// follow the same rule when purely numeric, but may otherwise be alphanumeric.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Parse a SemVer string, throwing a clear error on anything malformed. */
function parseSemver(version) {
  const m = typeof version === "string" ? SEMVER_RE.exec(version) : null;
  if (!m) {
    throw new Error(`Invalid SemVer version: ${JSON.stringify(version)}`);
  }
  const [, major, minor, patch, prerelease] = m;
  return { major, minor, patch, prerelease };
}

// Compare two numeric-core identifiers (decimal strings with no leading
// zeros) without ever widening them to `Number`, so arbitrarily large core
// numbers can't lose precision: same-length decimal strings compare in the
// same order numerically as they do lexically, so length is the only thing
// that has to be checked first.
function compareNumericCore(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isNumericIdentifier(id) {
  return /^\d+$/.test(id);
}

// Per the SemVer spec: numeric identifiers compare numerically; identifiers
// with letters/hyphens compare by ASCII order; numeric identifiers always
// sort below alphanumeric ones.
function compareIdentifier(x, y) {
  const xNum = isNumericIdentifier(x);
  const yNum = isNumericIdentifier(y);
  if (xNum && yNum) return compareNumericCore(x, y);
  if (xNum !== yNum) return xNum ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

// A release outranks its own prerelease; when both have a prerelease, compare
// dot-separated identifiers left to right, and a shorter equal-prefix loses.
function comparePrerelease(a, b) {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;

  const ai = a.split(".");
  const bi = b.split(".");
  const len = Math.min(ai.length, bi.length);
  for (let i = 0; i < len; i++) {
    const c = compareIdentifier(ai[i], bi[i]);
    if (c !== 0) return c;
  }
  return ai.length - bi.length;
}

/** Ascending SemVer 2.0.0 precedence comparator; build metadata is ignored. */
export function compareSemverAsc(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return (
    compareNumericCore(pa.major, pb.major) ||
    compareNumericCore(pa.minor, pb.minor) ||
    compareNumericCore(pa.patch, pb.patch) ||
    comparePrerelease(pa.prerelease, pb.prerelease)
  );
}

export function cmpVersionDesc(a, b) {
  return -compareSemverAsc(a, b);
}

const releaseDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatPublishedAt(publishedAt) {
  if (typeof publishedAt !== "string" || !publishedAt.trim()) return null;
  const date = new Date(publishedAt);
  return Number.isNaN(date.getTime()) ? null : releaseDateFormatter.format(date);
}

function versionId(v) {
  if (/unreleased/i.test(v)) return "unreleased";
  return "v" + v.replace(/[^\w.]/g, "").replace(/\./g, "-");
}

async function loadReleaseMeta() {
  if (!existsSync(RELEASES_META)) return {};
  try {
    const raw = JSON.parse(await readFile(RELEASES_META, "utf8"));
    const out = {};
    for (const [version, meta] of Object.entries(raw)) {
      if (!version.startsWith("_")) out[version] = meta;
    }
    return out;
  } catch (err) {
    console.warn("releases.json could not be parsed — continuing without it:", err.message);
    return {};
  }
}

async function loadWorkspaceEntries(rootPkg) {
  const packageJsonEntries = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : rootPkg.workspaces?.packages;
  if (Array.isArray(packageJsonEntries)) return packageJsonEntries;
  if (!existsSync(PNPM_WORKSPACE)) return [];

  const yaml = await readFile(PNPM_WORKSPACE, "utf8");
  const entries = [];
  let inPackages = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s+-\s+(.+?)\s*$/);
    if (!match) continue;
    entries.push(match[1].replace(/^(['"])(.*)\1$/, "$2"));
  }
  return entries;
}

async function main() {
  // In a docs-only checkout (e.g. the GitHub Pages CI build) the sibling
  // packages + the workspace package.json aren't present. Skip regeneration
  // and keep the committed changelog.json — it's generated locally where the
  // packages exist, then committed (same pattern as the site llms.txt files).
  const rootPkgPath = resolve(WORKSPACE_ROOT, "package.json");
  if (!existsSync(rootPkgPath)) {
    console.log(
      `changelog: workspace package.json not found (${rootPkgPath}) — keeping the ` +
        `committed changelog.json (docs-only checkout).`,
    );
    return;
  }

  const rootPkg = JSON.parse(await readFile(rootPkgPath, "utf8"));
  const entries = await loadWorkspaceEntries(rootPkg);
  const meta = await loadReleaseMeta();

  // version -> { date, typed: Map<type, [{package,slug,html}]>, present: [{name,slug}] }
  const byVersion = new Map();
  const seenPackages = new Map();
  const scanned = [];

  // Each version bucket groups changes BY PACKAGE: pkgs is a Map<slug, {name,
  // slug, byType: Map<type, html[]>}>. order preserves first-seen package order
  // for stable output.
  const bucketFor = (version) => {
    if (!byVersion.has(version)) {
      byVersion.set(version, { date: null, pkgs: new Map(), present: [] });
    }
    return byVersion.get(version);
  };

  for (const entry of entries) {
    const dir = resolve(WORKSPACE_ROOT, entry);
    const pkgPath = resolve(dir, "package.json");
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    if (pkg.private || !pkg.name) continue;

    const clPath = resolve(dir, "CHANGELOG.md");
    if (!existsSync(clPath)) continue;
    scanned.push(pkg.name);

    const md = await readFile(clPath, "utf8");
    const slug = slugOf(pkg.name);

    for (const v of parseChangelog(md)) {
      if (!SHOW_UNRELEASED && /unreleased/i.test(v.version)) continue;

      const hasItems = v.categories.some((c) => c.items.length);
      if (!hasItems && !meta[v.version]) continue;

      const bucket = bucketFor(v.version);
      if (!bucket.date && v.date) bucket.date = v.date;
      bucket.present.push({ name: pkg.name, slug });
      seenPackages.set(slug, pkg.name);

      // Fold this package's typed changes under the package (then by type).
      for (const cat of v.categories) {
        if (!cat.title || !cat.items.length) continue; // skip loose/empty
        if (!bucket.pkgs.has(slug)) {
          bucket.pkgs.set(slug, { name: pkg.name, slug, byType: new Map() });
        }
        const byType = bucket.pkgs.get(slug).byType;
        if (!byType.has(cat.title)) byType.set(cat.title, []);
        const arr = byType.get(cat.title);
        for (const item of cat.items) arr.push(renderInline(item));
      }
    }
  }

  // Versions that only exist in releases.json (e.g. a notes-only release).
  for (const version of Object.keys(meta)) {
    if (!SHOW_UNRELEASED && /unreleased/i.test(version)) continue;
    bucketFor(version);
  }

  // Package changelogs may already stage the next release. releases.json is
  // the site's publication boundary: keep older package-only history, but do
  // not surface anything newer than its newest authored release entry.
  const latestPublishedVersion = Object.keys(meta)
    .filter((v) => !/unreleased/i.test(v))
    .sort(cmpVersionDesc)[0];

  const versionKeys = [...byVersion.keys()]
    .filter((v) => SHOW_UNRELEASED || !/unreleased/i.test(v))
    .filter((v) => !latestPublishedVersion || cmpVersionDesc(v, latestPublishedVersion) >= 0)
    .sort(cmpVersionDesc);

  const shownSlugs = new Set();

  const releases = versionKeys.map((version) => {
    const bucket = byVersion.get(version);
    const m = meta[version] || {};
    const date = formatPublishedAt(m.publishedAt) || m.date || bucket.date || null;
    const summaryHtml = m.summary ? renderInline(m.summary) : null;

    // Group BY PACKAGE: one block per package, with per-type counts + a
    // type-tagged item list (ordered by TYPE_ORDER within the package).
    const pkgBlocks = [...bucket.pkgs.values()].map((p) => {
      const counts = [];
      const items = [];
      for (const type of TYPE_ORDER) {
        const arr = p.byType.get(type);
        if (!arr || !arr.length) continue;
        counts.push({ type, n: arr.length });
        for (const html of arr) items.push({ type, html });
      }
      shownSlugs.add(p.slug);
      return { name: p.name, slug: p.slug, total: items.length, counts, items };
    });

    // Featured packages (per-release `featured` in releases.json) float to the
    // top in the listed order; the rest follow most-changed-first, then alpha.
    const featured = Array.isArray(m.featured) ? m.featured : [];
    const featuredRank = (name) => {
      const i = featured.indexOf(name);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    pkgBlocks.sort(
      (a, b) =>
        featuredRank(a.name) - featuredRank(b.name) ||
        b.total - a.total ||
        a.name.localeCompare(b.name),
    );

    const mode = pkgBlocks.length ? "detail" : "notes";

    return {
      version: /unreleased/i.test(version) ? "Unreleased" : version,
      id: versionId(version),
      date,
      isUnreleased: /unreleased/i.test(version),
      summaryHtml,
      mode,
      packages: pkgBlocks,
    };
  });

  const packages = [...seenPackages.entries()]
    .filter(([slug]) => shownSlugs.has(slug))
    .map(([slug, name]) => ({ name, slug }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    _generated:
      "GENERATED by scripts/generate-changelog.mjs from each package's CHANGELOG.md + src/data/releases.json. Do not edit by hand — run `yarn sync:changelog`.",
    packages,
    releases,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(
    `changelog: scanned ${scanned.length} package(s), ${releases.length} release(s) ` +
      `[${releases.map((r) => `${r.version}:${r.mode}`).join(", ")}], unreleased ${SHOW_UNRELEASED ? "shown" : "hidden"}`,
  );
}

// Guard so `import` (e.g. from the test file) never triggers a full run —
// only executing this file directly (`node scripts/generate-changelog.mjs`) does.
const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((err) => {
    console.error("generate-changelog failed:", err);
    process.exit(1);
  });
}
