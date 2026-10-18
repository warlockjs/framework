import type * as TsMorph from "ts-morph";

/** The `ts-morph` module, loaded lazily by `warlock upgrade`. */
export type TsMorphModule = typeof TsMorph;

export type SourceFile = TsMorph.SourceFile;

/** A text replacement inside one TypeScript source file. */
export type SourceEdit = {
  /** Path relative to the app root, with `/` separators. */
  file: string;
  start: number;
  end: number;
  text: string;
  /** 1-based line of the edited code before the edit. */
  line: number;
  description: string;
};

/** A change a codemod could not make safely; a person (or agent) decides. */
export type ManualFinding = {
  file: string;
  line: number;
  hint: string;
};

/** Buffered whole-file additions, replacements and removals, including root config. */
export type TextFiles = {
  /** File contents, or `undefined` when it does not exist. */
  read(file: string): string | undefined;
  /** Root filenames available for conservative config discovery. */
  list(): readonly string[];
  /** Remove a file and record why; buffered for dry runs. */
  remove(file: string, change: { line: number; description: string }): void;
  /** Replace a file's contents and record why. */
  write(file: string, content: string, change: { line: number; description: string }): void;
};

export type CodemodContext = {
  tsMorph: TsMorphModule;
  /** `src/**\/*.{ts,tsx}` of the app, current after earlier codemods ran. */
  sourceFiles: readonly SourceFile[];
  /** Relative path of a source file, as reported. */
  relativePath(sourceFile: SourceFile): string;
  text: TextFiles;
  /** Normalized `x.y.z` the app is upgrading to. */
  targetVersion: string;
};

export type CodemodOutput = {
  edits: SourceEdit[];
  manual: ManualFinding[];
};

export type Codemod = {
  /** Stable id, printed next to each change and listed in the changelog. */
  id: string;
  /** Release whose breaking change this handles; `"target"` runs on every upgrade. */
  version: string | "target";
  /** Package whose changelog lists the change. */
  package: string;
  title: string;
  /** Skill topic that explains the change. */
  skill: string;
  run(context: CodemodContext): CodemodOutput;
};

export type AppliedChange = {
  codemod: string;
  file: string;
  line: number;
  description: string;
};

export type ManualItem = ManualFinding & {
  codemod: string;
  skill: string;
};

export type UpgradeNote = {
  version: string;
  text: string;
};

export type UpgradeResult = {
  from: string;
  to: string;
  dryRun: boolean;
  /** Codemods that ran, in order. */
  codemods: { id: string; version: string; title: string; applied: number; manual: number }[];
  applied: AppliedChange[];
  manual: ManualItem[];
  /** Changes in the range that need no code edit but should be planned for. */
  notes: UpgradeNote[];
  changedFiles: string[];
  /** Unified diff of every change (always computed; printed with `--dry-run`). */
  diff: string;
  /** Install command when package.json changed (including toolchain dependencies). */
  installHint?: string;
};
