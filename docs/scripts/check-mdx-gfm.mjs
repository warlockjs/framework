#!/usr/bin/env node
/**
 * Fail the docs build when a Markdown table reaches the page as plain text.
 *
 * A GFM table that the pipeline did not parse renders as a paragraph containing
 * its delimiter row (`| --- | --- |`). Code blocks are <pre>, not <p>, so tables
 * shown inside code examples are not flagged.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DELIMITER_ROW = /\|\s*:?-{3,}:?\s*\|/;

/** Paragraph texts in `html` that contain an unparsed table delimiter row. */
export function findRawTables(html) {
  const found = [];
  for (const [, inner] of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = inner.replace(/<[^>]+>/g, "");
    if (DELIMITER_ROW.test(text)) found.push(text.trim().slice(0, 120));
  }
  return found;
}

function* htmlFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(fileURLToPath(new URL("..", import.meta.url)), "dist");
  const broken = [];
  let scanned = 0;
  for (const file of htmlFiles(dist)) {
    scanned++;
    for (const text of findRawTables(readFileSync(file, "utf8")))
      broken.push(`${relative(dist, file)}: ${text}`);
  }
  if (broken.length) {
    console.error(
      `MDX/GFM table guard: ${broken.length} unrendered table(s):\n${broken.join("\n")}`,
    );
    process.exit(1);
  }
  console.log(`MDX/GFM table guard: ${scanned} page(s) checked, 0 unrendered tables.`);
}
