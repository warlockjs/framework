#!/usr/bin/env node
/**
 * Imports package docs from `domains/<pkg>/docs/{getting-started,essentials,guides,recipes,reference}/*.md*`
 * into Starlight's content tree at `src/content/docs/v/latest/<pkg>/`.
 *
 * Transforms applied per file:
 * - Extracts the body's first `# H1` heading into the `title:` frontmatter
 *   field (Starlight requires `title`).
 * - Strips the body's H1 so the page title doesn't render twice.
 * - Renames Docusaurus-style `sidebar_position` → `sidebar.order` and
 *   `sidebar_label` → `sidebar.label` (Starlight's shape).
 * - Strips `slug:` from existing frontmatter — Starlight infers slugs from
 *   the file path; leftover Docusaurus slugs cause routing collisions.
 * - Neutralizes cross-package skill links (`@warlock.js/<pkg>/skills/...`)
 *   into plain inline code so the build doesn't break on dead targets.
 *
 * Skips files whose name starts with `_` (Docusaurus category metadata or
 * partials).
 *
 * Idempotent — re-running overwrites the destination files.
 *
 * Usage (from `@warlock.js/docs/`):
 *   node scripts/import-package-docs.mjs <pkg-slug>
 *   e.g.  node scripts/import-package-docs.mjs cascade
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(DOCS_ROOT, "..", "..");

// Sections used to be hardcoded to the five Diátaxis names. Now we
// auto-discover any directory under `domains/<pkg>/docs/` so packages
// can choose their own structure (Diátaxis or Laravel-style domains
// per the blueprint).

const pkg = process.argv[2];
if (!pkg) {
  console.error("Usage: node scripts/import-package-docs.mjs <pkg-slug>");
  process.exit(1);
}

const SOURCE_ROOT = path.join(PROJECT_ROOT, "domains", pkg, "docs");
const DEST_ROOT = path.join(
  DOCS_ROOT,
  "src",
  "content",
  "docs",
  "v",
  "latest",
  pkg,
);

function yamlEscape(value) {
  const v = value.replace(/^["'](.*)["']$/, "$1").trim();
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function transform(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!fmMatch) {
    const h1 = content.match(/^# (.+)$/m);
    const title = h1 ? h1[1] : "Untitled";
    const body = h1 ? content.replace(/^# .+\r?\n+/, "") : content;
    return `---\ntitle: ${yamlEscape(title)}\n---\n${body.trimStart()}`;
  }

  let fm = fmMatch[1];
  let body = fmMatch[2];

  const h1Match = body.match(/^# (.+)$/m);
  const title = h1Match ? h1Match[1] : "Untitled";
  if (h1Match) {
    body = body.replace(/^# .+\r?\n+/m, "");
  }

  // Convert Docusaurus theme imports to Starlight equivalents.
  body = body.replace(
    /^import\s+Tabs\s+from\s+["']@theme\/Tabs["'];?[ \t]*\r?\n/m,
    "",
  );
  body = body.replace(
    /^import\s+TabItem\s+from\s+["']@theme\/TabItem["'];?[ \t]*\r?\n/m,
    'import { Tabs, TabItem } from "@astrojs/starlight/components";\n',
  );
  // If only Tabs was imported (some files), still inject the Starlight import.
  if (/<\s*Tabs[\s>]/.test(body) && !/from\s+["']@astrojs\/starlight\/components["']/.test(body)) {
    body = `import { Tabs, TabItem } from "@astrojs/starlight/components";\n\n${body}`;
  }
  // Strip `value=".."` from `<TabItem ...>` — Docusaurus needs it; Starlight doesn't.
  body = body.replace(/<TabItem\s+value="[^"]*"\s+/g, "<TabItem ");

  const posMatch = fm.match(/^sidebar_position:\s*(\S+)\s*$/m);
  const labMatch = fm.match(/^sidebar_label:\s*(.+)$/m);
  fm = fm.replace(/^sidebar_position:.*\r?\n?/m, "");
  fm = fm.replace(/^sidebar_label:.*\r?\n?/m, "");
  fm = fm.replace(/^slug:.*\r?\n?/m, "");
  fm = fm.replace(/^\s*$/gm, "").trim();

  const lines = [`title: ${yamlEscape(title)}`];
  if (fm) lines.push(fm);
  if (posMatch || labMatch) {
    lines.push("sidebar:");
    if (posMatch) lines.push(`  order: ${posMatch[1]}`);
    if (labMatch) lines.push(`  label: ${yamlEscape(labMatch[1].trim())}`);
  }

  body = body.replace(
    /\[([^\]]+)\]\(([^)]*@warlock\.js\/[^)]+)\)/g,
    (_match, text) => {
      const clean = text.replace(/^`(.*)`$/, "$1");
      return `\`${clean}\``;
    },
  );

  // Strip Docusaurus heading-ID syntax (`## Heading {#anchor}`).
  body = body.replace(/^(#{1,6}\s+.+?)\s*\{#[a-z0-9-]+\}\s*$/gm, "$1");

  return `---\n${lines.join("\n")}\n---\n\n${body.trimStart()}`;
}

async function copySection(section) {
  const srcDir = path.join(SOURCE_ROOT, section);
  const destDir = path.join(DEST_ROOT, section);

  try {
    await fs.access(srcDir);
  } catch {
    return 0;
  }

  await fs.mkdir(destDir, { recursive: true });

  const files = await fs.readdir(srcDir);
  let count = 0;
  for (const file of files) {
    if (file.startsWith("_")) continue;
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;

    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);

    const raw = await fs.readFile(srcPath, "utf8");
    const transformed = transform(raw);

    await fs.writeFile(destPath, transformed);
    count++;
  }
  return count;
}

console.log(`Importing ${pkg} docs from ${SOURCE_ROOT}`);
console.log(`                  to ${DEST_ROOT}`);
console.log();

// Auto-discover every direct subdirectory of source — each is treated
// as a sidebar section.
const entries = await fs.readdir(SOURCE_ROOT, { withFileTypes: true });
const sections = entries
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .map((e) => e.name)
  .sort();

let total = 0;
for (const section of sections) {
  const count = await copySection(section);
  if (count > 0) {
    console.log(`  ${section.padEnd(22)} ${count} files`);
  }
  total += count;
}

// Also copy root-level .md/.mdx files (typically the landing index page)
// — but skip README files which are GitHub-only.
await fs.mkdir(DEST_ROOT, { recursive: true });
const rootFiles = entries.filter(
  (e) =>
    e.isFile() &&
    (e.name.endsWith(".md") || e.name.endsWith(".mdx")) &&
    !/^README\.md$/i.test(e.name),
);
let rootCount = 0;
for (const entry of rootFiles) {
  const srcPath = path.join(SOURCE_ROOT, entry.name);
  const destPath = path.join(DEST_ROOT, entry.name);
  const raw = await fs.readFile(srcPath, "utf8");
  await fs.writeFile(destPath, transform(raw));
  rootCount++;
}
if (rootCount > 0) {
  console.log(`  ${"(root)".padEnd(22)} ${rootCount} files`);
  total += rootCount;
}

console.log();
console.log(`Done — ${total} files imported into v/latest/${pkg}/.`);
