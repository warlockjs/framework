#!/usr/bin/env node
/**
 * Imports Tier 2 package docs — flat `.mdx` files in `domains/<pkg>/docs/`
 * sorted into the five-section Diátaxis tree at
 * `src/content/docs/v/latest/<pkg>/`.
 *
 * Categorization is hand-curated per package based on each file's content
 * intent — getting-started / essentials / guides / recipes / reference.
 * If a file isn't listed, it's skipped (idempotent re-runs ignore unknowns).
 *
 * Same frontmatter + body transforms as `import-package-docs.mjs`.
 *
 * Usage (from `@warlock.js/docs/`):
 *   node scripts/import-tier2-docs.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(DOCS_ROOT, "..", "..");

const PLAN = {
  cache: {
    "getting-started": [
      ["introduction.mdx", 1],
      ["quick-start.mdx", 2],
    ],
    essentials: [
      ["cache-manager.mdx", 1],
      ["configurations.mdx", 2],
      ["set-options.mdx", 3],
      ["best-practices.mdx", 4],
      ["comparison.mdx", 5],
      ["errors.mdx", 6],
      ["events.mdx", 7],
      ["metrics.mdx", 8],
    ],
    guides: [
      ["cached.mdx", 1],
      ["tags.mdx", 2],
      ["namespaces.mdx", 3],
      ["lock.mdx", 4],
      ["swr.mdx", 5],
      ["lists.mdx", 6],
      ["atomic-operations.mdx", 7],
      ["bulk-operations.mdx", 8],
      ["update-merge.mdx", 9],
      ["stampede-prevention.mdx", 10],
      ["similarity.mdx", 11],
      ["testing.mdx", 12],
    ],
    reference: [
      ["cache-driver-interface.mdx", 1],
      ["base-cache-driver.mdx", 2],
      ["make-your-own-cache-driver.mdx", 3],
      ["memory.mdx", 10],
      ["memory-extended.mdx", 11],
      ["lru-memory.mdx", 12],
      ["file.mdx", 13],
      ["redis.mdx", 14],
      ["pg.mdx", 15],
      ["null.mdx", 16],
    ],
  },
  logger: {
    "getting-started": [["getting-started.mdx", 1]],
    essentials: [
      ["configuration.mdx", 1],
      ["channels.mdx", 2],
      ["lifecycle.mdx", 3],
      ["types.mdx", 4],
    ],
    guides: [
      ["redaction.mdx", 1],
      ["custom-channels.mdx", 2],
      ["capture-errors.mdx", 3],
    ],
    recipes: [["recipes.mdx", 1]],
    reference: [["api-reference.mdx", 1]],
  },
  scheduler: {
    "getting-started": [["introduction.mdx", 1]],
    essentials: [
      ["configuration.mdx", 1],
      ["defining-jobs.mdx", 2],
    ],
    guides: [
      ["timezone.mdx", 1],
      ["retry-backoff.mdx", 2],
      ["overlap-prevention.mdx", 3],
      ["events.mdx", 4],
    ],
  },
};

function yamlEscape(value) {
  const v = value.replace(/^["'](.*)["']$/, "$1").trim();
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function transform(content, order) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  let fm = "";
  let body = content;

  if (fmMatch) {
    fm = fmMatch[1];
    body = fmMatch[2];
  }

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
  if (/<\s*Tabs[\s>]/.test(body) && !/from\s+["']@astrojs\/starlight\/components["']/.test(body)) {
    body = `import { Tabs, TabItem } from "@astrojs/starlight/components";\n\n${body}`;
  }
  body = body.replace(/<TabItem\s+value="[^"]*"\s+/g, "<TabItem ");

  // Pull labels from old frontmatter (drop old sidebar_position — we
  // assign a new one per the categorization plan).
  const labMatch = fm.match(/^sidebar_label:\s*(.+)$/m);
  fm = fm.replace(/^sidebar_position:.*\r?\n?/m, "");
  fm = fm.replace(/^sidebar_label:.*\r?\n?/m, "");
  fm = fm.replace(/^slug:.*\r?\n?/m, "");
  fm = fm.replace(/^\s*$/gm, "").trim();

  const lines = [`title: ${yamlEscape(title)}`];
  if (fm) lines.push(fm);
  lines.push("sidebar:");
  lines.push(`  order: ${order}`);
  if (labMatch) {
    lines.push(`  label: ${yamlEscape(labMatch[1].trim())}`);
  }

  body = body.replace(
    /\[([^\]]+)\]\(([^)]*@warlock\.js\/[^)]+)\)/g,
    (_match, text) => {
      const clean = text.replace(/^`(.*)`$/, "$1");
      return `\`${clean}\``;
    },
  );

  // Strip Docusaurus heading-ID syntax (`## Heading {#anchor}`). Starlight
  // generates IDs from heading text automatically; the literal `{#...}`
  // doesn't parse as MDX.
  body = body.replace(/^(#{1,6}\s+.+?)\s*\{#[a-z0-9-]+\}\s*$/gm, "$1");

  return `---\n${lines.join("\n")}\n---\n\n${body.trimStart()}`;
}

async function importPackage(pkg, plan) {
  const srcRoot = path.join(PROJECT_ROOT, "domains", pkg, "docs");
  const destRoot = path.join(
    DOCS_ROOT,
    "src",
    "content",
    "docs",
    "v",
    "latest",
    pkg,
  );

  console.log(`\n${pkg}/`);

  let total = 0;
  for (const [section, files] of Object.entries(plan)) {
    const destDir = path.join(destRoot, section);
    await fs.mkdir(destDir, { recursive: true });

    for (const [filename, order] of files) {
      const srcPath = path.join(srcRoot, filename);
      let raw;
      try {
        raw = await fs.readFile(srcPath, "utf8");
      } catch {
        console.log(`  ! missing source: ${filename}`);
        continue;
      }

      const transformed = transform(raw, order);
      const destPath = path.join(destDir, filename);
      await fs.writeFile(destPath, transformed);
      total++;
    }

    console.log(`  ${section.padEnd(18)} ${files.length} files`);
  }
  console.log(`  Total: ${total}`);
  return total;
}

let grand = 0;
for (const [pkg, plan] of Object.entries(PLAN)) {
  grand += await importPackage(pkg, plan);
}
console.log(`\nDone — ${grand} files imported across ${Object.keys(PLAN).length} packages.`);
