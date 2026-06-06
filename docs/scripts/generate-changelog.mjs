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
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(here, "..");
const WORKSPACE_ROOT = resolve(DOCS_ROOT, "..");
const RELEASES_META = resolve(DOCS_ROOT, "src/data/releases.json");
const OUT_DIR = resolve(DOCS_ROOT, "src/data");
const OUT_FILE = resolve(OUT_DIR, "changelog.json");

// `## [Unreleased]` blocks are staged in each package but kept off the site.
const SHOW_UNRELEASED = false;

// Section order on the page (Keep-a-Changelog, the order requested).
const TYPE_ORDER = ["Added", "Changed", "Fixed", "Deprecated", "Removed", "Security"];

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

function cmpVersionDesc(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
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

async function main() {
  const rootPkg = JSON.parse(await readFile(resolve(WORKSPACE_ROOT, "package.json"), "utf8"));
  const entries = rootPkg.workspaces || [];
  const meta = await loadReleaseMeta();

  // version -> { date, typed: Map<type, [{package,slug,html}]>, present: [{name,slug}] }
  const byVersion = new Map();
  const seenPackages = new Map();
  const scanned = [];

  const bucketFor = (version) => {
    if (!byVersion.has(version)) {
      byVersion.set(version, { date: null, typed: new Map(), present: [] });
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

      // Fold this package's typed changes into the release's type buckets.
      for (const cat of v.categories) {
        if (!cat.title || !cat.items.length) continue; // skip loose/empty
        if (!bucket.typed.has(cat.title)) bucket.typed.set(cat.title, []);
        const arr = bucket.typed.get(cat.title);
        for (const item of cat.items) {
          arr.push({ package: pkg.name, slug, html: renderInline(item) });
        }
      }
    }
  }

  // Versions that only exist in releases.json (e.g. a notes-only release).
  for (const version of Object.keys(meta)) {
    if (!SHOW_UNRELEASED && /unreleased/i.test(version)) continue;
    bucketFor(version);
  }

  const versionKeys = [...byVersion.keys()]
    .filter((v) => SHOW_UNRELEASED || !/unreleased/i.test(v))
    .sort(cmpVersionDesc);

  const shownSlugs = new Set();

  const releases = versionKeys.map((version) => {
    const bucket = byVersion.get(version);
    const m = meta[version] || {};
    const date = m.date || bucket.date || null;
    const summaryHtml = m.summary ? renderInline(m.summary) : null;

    const sections = TYPE_ORDER.filter((t) => bucket.typed.has(t)).map((type) => {
      const items = bucket.typed
        .get(type)
        .slice()
        .sort((a, b) => a.package.localeCompare(b.package));
      items.forEach((it) => shownSlugs.add(it.slug));
      return { type, items };
    });

    const mode = sections.length ? "detail" : "compact";

    // Compact (no typed changes): list the packages the release covers as chips.
    const seen = new Set();
    const chips = [];
    if (mode === "compact") {
      for (const p of bucket.present) {
        if (seen.has(p.slug)) continue;
        seen.add(p.slug);
        shownSlugs.add(p.slug);
        chips.push(p);
      }
    }

    return {
      version: /unreleased/i.test(version) ? "Unreleased" : version,
      id: versionId(version),
      date,
      isUnreleased: /unreleased/i.test(version),
      summaryHtml,
      mode,
      sections,
      chips,
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

main().catch((err) => {
  console.error("generate-changelog failed:", err);
  process.exit(1);
});
