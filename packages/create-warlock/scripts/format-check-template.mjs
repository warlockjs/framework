#!/usr/bin/env node
/** Check authored template TS/TSX with the default Oxfmt configuration.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = path.join(packageRoot, "templates", "warlock");
const checkedRoot = path.join(templateRoot, "src");
const shouldWrite = process.argv.includes("--write");
const formatter = await import("oxfmt");
const options = JSON.parse(
  readFileSync(path.join(packageRoot, "templates/toolchains/oxc/.oxfmtrc.json"), "utf8"),
);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", ".git", ".turbo"].includes(entry.name))
        files.push(...(await collectFiles(absolute)));
    } else if ([".ts", ".tsx"].includes(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}
const files = (await collectFiles(checkedRoot)).sort();
if (files.length === 0) throw new Error(`template formatter gate: no files under ${checkedRoot}`);
const defective = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  // Oxfmt's shipped dist/index.d.ts: format(fileName, sourceText, options).
  const result = await formatter.format(file, source, options);
  if (result.errors.length) throw new Error(`${file}: ${JSON.stringify(result.errors)}`);
  const formatted = result.code;
  if (formatted !== source) {
    if (shouldWrite) writeFileSync(file, formatted);
    else defective.push(path.relative(templateRoot, file));
  }
}
if (defective.length) {
  console.error(
    `template formatter gate FAILED (Oxfmt): ${defective.length}/${files.length} files differ.\n${defective.join("\n")}`,
  );
  console.error("Fix with: node scripts/format-check-template.mjs --write");
  process.exitCode = 1;
} else
  console.log(
    `template formatter gate (Oxfmt): ${files.length} files ${shouldWrite ? "formatted" : "checked"}.`,
  );
