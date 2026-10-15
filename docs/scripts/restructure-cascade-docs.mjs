#!/usr/bin/env node
/**
 * Restructures `domains/cascade/docs/` from Diátaxis layout
 * (getting-started / essentials / guides / recipes / reference) into
 * Laravel-style domain sections (getting-started / architecture-concepts
 * / the-basics / digging-deeper / cli / recipes / reference).
 *
 * Same pattern as `restructure-core-docs.mjs`. Idempotent.
 *
 * Run from `@warlock.js/docs/`:
 *   node scripts/restructure-cascade-docs.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(DOCS_ROOT, "..", "..");
const CASCADE_DOCS = path.join(PROJECT_ROOT, "domains", "cascade", "docs");

const PLAN = {
  "getting-started": [
    { from: "getting-started", file: "01-introduction.md", order: 1 },
    { from: "getting-started", file: "02-installation.md", order: 2 },
    { from: "getting-started", file: "03-configuration.md", order: 3 },
    { from: "getting-started", file: "04-migrations-intro.md", order: 4 },
    { from: "getting-started", file: "05-your-first-model.md", order: 5 },
  ],
  "architecture-concepts": [
    { from: "guides", file: "configuration.md", order: 1 },
    { from: "guides", file: "dirty-tracking.md", order: 2 },
    { from: "guides", file: "events-and-hooks.md", order: 3 },
  ],
  "the-basics": [
    { from: "essentials", file: "01-crud-basics.md", order: 1 },
    { from: "guides", file: "accessors.md", order: 2 },
    { from: "essentials", file: "02-querying.md", order: 3 },
    { from: "essentials", file: "03-relationships.md", order: 4 },
    { from: "guides", file: "relationships.md", order: 5 },
    { from: "guides", file: "migrations.md", order: 6 },
    { from: "guides", file: "validation.md", order: 7 },
    { from: "guides", file: "resources.md", order: 8 },
  ],
  "digging-deeper": [
    { from: "guides", file: "aggregates.md", order: 1 },
    { from: "guides", file: "atomic-operations.md", order: 2 },
    { from: "guides", file: "transactions.md", order: 3 },
    { from: "guides", file: "delete-strategies.md", order: 4 },
    { from: "guides", file: "expressions.md", order: 5 },
    { from: "guides", file: "joins.md", order: 6 },
    { from: "guides", file: "json-fields.md", order: 7 },
    { from: "guides", file: "multi-database.md", order: 8 },
    { from: "guides", file: "scopes.md", order: 9 },
    { from: "guides", file: "sync.md", order: 10 },
    { from: "guides", file: "vector-search.md", order: 11 },
  ],
  cli: [{ from: "guides", file: "cli.md", order: 1 }],
  recipes: [
    { from: "recipes", file: "audit-trail.md", order: 1 },
    { from: "recipes", file: "full-text-search.md", order: 2 },
    { from: "recipes", file: "hybrid-search.md", order: 3 },
    { from: "recipes", file: "json-mutations.md", order: 4 },
    { from: "recipes", file: "mongodb-atlas-vector-setup.md", order: 5 },
    { from: "recipes", file: "mongodb-replica-set-local-dev.md", order: 6 },
    { from: "recipes", file: "multi-tenant.md", order: 7 },
    { from: "recipes", file: "outbox-pattern.md", order: 8 },
    { from: "recipes", file: "paginated-search.md", order: 9 },
    { from: "recipes", file: "rag.md", order: 10 },
    { from: "recipes", file: "reporting.md", order: 11 },
  ],
  reference: [
    { from: "reference", file: "operations-api.md", order: 1 },
    { from: "reference", file: "query-builder-api.md", order: 2 },
  ],
};

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function setSidebarPosition(content, order) {
  if (/^sidebar_position:/m.test(content)) {
    return content.replace(/^sidebar_position:\s*\d+/m, `sidebar_position: ${order}`);
  }
  return content.replace(/^---\r?\n/, `---\nsidebar_position: ${order}\n`);
}

let moved = 0;
let updated = 0;

for (const [section, files] of Object.entries(PLAN)) {
  const destDir = path.join(CASCADE_DOCS, section);
  await fs.mkdir(destDir, { recursive: true });
  console.log(`\n${section}/`);

  for (const { from, file, order } of files) {
    const srcPath = path.join(CASCADE_DOCS, from, file);
    const destPath = path.join(CASCADE_DOCS, section, file);

    let content;
    let source;
    if (await exists(srcPath)) {
      content = await fs.readFile(srcPath, "utf8");
      source = "src";
    } else if (await exists(destPath)) {
      content = await fs.readFile(destPath, "utf8");
      source = "dest";
    } else {
      console.log(`  ! missing: ${from}/${file}`);
      continue;
    }

    content = setSidebarPosition(content, order);
    await fs.writeFile(destPath, content);

    if (source === "src" && srcPath !== destPath) {
      await fs.unlink(srcPath);
      moved++;
      console.log(`  ${order.toString().padStart(2)}. ${file}  (moved from ${from}/)`);
    } else {
      updated++;
      console.log(`  ${order.toString().padStart(2)}. ${file}  (reordered)`);
    }
  }
}

for (const old of ["essentials", "guides"]) {
  const dir = path.join(CASCADE_DOCS, old);
  if (!(await exists(dir))) continue;
  const remaining = await fs.readdir(dir);
  if (remaining.length === 0) {
    await fs.rmdir(dir);
    console.log(`\nRemoved empty ${old}/`);
  } else {
    console.log(`\n! ${old}/ still has files: ${remaining.join(", ")}`);
  }
}

console.log(`\nDone — ${moved} moved, ${updated} reordered in place.`);
