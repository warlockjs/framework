#!/usr/bin/env node
/**
 * Restructures `domains/core/docs/` from Diátaxis layout
 * (getting-started / essentials / guides / recipes) into Laravel-style
 * domain sections (getting-started / architecture-concepts / the-basics
 * / digging-deeper / cli / testing / recipes).
 *
 * Per-file actions:
 * - Moves the file from its current section folder to its target
 *   domain folder.
 * - Rewrites `sidebar_position:` in frontmatter to its new per-section
 *   order. Inserts the field if missing.
 *
 * Idempotent: re-running after the first pass updates orders in place.
 * Cleans up empty source folders at the end.
 *
 * Run from `@warlock.js/docs/`:
 *   node scripts/restructure-core-docs.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(DOCS_ROOT, "..", "..");
const CORE_DOCS = path.join(PROJECT_ROOT, "domains", "core", "docs");

// Per-target-section, ordered list of files with their source folder.
const PLAN = {
  "getting-started": [
    { from: "getting-started", file: "01-introduction.md", order: 1 },
    { from: "getting-started", file: "02-installation.md", order: 2 },
    { from: "getting-started", file: "03-configuration.md", order: 3 },
    { from: "getting-started", file: "04-first-route.md", order: 4 },
    { from: "getting-started", file: "05-project-layout.md", order: 5 },
  ],
  "architecture-concepts": [
    { from: "guides", file: "application.md", order: 1 },
    { from: "guides", file: "how-it-works.md", order: 2 },
    { from: "essentials", file: "01-the-request-lifecycle.md", order: 3 },
    { from: "guides", file: "bootstrap-and-connectors.md", order: 4 },
    { from: "guides", file: "warlock-config.md", order: 5 },
    { from: "guides", file: "configuration-deep.md", order: 6 },
  ],
  "the-basics": [
    { from: "essentials", file: "02-routing.md", order: 1 },
    { from: "guides", file: "routing-deep.md", order: 2 },
    { from: "essentials", file: "03-controllers.md", order: 3 },
    { from: "guides", file: "middleware.md", order: 4 },
    { from: "guides", file: "http-request.md", order: 5 },
    { from: "guides", file: "http-response.md", order: 6 },
    { from: "guides", file: "validation.md", order: 7 },
    { from: "essentials", file: "06-resources.md", order: 8 },
    { from: "guides", file: "resources-deep.md", order: 9 },
    { from: "essentials", file: "05-repositories.md", order: 10 },
    { from: "guides", file: "repositories-deep.md", order: 11 },
    { from: "essentials", file: "04-use-cases.md", order: 12 },
    { from: "guides", file: "use-cases-deep.md", order: 13 },
    { from: "guides", file: "restful.md", order: 14 },
  ],
  "digging-deeper": [
    { from: "guides", file: "mail.md", order: 1 },
    { from: "guides", file: "file-uploads.md", order: 2 },
    { from: "guides", file: "storage.md", order: 3 },
    { from: "guides", file: "image-processing.md", order: 4 },
    { from: "guides", file: "cache.md", order: 5 },
    { from: "guides", file: "logging.md", order: 6 },
    { from: "guides", file: "encryption.md", order: 7 },
    { from: "guides", file: "retry.md", order: 8 },
    { from: "guides", file: "benchmark.md", order: 9 },
    { from: "guides", file: "socket.md", order: 10 },
  ],
  cli: [
    { from: "guides", file: "cli-commands.md", order: 1 },
    { from: "guides", file: "generators.md", order: 2 },
    { from: "recipes", file: "custom-cli-command.md", order: 3 },
    { from: "recipes", file: "custom-connector.md", order: 4 },
  ],
  testing: [
    { from: "guides", file: "testing.md", order: 1 },
    { from: "recipes", file: "integration-tests.md", order: 2 },
  ],
  recipes: [
    { from: "recipes", file: "add-a-crud-module.md", order: 1 },
    { from: "recipes", file: "api-versioning.md", order: 2 },
    { from: "recipes", file: "cached-list.md", order: 3 },
    { from: "recipes", file: "custom-validator.md", order: 4 },
    { from: "recipes", file: "localized-responses.md", order: 5 },
    { from: "recipes", file: "protected-routes.md", order: 6 },
    { from: "recipes", file: "rate-limiting.md", order: 7 },
    { from: "recipes", file: "soft-delete-restful.md", order: 8 },
    { from: "recipes", file: "transactional-email.md", order: 9 },
    { from: "recipes", file: "upload-to-s3.md", order: 10 },
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
    return content.replace(
      /^sidebar_position:\s*\d+/m,
      `sidebar_position: ${order}`,
    );
  }
  // Insert right after the opening `---` of the frontmatter.
  return content.replace(/^---\r?\n/, `---\nsidebar_position: ${order}\n`);
}

let moved = 0;
let updated = 0;

for (const [section, files] of Object.entries(PLAN)) {
  const destDir = path.join(CORE_DOCS, section);
  await fs.mkdir(destDir, { recursive: true });

  console.log(`\n${section}/`);

  for (const { from, file, order } of files) {
    const srcPath = path.join(CORE_DOCS, from, file);
    const destPath = path.join(CORE_DOCS, section, file);

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

// Clean up the old Diátaxis folders if they're empty now.
for (const old of ["essentials", "guides"]) {
  const dir = path.join(CORE_DOCS, old);
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
