// @ts-check
/**
 * Guard against live MDX syntax (top-level imports, capitalized JSX
 * component tags) leaking into `.md` docs-collection files. `.md` files are
 * rendered as plain Markdown by Starlight — they do not evaluate imports or
 * JSX, so such syntax renders as literal, broken text on the live site.
 *
 * Scans every `.md` file that currently exists under src/content/docs (the
 * filesystem is the source of truth, not git HEAD — a file deleted from the
 * working tree, even if still tracked, is not a live subject).
 *
 * Run via `node scripts/check-mdx-in-md.mjs` (also wired into `prebuild`).
 */
import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const DOCS_ROOT = resolve(here, "..");
const CONTENT_DOCS = resolve(DOCS_ROOT, "src/content/docs");

/** @param {string} dir */
function collectMarkdownFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectMarkdownFiles(full));
    } else if (stats.isFile() && extname(entry) === ".md") {
      files.push(full);
    }
  }
  return files;
}

/** Blank out the leading YAML frontmatter block (--- ... ---), keeping line count intact. */
function stripFrontmatter(text) {
  const lines = text.split("\n");
  if (lines[0] !== "---") return text;
  for (let i = 1; i < lines.length; i++) {
    lines[i - 1] = "";
    if (lines[i] === "---") {
      lines[i] = "";
      return lines.join("\n");
    }
  }
  return text;
}

/** Blank out fenced code blocks (``` or ~~~) line-by-line, keeping line count intact. */
function stripFencedCode(text) {
  const lines = text.split("\n");
  let inFence = false;
  let fenceChar = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = !inFence && line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      inFence = true;
      fenceChar = fenceMatch[1][0];
      lines[i] = "";
      continue;
    }
    if (inFence) {
      const closeRe = fenceChar === "`" ? /^\s*`{3,}\s*$/ : /^\s*~{3,}\s*$/;
      const isClose = closeRe.test(line);
      lines[i] = "";
      if (isClose) inFence = false;
    }
  }
  return lines.join("\n");
}

/** Blank out inline code spans (`...`) on each line, keeping length/line count intact. */
function stripInlineCode(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length)))
    .join("\n");
}

/** @param {number} index @param {string} text */
function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

const IMPORT_PATTERNS = [
  // named/default/namespace import spanning one or more lines: import ... from "...";
  /^[ \t]*import\s+[\s\S]*?from\s+["'][^"'\n]+["'];?/gm,
  // side-effect-only import: import "...";
  /^[ \t]*import\s+["'][^"'\n]+["'];?/gm,
];

// Opening, closing, or self-closing capitalized JSX tag, dotted names allowed
// (e.g. <Foo.Bar>). Lowercase HTML tags are intentionally not matched.
const JSX_COMPONENT_PATTERN = /<\/?([A-Z][A-Za-z0-9_.]*)\b[^>]*>/g;

/** @param {string} filePath */
async function checkFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const stripped = stripInlineCode(stripFencedCode(stripFrontmatter(raw)));

  /** @type {{ line: number, kind: string, snippet: string }[]} */
  const violations = [];

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(stripped))) {
      const line = lineNumberAt(stripped, match.index);
      const snippet = match[0].trim().split("\n")[0].slice(0, 80);
      violations.push({
        line,
        kind: "unfenced top-level import",
        snippet,
      });
    }
  }

  JSX_COMPONENT_PATTERN.lastIndex = 0;
  let jsxMatch;
  while ((jsxMatch = JSX_COMPONENT_PATTERN.exec(stripped))) {
    const line = lineNumberAt(stripped, jsxMatch.index);
    violations.push({
      line,
      kind: `capitalized JSX component tag <${jsxMatch[1]}>`,
      snippet: jsxMatch[0].trim().split("\n")[0].slice(0, 80),
    });
  }

  violations.sort((a, b) => a.line - b.line);
  return violations;
}

async function main() {
  const files = collectMarkdownFiles(CONTENT_DOCS).sort();
  let violationCount = 0;

  for (const file of files) {
    const violations = await checkFile(file);
    if (violations.length === 0) continue;
    violationCount += violations.length;
    const relPath = relative(DOCS_ROOT, file).replace(/\\/g, "/");
    for (const v of violations) {
      console.error(`${relPath}:${v.line}: ${v.kind} — ${v.snippet}`);
    }
  }

  if (violationCount > 0) {
    console.error(
      `\nMDX-in-Markdown guard: ${violationCount} violation(s) in ${files.length} .md file(s) under src/content/docs.`,
    );
    console.error(
      "Live imports and capitalized JSX component tags are not valid in .md files — use .mdx or plain Markdown/HTML instead.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`MDX-in-Markdown guard: ${files.length} .md file(s) checked, 0 violations.`);
}

await main();
