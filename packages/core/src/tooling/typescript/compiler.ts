import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { readTsconfig } from "get-tsconfig";
import { importSpecifiers } from "../syntax/imports";
import { API, type Snapshot } from "typescript/unstable/sync";

/** Keep the pinned compiler's unstable protocol inside this module. */
export type CompilerDiagnostic = {
  fileName?: string;
  code: number;
  message: string;
  severity: "error" | "warning";
  line: number;
  column: number;
  length: number;
};

const require = createRequire(import.meta.url);
const manifestPath = require.resolve("typescript/package.json");
const manifest: { bin: { tsc: string } } = JSON.parse(readFileSync(manifestPath, "utf8"));
export const compilerBin = path.resolve(path.dirname(manifestPath), manifest.bin.tsc);

export function parseCompilerOutput(output: string, cwd: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(?:(.*?)\((\d+),(\d+)\): )?(error|warning) TS(\d+): (.*)$/.exec(line);
    if (match) {
      diagnostics.push({
        ...(match[1] ? { fileName: path.resolve(cwd, match[1]) } : {}),
        line: Number(match[2] ?? 1),
        column: Number(match[3] ?? 1),
        severity: match[4] === "warning" ? "warning" : "error",
        code: Number(match[5]),
        message: match[6] ?? "",
        length: 1,
      });
    } else if (/^\s+\S/.test(line)) {
      const previous = diagnostics.at(-1);
      if (previous) previous.message += `\n${line}`;
    }
  }
  return diagnostics;
}

export function runCompiler(cwd: string, args: string[]) {
  // spawnSync owns and waits for this exact child PID; it never stops unrelated processes.
  const result = spawnSync(process.execPath, [compilerBin, ...args, "--pretty", "false"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`TypeScript compiler terminated by ${result.signal}.`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const diagnostics = parseCompilerOutput(output, cwd);
  if (result.status !== 0 && diagnostics.length === 0) {
    throw new Error(`TypeScript compiler exited ${result.status}: ${output}`);
  }
  return { diagnostics, output, status: result.status, pid: result.pid };
}

/**
 * A path from the native compiler in the host's own spelling: native separators and, on Windows,
 * an upper-case drive letter (the compiler may report either case), so it compares equal to the
 * output of `path.resolve`.
 */
export function nativePath(file: string): string {
  const normalized = path.normalize(file);

  return /^[a-z]:/.test(normalized)
    ? normalized[0].toUpperCase() + normalized.slice(1)
    : normalized;
}

export type SourceUpdate = { path: string; content: string };

/** One native server per dev session; snapshots retain the configured declaration roots. */
export class CompilerSession {
  private api: API;
  private snapshot: Snapshot;
  private contents = new Map<string, string | null>();
  private configPath: string;

  constructor(
    cwd: string,
    configPath = path.join(cwd, "tsconfig.json"),
    virtualFiles: Record<string, string> = {},
  ) {
    for (const [file, content] of Object.entries(virtualFiles))
      this.contents.set(path.resolve(file), content);
    this.configPath = path.resolve(cwd, configPath);
    this.api = new API({
      cwd,
      fs: {
        readFile: (file) => this.contents.get(path.resolve(file)),
        directoryExists: (directory) =>
          [...this.contents.keys()].some((file) =>
            file.startsWith(path.resolve(directory) + path.sep),
          )
            ? true
            : undefined,
        fileExists: (file) =>
          this.contents.has(path.resolve(file))
            ? this.contents.get(path.resolve(file)) !== null
            : undefined,
      },
    });
    try {
      this.snapshot = this.api.updateSnapshot({ openProjects: [this.configPath] });
    } catch (error) {
      this.api.close();
      throw error;
    }
  }

  update(files: readonly SourceUpdate[], deleted: readonly string[] = []): void {
    for (const file of files) this.contents.set(path.resolve(file.path), file.content);
    for (const file of deleted) this.contents.set(path.resolve(file), null);
    const old = this.snapshot;
    this.snapshot = this.api.updateSnapshot({ fileChanges: { invalidateAll: true } });
    old.dispose();
  }

  get fileNames(): readonly string[] {
    // The native API reports forward-slash paths on Windows; callers compare with `path` output.
    return (
      this.snapshot
        .getProject(this.configPath)
        ?.program.getSourceFileNames()
        .map((file) => nativePath(file)) ?? []
    );
  }

  /** Ask the checker to resolve module references using the project's actual options. */
  importFiles(requested: string): string[] {
    // The native API keys files by forward-slash paths, also on Windows.
    const file = requested.replaceAll("\\", "/");
    const project = this.snapshot.getProject(this.configPath);
    if (!project?.program.getSourceFile(file)) return [];
    const source = this.contents.get(path.resolve(requested)) ?? readFileSync(requested, "utf8");
    return importSpecifiers(file, source).flatMap((imported) => {
      const symbol = project.checker.getSymbolAtPosition(file, imported.node.start + 1);
      return symbol?.declarations.map((declaration) => nativePath(declaration.path)) ?? [];
    });
  }

  diagnostics(requested: string): CompilerDiagnostic[] {
    const file = requested.replaceAll("\\", "/");
    const program = this.snapshot.getProject(this.configPath)?.program;
    if (!program?.getSourceFile(file)) return [];
    return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]
      .filter((diagnostic) => diagnostic.category === 1 || diagnostic.category === 0)
      .map((diagnostic) => {
        const content =
          this.contents.get(path.resolve(requested)) ?? readFileSync(requested, "utf8");
        const before = content.slice(0, Math.max(0, diagnostic.pos));
        const lines = before.split("\n");
        return {
          fileName: nativePath(diagnostic.fileName),
          code: diagnostic.code,
          message: diagnostic.text,
          severity: diagnostic.category === 1 ? "error" : "warning",
          line: lines.length,
          column: (lines.at(-1)?.length ?? 0) + 1,
          length: Math.max(1, diagnostic.end - diagnostic.pos),
        };
      });
  }

  close(): void {
    this.snapshot.dispose();
    // API.close() stops only the child it spawned (typescript/dist/api/syncChannel.js).
    this.api.close();
  }
}

/** Compile generated source against the real project, with an isolated virtual config. */
export function compileSources(
  configPath: string,
  files: Record<string, string>,
  paths: Record<string, string[]> = {},
): Record<string, string[]> {
  const cwd = path.dirname(configPath);
  const config = readTsconfig(configPath);
  const virtualConfig = path.join(cwd, "__generated-types__", "tsconfig.json");
  const session = new CompilerSession(cwd, virtualConfig, {
    ...files,
    [virtualConfig]: JSON.stringify({
      extends: configPath,
      compilerOptions: {
        noEmit: true,
        paths: { ...config.config.compilerOptions?.paths, ...paths },
      },
      files: Object.keys(files),
      include: [],
    }),
  });
  try {
    return Object.fromEntries(
      Object.keys(files).map((file) => [
        file,
        session.diagnostics(file).map((diagnostic) => diagnostic.message),
      ]),
    );
  } finally {
    session.close();
  }
}
