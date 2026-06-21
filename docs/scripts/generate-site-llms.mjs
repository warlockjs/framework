// Generate site-level llms.txt + llms-full.txt for warlock.js.org.
//
// - llms.txt       → an index: framework overview + one line per package with a
//                    link to its docs section on the site.
// - llms-full.txt  → every package's llms-full.txt concatenated, in reading order.
//
// Source of truth is each package's own `llms.txt` / `llms-full.txt` (kept in
// lockstep with the code). Run after those are regenerated:
//   node scripts/generate-site-llms.mjs
//
// Output lands in `public/` so Astro copies it verbatim to the dist root, making
// it resolve at https://warlock.js.org/llms.txt and /llms-full.txt.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, "..");
const packagesRoot = join(docsRoot, "..", "..", "@warlock.js");
const publicDir = join(docsRoot, "public");
const SITE = "https://warlock.js.org";

// Reading order: foundations first, then subsystems, then AI, then tooling.
const PACKAGES = [
  "core",
  "cascade",
  "seal",
  "cache",
  "fs",
  "logger",
  "scheduler",
  "auth",
  "context",
  "herald",
  "notifications",
  "ai",
  "ai-openai",
  "ai-anthropic",
  "ai-google",
  "ai-bedrock",
  "ai-ollama",
  "ai-panoptic",
  "create-warlock",
];

/** Pull the human description line from a package llms.txt (the last `>` quote in the header). */
function readDescription(llms) {
  const quotes = llms
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("Package:"));

  return quotes[0] ?? "";
}

/** Map a package name to its docs landing URL on the site. */
function docUrl(pkg) {
  // ai-panoptic is an observability companion, not a provider adapter — it
  // lives under the AI Observability section rather than providers/.
  if (pkg === "ai-panoptic") {
    return `${SITE}/v/latest/ai/observability/ai-panoptic/`;
  }

  if (pkg.startsWith("ai-")) {
    return `${SITE}/v/latest/ai/providers/${pkg.replace("ai-", "")}/`;
  }

  return `${SITE}/v/latest/${pkg}/`;
}

const indexLines = [];
const fullParts = [];

for (const pkg of PACKAGES) {
  const pkgDir = join(packagesRoot, pkg);
  const llmsPath = join(pkgDir, "llms.txt");
  const fullPath = join(pkgDir, "llms-full.txt");

  if (!existsSync(llmsPath)) {
    continue;
  }

  const llms = readFileSync(llmsPath, "utf8");
  const description = readDescription(llms);
  const scopedName = pkg === "create-warlock" ? "create-warlock" : `@warlock.js/${pkg}`;

  indexLines.push(`- [${scopedName}](${docUrl(pkg)}): ${description}`);

  if (existsSync(fullPath)) {
    const full = readFileSync(fullPath, "utf8").trim();
    fullParts.push(
      `\n\n${"=".repeat(80)}\n# ${scopedName}\n${"=".repeat(80)}\n\n${full}`,
    );
  }
}

const llmsTxt = `# Warlock.js

> A modern, batteries-included TypeScript backend framework for Node.js. Warlock
> ships an integrated ecosystem — HTTP, ORM (Cascade), validation (Seal), cache,
> auth, logging, scheduling, messaging (Herald), and AI — built to work together
> with first-class type-safety and a clean, convention-driven developer experience.

Documentation: ${SITE}

## Packages

${indexLines.join("\n")}

## Full text

- [llms-full.txt](${SITE}/llms-full.txt): The complete documentation for every package, concatenated into a single file.
`;

const llmsFullTxt = `# Warlock.js — Full documentation

> Concatenated llms-full.txt for every @warlock.js package. Source: ${SITE}
${fullParts.join("\n")}
`;

writeFileSync(join(publicDir, "llms.txt"), llmsTxt);
writeFileSync(join(publicDir, "llms-full.txt"), llmsFullTxt);

console.log(
  `Generated public/llms.txt (${indexLines.length} packages) + public/llms-full.txt (${llmsFullTxt.length} bytes).`,
);
