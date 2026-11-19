import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type GitRunner, runGit } from "./changed-files";

/** What `warlock check` remembers about the last full test run. */
export type TestRecord = {
  /** Content hash of the working tree (see {@link treeHash}). */
  treeHash: string;
  /** When the run finished, ISO 8601. */
  finishedAt: string;
  /** How long the run took, in milliseconds. */
  durationMs: number;
  /** Whether every test passed. Only a passing record is reused. */
  success: boolean;
  /** Number of tests, when known. */
  total: number | null;
};

/** Where a vitest JSON report is looked for when `--test-report` is not given. */
export const DEFAULT_TEST_REPORT = "node_modules/.cache/warlock/vitest-report.json";

/** The environment variable that points at the vitest JSON report. */
export const TEST_REPORT_ENV = "WARLOCK_CHECK_TEST_REPORT";

function recordFile(cwd: string): string {
  return path.join(cwd, "node_modules", ".cache", "warlock", "check-tests.json");
}

/** What {@link treeHash} measured. */
export type TreeHash = {
  hash: string;
  /** Newest mtime among the hashed files, their folders and linked packages. */
  newestMtimeMs: number;
  /** The tracked (and untracked, not ignored) files, relative, sorted. */
  files: string[];
};

const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** Symlinked packages in `node_modules` (workspace links), as `[name, real path]`. */
function linkedPackages(cwd: string): Array<[string, string]> {
  const modules = path.join(cwd, "node_modules");
  const found: Array<[string, string]> = [];

  const visit = (directory: string, prefix: string) => {
    let entries: string[];

    try {
      entries = readdirSync(directory).sort();
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;

      const absolute = path.join(directory, entry);

      try {
        if (entry.startsWith("@") && !prefix) {
          visit(absolute, `${entry}/`);
          continue;
        }

        const real = realpathSync(absolute);

        if (real !== absolute && !real.startsWith(`${path.join(cwd, "node_modules")}${path.sep}`)) {
          found.push([`${prefix}${entry}`, real]);
        }
      } catch {
        // A broken link is not part of the tree.
      }
    }
  };

  visit(modules, "");

  return found;
}

/**
 * A content hash of the tree the tests ran against: every tracked and
 * untracked-but-not-ignored file (so the lockfile is included), by path and
 * content, plus what git ignores but a run still reads: the `.env*` files at
 * the project root, and each linked (symlinked) package in `node_modules` by
 * its real path, `package.json` content and the names, sizes and mtimes of its
 * top-level entries. `null` when git cannot list the files, which turns reuse off.
 */
export async function treeHash(cwd: string, git: GitRunner = runGit): Promise<TreeHash | null> {
  const listed = await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd);

  if (listed.code !== 0) return null;

  const tracked = [...new Set(listed.stdout.split("\0").filter((file) => file.length > 0))].sort();
  const hash = createHash("sha256");
  const folders = new Set<string>([cwd]);
  const files: string[] = [];
  let newestMtimeMs = 0;

  const addFile = (file: string, label: string) => {
    const absolute = path.join(cwd, file);

    try {
      const stat = statSync(absolute);

      if (!stat.isFile()) return false;

      newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
      hash.update(label);
      hash.update(file);
      hash.update("\0");
      hash.update(readFileSync(absolute));
      hash.update("\0");

      return true;
    } catch {
      // A file deleted since the listing is simply not part of the tree.
      return false;
    }
  };

  for (const file of tracked) {
    if (!addFile(file, "")) continue;

    files.push(file);
    folders.add(path.dirname(path.join(cwd, file)));
  }

  let rootEntries: string[] = [];

  try {
    rootEntries = readdirSync(cwd).sort();
  } catch {
    // Unreadable root: nothing extra to hash.
  }

  for (const entry of rootEntries) {
    if (entry.startsWith(".env") && !files.includes(entry)) addFile(entry, "env:");
  }

  for (const [name, real] of linkedPackages(cwd)) {
    hash.update(`link:${name}=${real}\0`);

    try {
      hash.update(readFileSync(path.join(real, "package.json")));
      hash.update("\0");

      for (const entry of readdirSync(real).sort()) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;

        const stat = statSync(path.join(real, entry));

        newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
        hash.update(`${entry}:${stat.size}:${Math.round(stat.mtimeMs)}\0`);
      }
    } catch {
      // A link without a readable package is hashed by its path alone.
    }
  }

  // A deleted or renamed file changes its folder's mtime, not any file's.
  for (const folder of folders) {
    try {
      newestMtimeMs = Math.max(newestMtimeMs, statSync(folder).mtimeMs);
    } catch {
      // Folder gone: the file list already changed the hash.
    }
  }

  hash.update(`files:${files.length}`);

  return { hash: hash.digest("hex"), newestMtimeMs, files };
}

/** The last recorded full run, or `null`. */
export function readTestRecord(cwd: string): TestRecord | null {
  try {
    const value: unknown = JSON.parse(readFileSync(recordFile(cwd), "utf8"));

    if (typeof value !== "object" || value === null) return null;

    const {
      treeHash: hash,
      finishedAt,
      durationMs,
      success,
      total,
    } = value as Record<string, unknown>;

    if (
      typeof hash !== "string" ||
      typeof finishedAt !== "string" ||
      typeof durationMs !== "number" ||
      typeof success !== "boolean"
    ) {
      return null;
    }

    return {
      treeHash: hash,
      finishedAt,
      durationMs,
      success,
      total: typeof total === "number" ? total : null,
    };
  } catch {
    return null;
  }
}

/** Remember a full run. Skipped silently when the app has no `node_modules`. */
export function writeTestRecord(cwd: string, record: TestRecord): void {
  try {
    if (!existsSync(path.join(cwd, "node_modules"))) return;

    mkdirSync(path.dirname(recordFile(cwd)), { recursive: true });
    writeFileSync(recordFile(cwd), `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // A record that cannot be written only means the next run is not skipped.
  }
}

/** A recorded result that may stand in for a run. */
export type ReusableResult = {
  finishedAt: string;
  durationMs: number;
  total: number | null;
  source: string;
};

/**
 * A recorded passing result for exactly this tree, or `null`.
 *
 * Two sources, in this order: the record `warlock check` wrote after a full
 * run with the same tree hash, and a vitest JSON report the app wrote itself
 * (`vitest run --reporter=json --outputFile=<report>`). A report has no tree
 * hash, so it counts only when it passed, is newer than the newest file and
 * folder of the tree (a deleted or renamed file touches its folder), lists
 * every spec file of the tree, and lists no spec file that is gone; the tree
 * hash is then recorded for it. A record of a failed run for the same tree
 * is never overruled by a report.
 */
export function findReusableResult(options: {
  cwd: string;
  tree: { hash: string; newestMtimeMs: number; files?: string[] };
  reportPath?: string;
}): ReusableResult | null {
  const record = readTestRecord(options.cwd);

  if (record?.treeHash === options.tree.hash) {
    // The same tree already failed: never let a report overrule that.
    if (!record.success) return null;

    return {
      finishedAt: record.finishedAt,
      durationMs: record.durationMs,
      total: record.total,
      source: "an earlier `warlock check`",
    };
  }

  const reportFile = path.resolve(options.cwd, options.reportPath ?? DEFAULT_TEST_REPORT);

  try {
    const stat = statSync(reportFile);
    const report: unknown = JSON.parse(readFileSync(reportFile, "utf8"));

    if (typeof report !== "object" || report === null) return null;

    const { success, numTotalTests, startTime, testResults } = report as Record<string, unknown>;

    if (success !== true || stat.mtimeMs < options.tree.newestMtimeMs) return null;
    if (!Array.isArray(testResults)) return null;

    const reported = new Set<string>();

    for (const suite of testResults) {
      const name = (suite as { name?: unknown } | null)?.name;

      if (typeof name === "string") reported.add(path.resolve(options.cwd, name));
    }

    const specs = (options.tree.files ?? []).filter((file) => SPEC_FILE.test(file));

    // A partial run (`vitest run one.spec.ts`) leaves specs out.
    if (specs.some((file) => !reported.has(path.resolve(options.cwd, file)))) return null;

    // A reported spec inside the project that no longer exists was deleted.
    for (const name of reported) {
      if (name.startsWith(`${options.cwd}${path.sep}`) && !existsSync(name)) return null;
    }

    const finishedAt = new Date(stat.mtimeMs).toISOString();
    const durationMs = typeof startTime === "number" ? Math.max(0, stat.mtimeMs - startTime) : 0;
    const total = typeof numTotalTests === "number" ? numTotalTests : null;

    writeTestRecord(options.cwd, {
      treeHash: options.tree.hash,
      finishedAt,
      durationMs,
      success: true,
      total,
    });

    return { finishedAt, durationMs, total, source: path.relative(options.cwd, reportFile) };
  } catch {
    return null;
  }
}
