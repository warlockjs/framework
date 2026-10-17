import glob from "fast-glob";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectPackageManager, getInstallCommand } from "../updater/package-manager";
import { CODEMODS } from "./codemods";
import { unifiedDiff } from "./diff";
import { loadTsMorph } from "./load-ts-morph";
import { UPGRADE_NOTES } from "./notes";
import type {
  AppliedChange,
  Codemod,
  CodemodContext,
  ManualItem,
  SourceEdit,
  SourceFile,
  TextFiles,
  TsMorphModule,
  UpgradeResult,
} from "./types";
import { compareVersions, normalizeVersion, parseVersion } from "./version";

export type RunUpgradeOptions = {
  /** App root. Defaults to the current directory. */
  root?: string;
  /** Target version, e.g. `5.31` or `5.31.0`. */
  to: string;
  /** Version upgrading from; detected from the installed `@warlock.js/core` when omitted. */
  from?: string;
  /** Compute and report everything, write nothing. */
  dryRun?: boolean;
  /** Override the codemod list (tests). */
  codemods?: readonly Codemod[];
  /** Override how ts-morph is loaded (tests). */
  loadTsMorph?: (root: string) => Promise<TsMorphModule>;
};

/** Thrown for a request the command cannot act on (bad versions, nothing to detect). */
export class UpgradeUsageError extends Error {
  public override readonly name = "UpgradeUsageError";
}

/**
 * Apply the mechanical edits for every breaking change between two releases
 * and list what needs a decision. Writes nothing with `dryRun`.
 */
export async function runUpgrade(options: RunUpgradeOptions): Promise<UpgradeResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const to = toVersion(options.to);
  const from = options.from ? toVersion(options.from) : detectInstalledVersion(root);

  if (compareVersions(from, to) >= 0) {
    throw new UpgradeUsageError(notNewerMessage(from, to, options.from !== undefined));
  }

  const selected = (options.codemods ?? CODEMODS).filter(
    (codemod) =>
      codemod.version === "target" ||
      (compareVersions(codemod.version, from) > 0 && compareVersions(codemod.version, to) <= 0),
  );

  const tsMorph = await (options.loadTsMorph ?? loadTsMorph)(root);
  const project = new tsMorph.Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { jsx: tsMorph.ts.JsxEmit.Preserve, allowJs: false },
  });

  const relativePaths = await glob("src/**/*.{ts,tsx}", {
    cwd: root,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.warlock/**", "**/*.d.ts"],
    dot: false,
  });
  relativePaths.sort();

  const originals = new Map<string, string>();
  const sourceFiles: SourceFile[] = [];
  for (const relative of relativePaths) {
    const content = readFileSync(path.join(root, relative), "utf8");
    originals.set(relative, content);
    sourceFiles.push(
      project.createSourceFile(path.join(root, relative), content, { overwrite: true }),
    );
  }

  const relativeOf = new Map<SourceFile, string>(
    sourceFiles.map((sourceFile, index) => [sourceFile, relativePaths[index] ?? ""]),
  );

  const applied: AppliedChange[] = [];
  const manual: ManualItem[] = [];
  const textFiles = createTextFiles(root);
  let activeCodemod: Codemod | undefined;

  const text: TextFiles = {
    read: (file) => textFiles.read(file),
    write: (file, content, change) => {
      textFiles.write(file, content);
      if (activeCodemod) {
        applied.push({ codemod: activeCodemod.id, file, ...change });
      }
    },
  };

  const context: CodemodContext = {
    tsMorph,
    sourceFiles,
    relativePath: (sourceFile) =>
      relativeOf.get(sourceFile) ??
      path.relative(root, sourceFile.getFilePath()).split(path.sep).join("/"),
    text,
    targetVersion: to,
  };

  const summary: UpgradeResult["codemods"] = [];

  for (const codemod of selected) {
    activeCodemod = codemod;
    const appliedBefore = applied.length;
    const output = codemod.run(context);

    for (const finding of output.manual) {
      manual.push({ ...finding, codemod: codemod.id, skill: codemod.skill });
    }

    const byFile = new Map<string, SourceEdit[]>();
    for (const edit of output.edits) {
      const list = byFile.get(edit.file) ?? [];
      list.push(edit);
      byFile.set(edit.file, list);
    }

    for (const [file, edits] of byFile) {
      const sourceFile = sourceFiles[relativePaths.indexOf(file)];
      if (!sourceFile) continue;

      let content = sourceFile.getFullText();
      let lowestStart = Number.POSITIVE_INFINITY;
      for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
        // Overlapping edits (one inside another) would corrupt the file: keep the outer one.
        if (edit.end > lowestStart) {
          manual.push({
            codemod: codemod.id,
            skill: codemod.skill,
            file,
            line: edit.line,
            hint: `Not edited automatically (overlaps another change): ${edit.description}. Run the upgrade again after reviewing.`,
          });
          continue;
        }
        content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
        lowestStart = edit.start;
        applied.push({ codemod: codemod.id, file, line: edit.line, description: edit.description });
      }

      sourceFile.replaceWithText(content);
    }

    summary.push({
      id: codemod.id,
      version: codemod.version === "target" ? to : codemod.version,
      title: codemod.title,
      applied: applied.length - appliedBefore,
      manual: manual.filter((item) => item.codemod === codemod.id).length,
    });
  }
  activeCodemod = undefined;

  applied.sort(byFileAndLine);
  manual.sort(byFileAndLine);

  const changes: { file: string; before: string; after: string }[] = [];
  sourceFiles.forEach((sourceFile, index) => {
    const file = relativePaths[index];
    if (file === undefined) return;
    const before = originals.get(file) ?? "";
    const after = sourceFile.getFullText();
    if (before !== after) changes.push({ file, before, after });
  });
  for (const change of textFiles.changes()) changes.push(change);
  changes.sort((left, right) => left.file.localeCompare(right.file));

  if (!options.dryRun) {
    for (const change of changes) writeFileSync(path.join(root, change.file), change.after);
  }

  const packageJsonChanged = changes.some(
    (change) =>
      change.file === "package.json" &&
      applied.some((item) => item.codemod === "warlock-versions" && item.file === "package.json"),
  );

  return {
    from,
    to,
    dryRun: options.dryRun === true,
    codemods: summary,
    applied,
    manual,
    notes: UPGRADE_NOTES.filter(
      (note) => compareVersions(note.version, from) > 0 && compareVersions(note.version, to) <= 0,
    ),
    changedFiles: changes.map((change) => change.file),
    diff: changes.map((change) => unifiedDiff(change.file, change.before, change.after)).join(""),
    ...(packageJsonChanged && {
      installHint: getInstallCommand(await detectPackageManager(root)),
    }),
  };
}

/**
 * Explain why `--to` is not newer than the starting version. The usual cause
 * is running the command after installing the new release: the starting
 * version is read from the installed `@warlock.js/core`, which is then already
 * the target, so the command needs `--from`.
 */
function notNewerMessage(from: string, to: string, fromWasPassed: boolean): string {
  if (fromWasPassed) {
    return `--from ${from} is not older than --to ${to}. Pass the version this app is upgrading from.`;
  }

  const example = `warlock upgrade --from ${previousMinor(to)} --to ${to}`;

  if (compareVersions(from, to) === 0) {
    return `The installed @warlock.js/core is already ${from}, the --to version, so the version this app is upgrading from cannot be detected. Pass it with --from <previous version>, e.g. ${example}.`;
  }

  return `This app is already on ${from}; --to ${to} is not newer. If the detected version is wrong, pass --from <previous version>, e.g. ${example}.`;
}

/** `5.31.0` → `5.30`. A major's first release has no minor to step back to, so it gets a placeholder. */
function previousMinor(version: string): string {
  const [major, minor] = parseVersion(version) ?? [0, 0, 0];

  return minor > 0 ? `${major}.${minor - 1}` : "<previous version>";
}

function toVersion(value: string): string {
  try {
    return normalizeVersion(value);
  } catch (error) {
    throw new UpgradeUsageError(error instanceof Error ? error.message : String(error));
  }
}

/** The installed `@warlock.js/core`, or the version its package.json range names. */
export function detectInstalledVersion(root: string): string {
  const installed = path.join(root, "node_modules", "@warlock.js", "core", "package.json");
  if (existsSync(installed)) {
    const version = (JSON.parse(readFileSync(installed, "utf8")) as { version?: unknown }).version;
    if (typeof version === "string" && parseVersion(version))
      return normalizeVersion(stripRange(version));
  }

  const manifest = path.join(root, "package.json");
  if (existsSync(manifest)) {
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const spec =
      pkg.dependencies?.["@warlock.js/core"] ?? pkg.devDependencies?.["@warlock.js/core"];
    const parsed = typeof spec === "string" ? parseVersion(spec) : undefined;
    if (parsed) return parsed.join(".");
  }

  throw new UpgradeUsageError(
    "Could not tell which Warlock version this app is on (no installed @warlock.js/core). Pass it with --from, e.g. --from 5.29.",
  );
}

function stripRange(version: string): string {
  return (parseVersion(version) ?? [0, 0, 0]).join(".");
}

function byFileAndLine(
  left: { file: string; line: number },
  right: { file: string; line: number },
) {
  return left.file.localeCompare(right.file) || left.line - right.line;
}

/** Non-TypeScript files a codemod reads and rewrites, buffered until the end. */
function createTextFiles(root: string) {
  const files = new Map<string, { before: string | undefined; current: string | undefined }>();

  const entry = (file: string) => {
    let existing = files.get(file);
    if (!existing) {
      const absolute = path.join(root, file);
      const content = existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
      existing = { before: content, current: content };
      files.set(file, existing);
    }
    return existing;
  };

  return {
    read: (file: string) => entry(file).current,
    write: (file: string, content: string) => {
      entry(file).current = content;
    },
    changes: () =>
      [...files.entries()]
        .filter(([, value]) => value.current !== undefined && value.current !== value.before)
        .map(([file, value]) => ({ file, before: value.before ?? "", after: value.current ?? "" })),
  };
}
