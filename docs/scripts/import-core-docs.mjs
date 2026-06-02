#!/usr/bin/env node
/**
 * Imports core docs from `domains/core/docs/{getting-started,essentials,guides,recipes}/*.md`
 * into Starlight's content tree at `src/content/docs/v/latest/core/`.
 *
 * Transforms applied per file:
 * - Extracts the body's first `# H1` heading into the `title:` frontmatter
 *   field (Starlight requires `title`).
 * - Strips the body's H1 so the page title doesn't render twice.
 * - Renames Docusaurus-style `sidebar_position` → `sidebar.order` and
 *   `sidebar_label` → `sidebar.label` (Starlight's shape).
 * - Neutralizes cross-package skill links (`@warlock.js/<pkg>/skills/...`)
 *   into plain inline code so the build doesn't break on dead targets.
 *   Internal relative `.md` links between core docs stay as-is — Starlight
 *   resolves those to the right slug automatically.
 *
 * Idempotent — re-running overwrites the destination files.
 *
 * Usage (from `@warlock.js/docs/`):
 *   node scripts/import-core-docs.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(DOCS_ROOT, "..", "..");
const SOURCE_ROOT = path.join(PROJECT_ROOT, "domains", "core", "docs");
const DEST_ROOT = path.join(DOCS_ROOT, "src", "content", "docs", "v", "latest", "core");
const SECTIONS = ["getting-started", "essentials", "guides", "recipes"];

function yamlEscape(value) {
  // Strip a single layer of surrounding quotes if present, then re-quote.
  const v = value.replace(/^["'](.*)["']$/, "$1").trim();
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function transform(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!fmMatch) {
    // No frontmatter — wrap the body in minimal frontmatter using H1 as title.
    const h1 = content.match(/^# (.+)$/m);
    const title = h1 ? h1[1] : "Untitled";
    const body = h1 ? content.replace(/^# .+\r?\n+/, "") : content;
    return `---\ntitle: ${yamlEscape(title)}\n---\n${body.trimStart()}`;
  }

  let fm = fmMatch[1];
  let body = fmMatch[2];

  // Extract H1 from body (first heading at the document root).
  const h1Match = body.match(/^# (.+)$/m);
  const title = h1Match ? h1Match[1] : "Untitled";
  if (h1Match) {
    body = body.replace(/^# .+\r?\n+/, "");
  }

  // Pull existing sidebar_position / sidebar_label values, then strip them
  // from the original frontmatter — they'll move into a nested `sidebar:` block.
  const posMatch = fm.match(/^sidebar_position:\s*(\S+)\s*$/m);
  const labMatch = fm.match(/^sidebar_label:\s*(.+)$/m);
  fm = fm.replace(/^sidebar_position:.*\r?\n?/m, "");
  fm = fm.replace(/^sidebar_label:.*\r?\n?/m, "");
  fm = fm.replace(/^\s*$/gm, "").trim();

  // Build the new frontmatter — title first, then surviving fields, then
  // the nested sidebar block.
  const lines = [`title: ${yamlEscape(title)}`];

  if (fm) {
    // Preserve any other frontmatter fields (description, etc.) verbatim.
    lines.push(fm);
  }

  if (posMatch || labMatch) {
    lines.push("sidebar:");
    if (posMatch) lines.push(`  order: ${posMatch[1]}`);
    if (labMatch) lines.push(`  label: ${yamlEscape(labMatch[1].trim())}`);
  }

  // Neutralize cross-package skill links — they point outside Starlight's
  // content tree. Convert `[text](path-with-@warlock.js)` → `\`text\``.
  body = body.replace(
    /\[([^\]]+)\]\(([^)]*@warlock\.js\/[^)]+)\)/g,
    (_match, text) => {
      const clean = text.replace(/^`(.*)`$/, "$1");
      return `\`${clean}\``;
    },
  );

  return `---\n${lines.join("\n")}\n---\n\n${body.trimStart()}`;
}

async function copySection(section) {
  const srcDir = path.join(SOURCE_ROOT, section);
  const destDir = path.join(DEST_ROOT, section);

  await fs.mkdir(destDir, { recursive: true });

  const files = await fs.readdir(srcDir);
  let count = 0;
  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);

    const raw = await fs.readFile(srcPath, "utf8");
    const transformed = transform(raw);

    await fs.writeFile(destPath, transformed);
    count++;
  }
  return count;
}

console.log("Importing core docs from", SOURCE_ROOT);
console.log("                     to", DEST_ROOT);
console.log();

let total = 0;
for (const section of SECTIONS) {
  const count = await copySection(section);
  console.log(`  ${section.padEnd(18)} ${count} files`);
  total += count;
}

console.log();
console.log(`Done — ${total} files imported.`);
