// Generate site-level llms.txt + llms-full.txt for warlock.js.org, plus a
// per-package pair for each package.
//
// - llms.txt              → an index: framework overview, then one line per
//                           package linking BOTH its docs section and its own
//                           llms.txt, so an agent can discover the cheap,
//                           package-scoped fetch instead of taking everything.
// - llms-full.txt         → every package's llms-full.txt concatenated.
// - <pkg>/llms.txt        → that package's own index.
// - <pkg>/llms-full.txt   → that package's full text.
//
// The per-package files matter because the aggregate is ~1.5 MB: an agent that
// only needs Cascade should not have to ingest the whole framework to get it.
//
// Source of truth is each package's own `llms.txt` / `llms-full.txt` (kept in
// lockstep with the code). Run after those are regenerated:
//   node scripts/generate-site-llms.mjs
//
// Output lands in `public/` so Astro copies it verbatim to the dist root, making
// it resolve at https://warlock.js.org/llms.txt and /<pkg>/llms.txt.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, "..");
const packagesRoot = join(docsRoot, "..");
const publicDir = join(docsRoot, "public");
const SITE = "https://warlock.js.org";

// Preferred reading order: foundations first, then subsystems, then AI, then
// tooling. Package membership itself comes from the workspace manifest below,
// so a newly added package cannot be silently omitted from the site routes.
const PACKAGE_ORDER = [
  "core",
  "cascade",
  "seal",
  "cache",
  "fs",
  "logger",
  "scheduler",
  "auth",
  "access",
  "context",
  "herald",
  "notifications",
  "web",
  "ai",
  "ai-openai",
  "ai-anthropic",
  "ai-google",
  "ai-bedrock",
  "ai-deepseek",
  "ai-groq",
  "ai-mistral",
  "ai-xai",
  "ai-ollama",
  "ai-live",
  "ai-tools",
  "ai-workspace",
  "ai-panoptic",
  "create-warlock",
];

/** Read the explicit package paths from the canonical pnpm workspace manifest. */
function readWorkspacePackagePaths() {
  const manifest = readFileSync(join(packagesRoot, "pnpm-workspace.yaml"), "utf8");
  const paths = [];
  let inPackages = false;

  for (const line of manifest.split(/\r?\n/)) {
    if (line === "packages:") {
      inPackages = true;
      continue;
    }

    if (inPackages && /^\S/.test(line)) {
      break;
    }

    const match = inPackages ? line.match(/^\s{2}-\s+['"]?([^'"]+)['"]?\s*$/) : null;
    if (match) {
      paths.push(match[1]);
    }
  }

  return paths;
}

const workspacePackages = readWorkspacePackagePaths()
  .map((workspace) => {
    const packageDir = join(packagesRoot, workspace);
    const manifestPath = join(packageDir, "package.json");

    if (!existsSync(manifestPath)) {
      return null;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      manifest.private === true ||
      (manifest.name !== "create-warlock" && !manifest.name?.startsWith("@warlock.js/"))
    ) {
      return null;
    }

    return workspace;
  })
  .filter(Boolean);
const orderIndex = new Map(PACKAGE_ORDER.map((pkg, index) => [pkg, index]));
const PACKAGES = workspacePackages.sort((a, b) => {
  const aIndex = orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
  const bIndex = orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
  return aIndex - bIndex || a.localeCompare(b);
});

/** Pull the human description line from a package llms.txt (the last `>` quote in the header). */
function readDescription(llms) {
  const quotes = llms
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("Package:"));

  return quotes[0] ?? "";
}

/** Keep generated site artifacts deterministic across Windows and Unix package checkouts. */
function normalizeNewlines(contents) {
  return contents.replace(/\r\n?/g, "\n");
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
let perPackageCount = 0;

for (const pkg of PACKAGES) {
  const pkgDir = join(packagesRoot, pkg);
  const llmsPath = join(pkgDir, "llms.txt");
  const fullPath = join(pkgDir, "llms-full.txt");

  if (!existsSync(llmsPath) || !existsSync(fullPath)) {
    throw new Error(`Missing llms source files for workspace package: ${pkg}`);
  }

  const llms = normalizeNewlines(readFileSync(llmsPath, "utf8"));
  const description = readDescription(llms);
  const scopedName = pkg === "create-warlock" ? "create-warlock" : `@warlock.js/${pkg}`;

  // Copy the package's own pair to public/<pkg>/ so it is fetchable on its own.
  const pkgPublicDir = join(publicDir, pkg);
  mkdirSync(pkgPublicDir, { recursive: true });
  writeFileSync(join(pkgPublicDir, "llms.txt"), llms);

  const hasFull = existsSync(fullPath);
  let full = "";

  if (hasFull) {
    full = normalizeNewlines(readFileSync(fullPath, "utf8")).trim();
    writeFileSync(join(pkgPublicDir, "llms-full.txt"), full);
    perPackageCount++;
  }

  // Point at BOTH the human docs and the package-scoped llms.txt — an index
  // that only lists doc URLs gives an agent no way to find the cheaper fetch.
  indexLines.push(
    `- [${scopedName}](${docUrl(pkg)}): ${description}` +
      `\n  - llms.txt: ${SITE}/${pkg}/llms.txt` +
      (hasFull ? `\n  - llms-full.txt: ${SITE}/${pkg}/llms-full.txt` : ""),
  );

  if (hasFull) {
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

Each package publishes its own \`llms.txt\` (index) and \`llms-full.txt\` (complete
text). **Prefer the package-scoped file** when you only need one package — the
combined \`llms-full.txt\` below is the whole framework and is far larger.

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
  `Generated public/llms.txt (${indexLines.length} packages) + public/llms-full.txt ` +
    `(${llmsFullTxt.length} bytes) + ${perPackageCount} per-package pair(s) under public/<pkg>/.`,
);
