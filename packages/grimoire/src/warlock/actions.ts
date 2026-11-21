/**
 * What `warlock grimoire …` and `warlock scry …` do, as functions that write
 * to an `io` and return the exit code, so specs run them without a process.
 * Loaded lazily by the commands: it pulls in every Grimoire module.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { checkGrimoire, formatCheckReport } from "../check";
import { createFinding, explainGrimoireCode, GrimoireError } from "../codes";
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireCheckReport, GrimoireFinding } from "../contracts/findings";
import type { ScryQuery, ScryResult } from "../contracts/scry";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { loadBook } from "../book";
import { projectPath } from "../paths";
import { writeRelease } from "../releases";
import { formatScryResult, parseScryQuery, scry } from "../scry";
import { runGrimoire, type GrimoireRun } from "../workspace";
import { openStoredGrimoireCached } from "../workspace/cache";
import { parseGrimoire } from "../written";

/** Where a command writes: `out` for its answer, `err` for problems. */
export type CommandIO = {
  out(line: string): void;
  err(line: string): void;
};

/** The project and adapter a command runs against. */
export type CommandContext = {
  /** Absolute project root. */
  root: string;
  adapter: BookAdapter;
  io: CommandIO;
};

type Options = Readonly<Record<string, string | boolean | number>>;

const plural = (count: number, word: string, many = `${word}s`): string =>
  `${count} ${count === 1 ? word : many}`;

/** Print a Grimoire error the way every command does, and return exit code 1. */
export function reportError(io: CommandIO, error: unknown): number {
  if (error instanceof GrimoireError) {
    io.err(`${error.code}  ${error.message}`);

    const fix = explainGrimoireCode(error.code)?.fix;

    if (fix) io.err(`  fix: ${fix}`);

    return 1;
  }

  throw error;
}

function printJson(io: CommandIO, value: unknown): void {
  io.out(JSON.stringify(value, null, 2));
}

/**
 * Open with fresh routes; when the app does not boot (`GR8002`), open again
 * with the cached ones and return the boot problem as a warning finding.
 */
async function withFreshRoutes<T>(
  open: (routes: "fresh" | "cached") => Promise<T>,
): Promise<{ value: T; bootProblem: GrimoireFinding | null }> {
  try {
    return { value: await open("fresh"), bootProblem: null };
  } catch (error) {
    if (!(error instanceof GrimoireError) || error.code !== "GR8002") throw error;

    return {
      value: await open("cached"),
      // Finding messages start lower-case, like every other line of the check report.
      bootProblem: createFinding({
        code: "GR8002",
        message: `${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}`,
      }),
    };
  }
}

/** sha256 of a project file, `""` when it is missing (the book's boot-cache rule). */
async function inputHash(root: string, file: string): Promise<string> {
  try {
    return createHash("sha256")
      .update(await readFile(path.join(root, ...file.split("/"))))
      .digest("hex");
  } catch {
    return "";
  }
}

/** File names whose appearance makes the route facts stale: routes files and named mails, jobs, events, notifications. */
const BOOT_INPUT = /^(?:routes|.+\.(?:mail|job|event|notification))\.[cm]?[jt]sx?$/;

/** Every boot-cache candidate under `src/`: a new one makes the route facts stale. */
async function routesFiles(root: string, dir = "src"): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(path.join(root, ...dir.split("/")), { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const file = `${dir}/${entry.name}`;

    if (entry.isDirectory()) found.push(...(await routesFiles(root, file)));
    else if (
      BOOT_INPUT.test(entry.name) ||
      (file.startsWith("src/config/") && /\.[cm]?[jt]sx?$/.test(entry.name))
    )
      found.push(file);
  }

  return found;
}

/**
 * Whether `build` or `check` will have to boot the app: `force`, no book, no
 * route facts yet, or a route-cache input changed, appeared or went away.
 * Reads files only and never calls the adapter, so it runs before anything
 * is loaded.
 */
export async function needsBoot(root: string, force: boolean): Promise<boolean> {
  if (force) return true;

  const book = await loadBook(root);

  if (!book || book.facts.routes === null || book.manifest.boot.collectedAt === null) return true;

  const inputs = book.manifest.boot.inputs;

  for (const [file, hash] of Object.entries(inputs)) {
    if ((await inputHash(root, file)) !== hash) return true;
  }

  return (await routesFiles(root)).some((file) => inputs[file] === undefined);
}

/** Whether the app has several sites, whose page routes need `src/config/web.ts` loaded. */
export async function isMultiSite(root: string): Promise<boolean> {
  try {
    return (await readdir(path.join(root, "src", "web", "$sites"), { withFileTypes: true })).some(
      (entry) => entry.isDirectory(),
    );
  } catch {
    return false;
  }
}

function buildSummary(run: GrimoireRun): { book: string; collected: string } {
  const snapshot = run.snapshot;
  const tasks = snapshot.collected.tasksIndex;
  const bookmaps = run.collected.written.filter((file) => file.endsWith("bookmap.json")).length;
  const nothing =
    !run.rebuilt &&
    run.book.written.length +
      run.book.removed.length +
      run.collected.written.length +
      run.collected.removed.length ===
      0;
  const book = nothing
    ? "book      up to date"
    : `book      ${plural(snapshot.book.facts.files.length, "file")} (${run.book.written.length} written, ${run.book.removed.length} removed), routes ${snapshot.routes}`;

  return {
    book,
    // `waiting` is a part of `open`: count each task once, as the devtools tab does.
    collected: `features  ${snapshot.collected.featuresIndex.features.length} (bookmaps written: ${bookmaps})   tasks  ${tasks.open.length - tasks.waiting.length} open, ${tasks.waiting.length} waiting, ${tasks.done.length} done`,
  };
}

/**
 * The `--out` folder of the static site, project-relative. A folder outside
 * the project, or the project itself (its own `index.html`), is refused.
 */
function siteFolder(root: string, out: string): string {
  const folder = projectPath(root, out.trim());

  if (
    out.trim() === "" ||
    folder === "" ||
    folder === ".." ||
    folder.startsWith("../") ||
    path.isAbsolute(folder)
  ) {
    throw new GrimoireError(
      "GR9006",
      `--out ${JSON.stringify(out)} is not a folder inside the project. Pass a project-relative folder, like --out public/grimoire.`,
    );
  }

  return folder;
}

/** `time      4.2s`, the last line of `build` and `check`. */
function elapsedLine(started: number): string {
  return `time      ${((Date.now() - started) / 1000).toFixed(1)}s`;
}

/** `warlock grimoire build [--force] [--site [--product] [--out <dir>]] [--json]`. */
export async function runBuild(context: CommandContext, options: Options = {}): Promise<number> {
  const { root, adapter, io } = context;
  const started = Date.now();

  try {
    const force = options.force === true;
    const outDir = typeof options.out === "string" ? siteFolder(root, options.out) : undefined;
    const { value: run, bootProblem } = await withFreshRoutes((routes) =>
      runGrimoire(root, adapter, { routes, force }),
    );
    let site: string | null = null;
    let siteUpToDate = false;

    if (options.site === true || options.product === true || typeof options.out === "string") {
      const { exportGrimoireSiteDetailed } = await import("../devtools");
      // A page built from the same book is kept; --force writes it again.
      const exported = await exportGrimoireSiteDetailed(root, {
        adapter,
        snapshot: run.snapshot,
        force,
        ...(options.product === true ? { product: true } : {}),
        ...(outDir === undefined ? {} : { outDir }),
      });

      site = exported.outDir;
      siteUpToDate = exported.upToDate;
    }

    if (options.json === true) {
      printJson(io, {
        rebuilt: run.rebuilt,
        changed: run.changed,
        written: [...run.book.written, ...run.collected.written],
        removed: [...run.book.removed, ...run.collected.removed],
        routes: run.snapshot.routes,
        site,
        siteUpToDate,
        siteMode: site === null ? null : options.product === true ? "product" : "full",
        problems: bootProblem === null ? [] : [bootProblem],
      });

      return 0;
    }

    const summary = buildSummary(run);

    // The app's own boot output comes before this point; the summary is always the last lines.
    if (bootProblem !== null) {
      io.err(`${bootProblem.code}  ${bootProblem.message}`);
      io.err(`  fix: ${bootProblem.hint}`);
    }

    io.out(summary.book);
    io.out(summary.collected);

    if (site !== null) {
      io.out(
        `site      ${site}/index.html${options.product === true ? " (product map only)" : ""}${siteUpToDate ? " (up to date, not rebuilt)" : ""}`,
      );
    }

    io.out(elapsedLine(started));

    return 0;
  } catch (error) {
    return reportError(io, error);
  }
}

/** Add a boot problem to a check report as an unexpected warning. */
function withProblem(
  report: GrimoireCheckReport,
  problem: GrimoireFinding | null,
): GrimoireCheckReport {
  if (problem === null) return report;

  const firstExpected = report.findings.findIndex((finding) => finding.expected);
  const findings = [...report.findings];

  findings.splice(firstExpected === -1 ? findings.length : firstExpected, 0, problem);

  return {
    ...report,
    findings,
    counts: { ...report.counts, warnings: report.counts.warnings + 1 },
  };
}

/** `warlock grimoire check [--all] [--json]`: exit 1 only when the report is not ok. */
export async function runCheck(context: CommandContext, options: Options = {}): Promise<number> {
  const { root, adapter, io } = context;
  const started = Date.now();

  try {
    const { value: run, bootProblem } = await withFreshRoutes((routes) =>
      runGrimoire(root, adapter, { routes }),
    );
    const report = withProblem(checkGrimoire(run.snapshot), bootProblem);

    if (options.json === true) printJson(io, report);
    else {
      for (const line of formatCheckReport(report, { all: options.all === true })) io.out(line);

      // The app's own boot output comes before the report; the summary is always the last lines.
      io.out(buildSummary(run).book);
      io.out(elapsedLine(started));
    }

    return report.ok ? 0 : 1;
  } catch (error) {
    return reportError(io, error);
  }
}

/** `warlock grimoire release <release> [--json]`. */
export async function runRelease(
  context: CommandContext,
  release: string | undefined,
  options: Options = {},
): Promise<number> {
  const { root, io } = context;

  try {
    const name = release?.trim() ?? "";

    if (name === "" || /[\\/]/.test(name) || name.startsWith(".")) {
      throw new GrimoireError(
        "GR9006",
        `Pass the release name, like warlock grimoire release 1.1.0 (got ${JSON.stringify(release ?? "")}). It must match a file in grimoire/releases/.`,
      );
    }

    const { written } = await parseGrimoire(root);
    const outcome = await writeRelease(root, written, name);

    if (options.json === true) {
      printJson(io, outcome);
      return 0;
    }

    const entries = outcome.collection.entries;
    const listed = entries
      .map((entry) => `${entry.feature} ${entry.version} ${entry.word}`)
      .join(", ");

    io.out(
      `${outcome.file}: ${plural(entries.length, "entry", "entries")} collected${
        entries.length > 0 ? ` (${listed})` : ""
      }${outcome.changed ? "" : ", file unchanged"}`,
    );

    const unreleased = outcome.unreleased;

    if (unreleased.length > 0) {
      const names = unreleased.map((entry) => `${entry.feature} ${entry.version}`).join(", ");
      const verb = unreleased.length === 1 ? "entry is" : "entries are";

      io.out(
        `note: ${unreleased.length} ${verb} still unreleased: ${names}. To ship them in ${name}, move them under "## ${name} (${outcome.collection.date})" in each feature's CHANGELOG.md and run this command again.`,
      );
    }

    return 0;
  } catch (error) {
    return reportError(io, error);
  }
}

/** Open the snapshot for a scry question: the stored book, read only (`GR9007` when it was never built). */
async function openForScry(root: string, adapter: BookAdapter): Promise<GrimoireSnapshot> {
  return openStoredGrimoireCached(root, adapter);
}

/** Answer a parsed query (shared by the CLI and the MCP tools). */
export async function answer(
  root: string,
  adapter: BookAdapter,
  query: ScryQuery,
): Promise<ScryResult> {
  return scry(await openForScry(root, adapter), query);
}

/** `warlock scry <file> | --impact … | --route … | --feature … | --flow … | --search … [--limit n] [--all] [--json]`. */
export async function runScry(
  context: CommandContext,
  args: readonly string[],
  options: Options = {},
): Promise<number> {
  const { root, adapter, io } = context;

  try {
    const query = parseScryQuery(args, options);
    const result = await answer(root, adapter, query);

    if (options.json === true) printJson(io, result);
    else for (const line of formatScryResult(result, { all: options.all === true })) io.out(line);

    return 0;
  } catch (error) {
    return reportError(io, error);
  }
}
