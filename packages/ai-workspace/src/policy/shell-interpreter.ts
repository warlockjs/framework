import { accessSync, constants } from "node:fs";
import path from "node:path";
import type { WorkspaceShellInterpreter, WorkspaceShellPolicy } from "../contracts";
import type { ShellDialect } from "./shell-parser";

/** An interpreter after `"auto"` has been resolved: what actually runs the line. */
export type ResolvedShellInterpreter = Exclude<WorkspaceShellInterpreter, "auto">;

/** What the resolver reads from the host, injectable so every platform is testable anywhere. */
export interface ShellHost {
  /** `process.platform`. */
  platform: NodeJS.Platform;
  /** The host's `PATH` value (not the workspace's isolated environment). */
  pathEnv: string | undefined;
  /** Whether `file` is an existing executable file. */
  isExecutable(file: string): boolean;
}

/** The shell a policy's `interpreter` resolves to on a host. */
export interface ResolvedShell {
  /** The concrete interpreter (never `"auto"`). */
  interpreter: ResolvedShellInterpreter;
  /** The grammar its command lines are parsed with. */
  dialect: ShellDialect;
  /**
   * The executable to spawn: `interpreterPath`, or the shell found on `PATH`.
   * Absent when the shell was not found (the spawn then reports the failure)
   * or for `"none"`.
   */
  file?: string;
  /** A human-readable name for descriptions, e.g. `bash`, `PowerShell 7 (pwsh)`. */
  label: string;
}

/** The real host: the running platform, `process.env.PATH`, and the filesystem. */
export function currentShellHost(): ShellHost {
  return {
    platform: process.platform,
    pathEnv: process.env.PATH ?? process.env.Path,
    isExecutable: (file) => {
      try {
        accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);

        return true;
      } catch {
        return false;
      }
    },
  };
}

/** The grammar a concrete interpreter reads on `platform`. */
export function dialectOf(
  interpreter: ResolvedShellInterpreter,
  platform: NodeJS.Platform = process.platform,
): ShellDialect {
  if (interpreter === "powershell") {
    return "powershell";
  }

  if (interpreter === "cmd") {
    return "cmd";
  }

  // `sh` is cmd.exe on Windows, where there is no /bin/sh.
  return interpreter === "sh" && platform === "win32" ? "cmd" : "posix";
}

/** The first of `names` found in the host's `PATH` (Windows: with `.exe`). */
function findOnPath(names: string[], host: ShellHost): string | undefined {
  const windows = host.platform === "win32";
  const separator = windows ? ";" : ":";
  const join = windows ? path.win32.join : path.posix.join;
  const directories = (host.pathEnv ?? "").split(separator).filter((entry) => entry !== "");

  for (const name of names) {
    for (const directory of directories) {
      const candidate = join(directory, windows ? `${name}.exe` : name);

      if (host.isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

/** Git for Windows' `bash.exe`, derived from the `git` found on `PATH`. */
function findGitBash(host: ShellHost): string | undefined {
  const git = findOnPath(["git"], host);

  if (git === undefined) {
    return undefined;
  }

  // …\Git\cmd\git.exe, …\Git\bin\git.exe or …\Git\mingw64\bin\git.exe
  const win = path.win32;
  const roots = [win.dirname(win.dirname(git)), win.dirname(win.dirname(win.dirname(git)))];

  for (const root of roots) {
    for (const candidate of [
      win.join(root, "bin", "bash.exe"),
      win.join(root, "usr", "bin", "bash.exe"),
    ]) {
      if (host.isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

/** The PowerShell executable names, newest first. */
function powershellNames(host: ShellHost): string[] {
  return host.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"];
}

function powershellLabel(file: string | undefined): string {
  return file !== undefined && /pwsh(\.exe)?$/i.test(file) ? "PowerShell 7 (pwsh)" : "PowerShell";
}

/**
 * Resolve a shell policy's `interpreter` (and `interpreterPath`) to the
 * concrete shell that will run lines, and the grammar they are checked with.
 *
 * `"auto"` picks `pwsh`, then Windows PowerShell, then Git Bash (found next to
 * `git`), then `cmd.exe` on Windows and `bash`, then `sh` elsewhere. An explicit interpreter whose executable
 * is not on `PATH` keeps its name and has no `file`, so the spawn reports the
 * missing shell instead of quietly running another one.
 *
 * @example
 * resolveShell({ interpreter: "auto" }, { platform: "win32", pathEnv: "C:\\bin", isExecutable })
 */
export function resolveShell(
  shell: Pick<WorkspaceShellPolicy, "interpreter" | "interpreterPath"> | undefined,
  host: ShellHost = currentShellHost(),
): ResolvedShell {
  const requested = shell?.interpreter ?? "none";
  const explicit = shell?.interpreterPath;

  if (requested === "none") {
    return { interpreter: "none", dialect: "posix", label: "none" };
  }

  let interpreter: ResolvedShellInterpreter;
  let file: string | undefined = explicit;

  if (requested === "auto") {
    if (explicit !== undefined) {
      interpreter = /(^|[\\/])(pwsh|powershell)(\.exe)?$/i.test(explicit)
        ? "powershell"
        : /(^|[\\/])cmd(\.exe)?$/i.test(explicit)
          ? "cmd"
          : /(^|[\\/])bash(\.exe)?$/i.test(explicit)
            ? "bash"
            : "sh";
    } else if (host.platform === "win32") {
      const powershell = findOnPath(powershellNames(host), host);
      const gitBash = powershell === undefined ? findGitBash(host) : undefined;

      interpreter =
        powershell !== undefined ? "powershell" : gitBash !== undefined ? "bash" : "cmd";
      file = powershell ?? gitBash;
    } else {
      const bash = findOnPath(["bash"], host);

      interpreter = bash !== undefined ? "bash" : "sh";
      file = bash;
    }
  } else {
    interpreter = requested;
  }

  if (file === undefined) {
    if (interpreter === "powershell") {
      file = findOnPath(powershellNames(host), host);
    } else if (interpreter === "bash") {
      file =
        findOnPath(["bash"], host) ?? (host.platform === "win32" ? findGitBash(host) : undefined);
    } else if (interpreter === "cmd" && host.platform === "win32") {
      file = process.env.ComSpec ?? "cmd.exe";
    }
  }

  const labels: Record<ResolvedShellInterpreter, string> = {
    none: "none",
    sh: host.platform === "win32" ? "cmd.exe" : "sh",
    bash: "bash",
    cmd: "cmd.exe",
    powershell: powershellLabel(file),
  };

  return {
    interpreter,
    dialect: dialectOf(interpreter, host.platform),
    ...(file !== undefined ? { file } : {}),
    label: labels[interpreter],
  };
}
