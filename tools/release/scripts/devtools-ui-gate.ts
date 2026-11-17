/**
 * Release gate for the shipped devtools dashboard (`packages/devtools/ui/dashboard`).
 *
 * Checks, each problem collected:
 *   a. `build-info.json` exists and its source hash matches the current sources;
 *   b. every listed file still matches its recorded SHA-256 (catches hand edits);
 *   c. a fresh `vite build` into a temp directory is byte-identical to the shipped files;
 *   d. gzipped `app.js` + `app.css` fit the 300 KB budget.
 *
 * The fresh build is injectable (`build`) so specs can copy fixtures instead of
 * running Vite. The default build runs the package's local Vite binary with a
 * 10 minute timeout.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { dashboardSourceHash } from "../../../packages/devtools/ui-src/scripts/source-hash.mjs";
import {
  DASHBOARD_FILES,
  DASHBOARD_GZIP_BUDGET_BYTES,
} from "../../../packages/devtools/ui-src/scripts/write-build-info.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** The monorepo root (tools/release/scripts -> ../../..). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const BUILD_COMMAND = "pnpm --filter @warlock.js/devtools build:ui";
/** The files that count toward the gzip budget. */
const BUDGETED_FILES = ["assets/app.js", "assets/app.css"] as const;

const STALE_MESSAGE =
  "The shipped devtools dashboard is stale: its sources changed since the last build. " +
  `Run \`${BUILD_COMMAND}\` and commit ui/dashboard.`;

export type DevtoolsUiFileSize = { bytes: number; gzipBytes: number };

export type DevtoolsUiSizes = {
  /** Sizes of the shipped files that exist, keyed by their path in `ui/dashboard`. */
  files: Record<string, DevtoolsUiFileSize>;
  /** Gzipped `app.js` + `app.css`. */
  gzipBytes: number;
  budgetGzipBytes: number;
};

export type DevtoolsUiGateResult = {
  ok: boolean;
  problems: string[];
  sizes: DevtoolsUiSizes;
};

export interface DevtoolsUiGateOptions {
  /** The monorepo root. Defaults to this checkout. */
  repoRoot?: string;
  /** Produces a fresh build into `outDir`. Defaults to the package's local Vite. */
  build?: (outDir: string) => Promise<void>;
}

type BuildInfo = { sourceHash: string; files: Record<string, { sha256: string }> };

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readOrUndefined(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch {
    return undefined;
  }
}

function isBuildInfo(value: unknown): value is BuildInfo {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { sourceHash?: unknown; files?: unknown };
  if (typeof candidate.sourceHash !== "string") return false;
  if (typeof candidate.files !== "object" || candidate.files === null) return false;
  return Object.values(candidate.files).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { sha256?: unknown }).sha256 === "string",
  );
}

async function readBuildInfo(shippedDir: string): Promise<BuildInfo | undefined> {
  const raw = await readOrUndefined(path.join(shippedDir, "build-info.json"));
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    return isBuildInfo(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** One line for the operator: the gzipped sizes against the budget. */
export function formatDevtoolsUiSummary(sizes: DevtoolsUiSizes): string {
  const parts = BUDGETED_FILES.filter((file) => sizes.files[file] !== undefined).map(
    (file) => `${file.slice("assets/".length)} ${kilobytes(sizes.files[file]?.gzipBytes ?? 0)}`,
  );
  return (
    `devtools dashboard: ${kilobytes(sizes.gzipBytes)} gzipped` +
    (parts.length > 0 ? ` (${parts.join(", ")})` : "") +
    ` of ${kilobytes(sizes.budgetGzipBytes)} budget`
  );
}

/** Runs the package's local Vite binary; rejects with the output tail on failure or after 10 minutes. */
async function buildWithLocalVite(packageDir: string, outDir: string): Promise<void> {
  const requireFromPackage = createRequire(path.join(packageDir, "package.json"));
  const vitePackagePath = requireFromPackage.resolve("vite/package.json");
  const vitePackage = JSON.parse(await readFile(vitePackagePath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const binRelative = typeof vitePackage.bin === "string" ? vitePackage.bin : vitePackage.bin?.vite;
  if (binRelative === undefined) throw new Error("The local vite package has no bin entry.");
  const viteBin = path.resolve(path.dirname(vitePackagePath), binRelative);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [viteBin, "build", "--config", "ui-src/vite.config.ts", "--outDir", outDir, "--emptyOutDir"],
      { cwd: packageDir, stdio: ["ignore", "pipe", "pipe"], timeout: BUILD_TIMEOUT_MS },
    );
    let output = "";
    const keepTail = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-4000);
    };
    child.stdout.on("data", keepTail);
    child.stderr.on("data", keepTail);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason =
        signal === "SIGTERM"
          ? "did not finish within 10 minutes"
          : `exited with ${code ?? signal}`;
      reject(new Error(`vite build ${reason}:\n${output.trim()}`));
    });
  });
}

/**
 * Runs the four checks against the package under `repoRoot`. Never throws for a
 * stale or broken bundle; those are `problems`.
 */
export async function runDevtoolsUiGate(
  options: DevtoolsUiGateOptions = {},
): Promise<DevtoolsUiGateResult> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const packageDir = path.join(repoRoot, "packages", "devtools");
  const shippedDir = path.join(packageDir, "ui", "dashboard");
  const problems: string[] = [];

  const buildInfo = await readBuildInfo(shippedDir);
  const currentHash = await dashboardSourceHash(packageDir);

  // a. The recorded source hash matches the sources.
  if (buildInfo === undefined || buildInfo.sourceHash !== currentHash) {
    problems.push(STALE_MESSAGE);
  }

  // b. Each shipped file matches its recorded hash.
  for (const file of DASHBOARD_FILES) {
    const record = buildInfo?.files[file];
    if (buildInfo !== undefined && record === undefined) {
      problems.push(`build-info.json does not list ${file}. Run \`${BUILD_COMMAND}\` and commit ui/dashboard.`);
      continue;
    }
    if (record === undefined) continue;
    const shipped = await readOrUndefined(path.join(shippedDir, file));
    if (shipped === undefined || sha256(shipped) !== record.sha256) {
      problems.push(
        `${file} does not match its hash in build-info.json: it was edited by hand or is missing. ` +
          `Run \`${BUILD_COMMAND}\` and commit ui/dashboard.`,
      );
    }
  }

  // c. A fresh build reproduces the shipped files byte for byte.
  const freshDir = await mkdtemp(path.join(tmpdir(), "devtools-ui-gate-"));
  try {
    const build = options.build ?? ((outDir: string) => buildWithLocalVite(packageDir, outDir));
    try {
      await build(freshDir);
      const differing: string[] = [];
      for (const file of DASHBOARD_FILES) {
        const fresh = await readOrUndefined(path.join(freshDir, file));
        const shipped = await readOrUndefined(path.join(shippedDir, file));
        if (fresh === undefined) {
          problems.push(`The fresh build of the devtools dashboard did not produce ${file}.`);
        } else if (shipped === undefined || !fresh.equals(shipped)) {
          differing.push(file);
        }
      }
      if (differing.length > 0) {
        problems.push(
          `The shipped devtools dashboard does not match a fresh build of its sources: ${differing.join(", ")} differ. ` +
            `Run \`${BUILD_COMMAND}\` and commit ui/dashboard.`,
        );
      }
    } catch (error) {
      problems.push(
        `The fresh build of the devtools dashboard failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    await rm(freshDir, { recursive: true, force: true });
  }

  // d. The gzipped bundle fits the budget.
  const files: Record<string, DevtoolsUiFileSize> = {};
  for (const file of DASHBOARD_FILES) {
    const content = await readOrUndefined(path.join(shippedDir, file));
    if (content !== undefined) {
      files[file] = { bytes: content.length, gzipBytes: gzipSync(content, { level: 9 }).length };
    }
  }
  const gzipBytes = BUDGETED_FILES.reduce((sum, file) => sum + (files[file]?.gzipBytes ?? 0), 0);
  const sizes: DevtoolsUiSizes = { files, gzipBytes, budgetGzipBytes: DASHBOARD_GZIP_BUDGET_BYTES };
  if (gzipBytes > DASHBOARD_GZIP_BUDGET_BYTES) {
    const perFile = BUDGETED_FILES.filter((file) => files[file] !== undefined)
      .map((file) => `${file} ${kilobytes(files[file]?.gzipBytes ?? 0)}`)
      .join(", ");
    problems.push(
      `The devtools dashboard is ${kilobytes(gzipBytes)} gzipped, over the 300 KB budget. ` +
        `Remove a dependency or split less-used views. (${perFile})`,
    );
  }

  return { ok: problems.length === 0, problems, sizes };
}

async function main(): Promise<number> {
  const result = await runDevtoolsUiGate();
  console.log(formatDevtoolsUiSummary(result.sizes));
  for (const problem of result.problems) console.error(`  - ${problem}`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename)
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
