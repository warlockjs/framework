#!/usr/bin/env node
/**
 * Restructures `src/content/docs/v/latest/ai/` from the grown-flat layout
 * (the-basics: 14 pages, digging-deeper: 20 pages) into domain sections
 * (agents / tools / orchestration / prompts / rag / modalities /
 * reliability / testing), re-homes log-ai-calls into observability, and
 * pulls the two API how-tos out of best-practices into testing.
 * IA approved 2026-07-04 — see plans/2026-07-04-ai-docs-ia-proposal.md
 * (in the @warlock.js workspace plans/ folder).
 *
 * Per-file actions:
 * - Moves the file to its target section folder (filenames never change).
 * - Rewrites `sidebar: order:` in frontmatter to the new per-section
 *   order. Inserts the field if missing. Preserves the file's EOL style.
 * - Rewrites EVERY internal doc link in every ai/ page to the absolute
 *   canonical form `/v/latest/.../` — relative links are resolved
 *   against the page's PRE-MOVE location (the authoring convention was
 *   file-relative), then remapped through the move table. This also
 *   fixes the pre-existing bug where as-authored relative links break
 *   in the browser (a page URL ends with a trailing slash, so
 *   `./sibling` resolved under the page itself and 404'd).
 * - Skips fenced code blocks and inline code spans when rewriting.
 *
 * Aborts before writing anything if any link fails to resolve to an
 * existing docs page. Idempotent: a second run is a no-op.
 *
 * Run from `@warlock.js/docs/`:
 *   node scripts/restructure-ai-docs.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..");
const CONTENT_ROOT = path.join(DOCS_ROOT, "src", "content", "docs");
const AI_ROOT = path.join(CONTENT_ROOT, "v", "latest", "ai");

// Per-target-section, ordered list of pages: [sourceSection, file, newOrder].
// The observability block is an in-place renumber (plus log-ai-calls moving in)
// that also fixes the old 0-based/missing orders.
const PLAN = {
  agents: [
    ["the-basics", "run-agent.md", 1],
    ["the-basics", "stream-structured-output.md", 2],
    ["digging-deeper", "control-reasoning.md", 3],
    ["the-basics", "spawn-sub-agent.md", 4],
    ["digging-deeper", "serve-over-sse.md", 5],
  ],
  tools: [
    ["the-basics", "define-tools.md", 1],
    ["the-basics", "use-ai-tools.md", 2],
    ["digging-deeper", "connect-mcp.md", 3],
    ["digging-deeper", "use-workspace.md", 4],
    ["digging-deeper", "runtime-skills.md", 5],
  ],
  orchestration: [
    ["digging-deeper", "run-workflow.md", 1],
    ["digging-deeper", "run-supervisor.md", 2],
    ["digging-deeper", "run-team.md", 3],
    ["digging-deeper", "run-orchestrator.md", 4],
  ],
  prompts: [
    ["the-basics", "write-system-prompts.md", 1],
    ["the-basics", "prompt-registry.md", 2],
    ["the-basics", "refine-prompts.md", 3],
  ],
  rag: [
    ["the-basics", "run-rag.md", 1],
    ["digging-deeper", "rag-loaders-and-stores.md", 2],
    ["the-basics", "hybrid-retrieval.md", 3],
    ["the-basics", "embed-text.md", 4],
  ],
  modalities: [
    ["the-basics", "generate-images.md", 1],
    ["the-basics", "generate-speech.md", 2],
    ["the-basics", "transcribe-audio.md", 3],
    ["digging-deeper", "realtime-and-video.md", 4],
  ],
  reliability: [
    ["digging-deeper", "handle-errors.md", 1],
    ["digging-deeper", "durable-execution.md", 2],
    ["digging-deeper", "persist-ai-data.md", 3],
    ["digging-deeper", "attach-middleware.md", 4],
    ["digging-deeper", "guardrails.md", 5],
    ["digging-deeper", "human-in-the-loop.md", 6],
    ["digging-deeper", "outbound-policy.md", 7],
    ["digging-deeper", "redact-secrets.md", 8],
  ],
  testing: [
    ["best-practices", "evaluation-and-datasets.md", 1],
    ["best-practices", "record-replay-testing.md", 2],
  ],
  observability: [
    ["observability", "observe-seam.md", 1],
    ["observability", "ai-panoptic.md", 2],
    ["observability", "what-panoptic-traces.md", 3],
    ["observability", "configuring-panoptic.md", 4],
    ["observability", "local-dashboard.md", 5],
    ["observability", "exporter-output.md", 6],
    ["observability", "querying-traces.md", 7],
    ["digging-deeper", "log-ai-calls.md", 8],
  ],
};

const RETIRED_DIRS = ["the-basics", "digging-deeper"];

// ---------------------------------------------------------------- helpers

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const toPosix = (p) => p.split(path.sep).join("/");

/** Site-absolute slug (no trailing slash) for a content file path. */
function slugOf(contentRelPath) {
  let s = contentRelPath.replace(/\.(md|mdx)$/, "");
  if (s.endsWith("/index") || s === "index") s = s.slice(0, -"/index".length) || "";
  return "/" + s;
}

// ------------------------------------------------------- move table (old→new)

/** oldRel/newRel are ai-root-relative posix paths of every ai page. */
const moves = new Map(); // oldRel → newRel
const orders = new Map(); // newRel → order
for (const [section, entries] of Object.entries(PLAN)) {
  for (const [from, file, order] of entries) {
    moves.set(`${from}/${file}`, `${section}/${file}`);
    orders.set(`${section}/${file}`, order);
  }
}

// Every ai page not in the PLAN maps to itself (identity), so the sweep can
// resolve links between unmoved pages too. A file must appear exactly once,
// keyed by its PRE-MOVE path: on a re-run the moved files already sit at
// their PLAN target, so identity entries for targets would re-sweep them
// with the wrong resolution base — skip both PLAN sources and targets.
const planTargets = new Set(moves.values());
const aiFilesNow = walk(AI_ROOT)
  .filter((p) => /\.(md|mdx)$/.test(p))
  .map((p) => toPosix(path.relative(AI_ROOT, p)));
for (const rel of aiFilesNow) {
  if (!moves.has(rel) && !planTargets.has(rel)) moves.set(rel, rel);
}

// ----------------------------------------------------------------- 1. moves

let movedCount = 0;
for (const [oldRel, newRel] of moves) {
  if (oldRel === newRel) continue;
  const src = path.join(AI_ROOT, oldRel);
  const dst = path.join(AI_ROOT, newRel);
  if (!fs.existsSync(src)) {
    if (fs.existsSync(dst)) continue; // already moved (idempotent re-run)
    throw new Error(`Missing source and target for ${oldRel}`);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  movedCount++;
}

// -------------------------------------------------- 2. sidebar order rewrite

function rewriteOrder(text, order, eol) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) throw new Error("no frontmatter");
  let block = fm[1];
  if (/^sidebar:/m.test(block)) {
    if (/^(\s+)order:\s*\d+/m.test(block)) {
      block = block.replace(/^(\s+order:\s*)\d+/m, `$1${order}`);
    } else {
      block = block.replace(/^sidebar:.*$/m, (line) => `${line}${eol}  order: ${order}`);
    }
  } else {
    block = `${block}${eol}sidebar:${eol}  order: ${order}`;
  }
  return text.slice(0, fm.index) + `---${eol}${block}${eol}---` + text.slice(fm.index + fm[0].length);
}

let renumbered = 0;
for (const [newRel, order] of orders) {
  const p = path.join(AI_ROOT, newRel);
  const text = fs.readFileSync(p, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const next = rewriteOrder(text, order, eol);
  if (next !== text) {
    fs.writeFileSync(p, next);
    renumbered++;
  }
}

// -------------------------------------------------------------- 3. link sweep

// Valid link targets: every docs content page as a site-absolute slug.
// A `slug:` frontmatter override wins over the file path (the cache
// section flattens its URLs that way).
const validSlugs = new Set(
  walk(CONTENT_ROOT)
    .filter((p) => /\.(md|mdx)$/.test(p))
    .map((p) => {
      const fm = fs.readFileSync(p, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const over = fm && fm[1].match(/^slug:\s*["']?([^"'\r\n]+)["']?\s*$/m);
      if (over) return "/" + over[1].trim().replace(/^\/+|\/+$/g, "");
      return slugOf(toPosix(path.relative(CONTENT_ROOT, p)));
    }),
);

// old ai-relative page path → new site-absolute slug
function mapOldAiPath(oldAiRel) {
  const newRel = moves.get(oldAiRel);
  if (!newRel) return null;
  return slugOf(`v/latest/ai/${newRel}`);
}

const newToOld = new Map([...moves].map(([o, n]) => [n, o]));
const failures = [];
const edits = []; // [absFilePath, newText]
let linksRewritten = 0;

/** Rewrite one link target; returns null to leave untouched. */
function mapTarget(rawTarget, oldFileAiRel, fileLabel) {
  let target = rawTarget.trim();
  if (!target || /^(https?:|mailto:|#)/.test(target)) return null;
  const hashAt = target.indexOf("#");
  const anchor = hashAt >= 0 ? target.slice(hashAt) : "";
  let p = hashAt >= 0 ? target.slice(0, hashAt) : target;
  if (!p) return null; // pure in-page anchor
  p = p.replace(/\/+$/, "");

  let abs;
  if (p.startsWith("/")) {
    abs = p;
  } else if (p.startsWith("./") || p.startsWith("../")) {
    // Authoring convention: file-relative from the page's PRE-MOVE folder.
    const baseDir = path.posix.dirname(`v/latest/ai/${oldFileAiRel}`);
    abs = "/" + path.posix.normalize(`${baseDir}/${p}`);
    if (abs.includes("..")) {
      failures.push(`${fileLabel}: escapes content root → ${rawTarget}`);
      return null;
    }
  } else {
    return null; // bare word or asset — leave as-is
  }

  // Remap moved ai pages (works for both old and new spellings of the path).
  const m = abs.match(/^\/v\/latest\/ai\/(.+)$/);
  if (m) {
    const mapped = mapOldAiPath(`${m[1]}.md`) ?? mapOldAiPath(`${m[1]}.mdx`);
    if (mapped) abs = mapped;
  }

  if (!validSlugs.has(abs)) {
    failures.push(`${fileLabel}: unresolved → ${rawTarget} (as ${abs})`);
    return null;
  }
  return `${abs}/${anchor}`;
}

/** Rewrite links on a single line (assumed outside fenced blocks). */
function sweepLine(line, oldFileAiRel, fileLabel) {
  // Split out inline code spans so we never rewrite inside backticks.
  return line
    .split(/(`[^`]*`)/)
    .map((seg) => {
      if (seg.startsWith("`")) return seg;
      return seg.replace(/\]\(([^()\s]+)\)/g, (whole, target) => {
        const mapped = mapTarget(target, oldFileAiRel, fileLabel);
        if (mapped === null || mapped === target) return whole;
        linksRewritten++;
        return `](${mapped})`;
      });
    })
    .join("");
}

for (const [oldRel, newRel] of moves) {
  const p = path.join(AI_ROOT, newRel);
  const text = fs.readFileSync(p, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  let inFence = false;
  const swept = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : sweepLine(line, oldRel, newRel);
  });
  const next = swept.join(eol);
  if (next !== text) edits.push([p, next]);
}

if (failures.length) {
  console.error(`\nABORT — ${failures.length} unresolved link(s); no link edits written:`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

for (const [p, next] of edits) fs.writeFileSync(p, next);

// ------------------------------------------------------------- 4. cleanup

for (const dir of RETIRED_DIRS) {
  const p = path.join(AI_ROOT, dir);
  if (fs.existsSync(p)) {
    const left = fs.readdirSync(p);
    if (left.length) throw new Error(`${dir}/ not empty after moves: ${left.join(", ")}`);
    fs.rmdirSync(p);
  }
}

console.log(`moved ${movedCount} file(s), renumbered ${renumbered}, links rewritten ${linksRewritten} across ${edits.length} file(s)`);
console.log("retired dirs removed:", RETIRED_DIRS.join(", "));
