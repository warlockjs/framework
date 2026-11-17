/**
 * The source hash of the production dashboard: SHA-256 over the sources that
 * decide what `vite build` produces. `write-build-info.mjs` stores it in
 * `ui/dashboard/build-info.json`; the release gate
 * (`tools/release/scripts/devtools-ui-gate.ts`) recomputes it and fails when
 * the shipped bundle was built from other sources.
 *
 * Covered: every file under `ui-src/` except `ui-src/tests/**`,
 * `ui-src/scripts/**` and `ui-src/README.md`; `src/production/contracts.ts`
 * (the UI imports it); and the versions of the UI dependencies listed in
 * `package.json` `devDependencies`. Line endings are normalised to LF, so a
 * checkout with CRLF gives the same hash.
 *
 * Plain Node, no dependencies.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** The UI dependencies whose versions change the build output. */
export const DASHBOARD_BUILD_DEPENDENCIES = [
  "@simplewebauthn/browser",
  "@tailwindcss/vite",
  "@vitejs/plugin-react",
  "class-variance-authority",
  "clsx",
  "lucide-react",
  "radix-ui",
  "react",
  "react-dom",
  "tailwind-merge",
  "tailwindcss",
  "uqr",
  "vite",
];

/** Paths under `ui-src/` that do not affect the built bundle, relative to `ui-src/`. */
const EXCLUDED_UI_DIRECTORIES = ["tests", "scripts"];
const EXCLUDED_UI_FILES = ["README.md"];

/** Every file under `directory` as a posix path relative to `packageDir`. */
async function listFiles(packageDir, directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(packageDir, absolute)));
    } else if (entry.isFile()) {
      files.push(path.relative(packageDir, absolute).split(path.sep).join("/"));
    }
  }
  return files;
}

/** True when a `ui-src/...` path (relative to the package) feeds the build. */
function isBuildInput(relativePath) {
  const inUi = relativePath.slice("ui-src/".length);
  const [first] = inUi.split("/");
  if (inUi.includes("/") && EXCLUDED_UI_DIRECTORIES.includes(first)) return false;
  return !EXCLUDED_UI_FILES.includes(inUi);
}

/**
 * The hash for the package at `packageDir` (the `packages/devtools` folder).
 * Throws when `package.json`, `src/production/contracts.ts` or `ui-src/` is
 * missing: the hash must never silently cover less than the sources.
 */
export async function dashboardSourceHash(packageDir) {
  const uiFiles = (await listFiles(packageDir, path.join(packageDir, "ui-src"))).filter(
    isBuildInput,
  );
  const inputs = [...uiFiles, "src/production/contracts.ts"].sort();

  const hash = createHash("sha256");
  for (const relativePath of inputs) {
    const content = (await readFile(path.join(packageDir, relativePath), "utf8")).replace(
      /\r\n/g,
      "\n",
    );
    hash.update(`${relativePath}\0${content}\0`);
  }

  const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  const devDependencies = manifest.devDependencies ?? {};
  const pinned = DASHBOARD_BUILD_DEPENDENCIES.filter((name) => name in devDependencies)
    .sort()
    .map((name) => [name, devDependencies[name]]);
  hash.update(`devDependencies\0${JSON.stringify(pinned)}\0`);

  return hash.digest("hex");
}
