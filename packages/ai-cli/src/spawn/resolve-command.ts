import path from "node:path";

/**
 * Host facts the resolver needs, injected so every rule is a pure function
 * that tests can drive for Windows on any OS.
 */
export type CommandLookup = {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Whether a regular, runnable file exists at this absolute path. */
  isFile(filePath: string): boolean;
  /** Read a small text file (used only for npm `.cmd` shims). */
  readFile(filePath: string): string | undefined;
  /** Node binary used to run a JavaScript entry behind an npm shim. */
  execPath: string;
};

/**
 * How to start a resolved command.
 *
 * - `direct` — spawn `file` with `prefixArgs` + the CLI's argv, no shell.
 * - `cmd` — a batch file Node cannot spawn without a shell (Node refuses
 *   `.cmd`/`.bat` since CVE-2024-27980); it runs through `cmd.exe` with
 *   every argument quoted (see {@link buildInvocation}).
 */
export type SpawnTarget =
  | { type: "direct"; file: string; prefixArgs: string[]; executable: string }
  | { type: "cmd"; file: string; executable: string };

/** Windows' default `PATHEXT` when the variable is unset. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Case-insensitive read on Windows (`Path` vs `PATH`), exact elsewhere. */
export function readEnv(
  env: Record<string, string | undefined>,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") {
    return env[name];
  }

  const wanted = name.toUpperCase();

  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === wanted && value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Find an executable the way the platform's shell would.
 *
 * POSIX walks `PATH`. Windows walks `PATH` trying each `PATHEXT` extension
 * (`claude` → `claude.cmd`), and also accepts a name that already carries
 * one of those extensions. A command containing a path separator is
 * checked directly instead of searched.
 *
 * @example
 * findExecutable("claude", { platform: "win32", env: { PATH: "C:\\npm", PATHEXT: ".EXE;.CMD" }, ... });
 * // → "C:\\npm\\claude.cmd"
 */
export function findExecutable(command: string, lookup: CommandLookup): string | undefined {
  const api = pathApi(lookup.platform);
  const isWindows = lookup.platform === "win32";
  const extensions = isWindows
    ? (readEnv(lookup.env, "PATHEXT", "win32") ?? DEFAULT_PATHEXT)
        .split(";")
        .map((extension) => extension.trim())
        .filter((extension) => extension.length > 0)
    : [];

  const candidatesFor = (base: string): string[] => {
    if (!isWindows) {
      return [base];
    }

    const hasKnownExtension = extensions.some((extension) =>
      base.toUpperCase().endsWith(extension.toUpperCase()),
    );
    const withExtensions = extensions.map((extension) => base + extension.toLowerCase());

    return hasKnownExtension ? [base, ...withExtensions] : withExtensions;
  };

  const hasSeparator = isWindows ? /[\\/]/.test(command) : command.includes("/");

  if (hasSeparator || api.isAbsolute(command)) {
    return candidatesFor(api.resolve(command)).find((candidate) => lookup.isFile(candidate));
  }

  const searchPath = readEnv(lookup.env, "PATH", lookup.platform) ?? "";
  const directories = searchPath
    .split(isWindows ? ";" : ":")
    .map((directory) => directory.trim().replace(/^"(.*)"$/, "$1"))
    .filter((directory) => directory.length > 0);

  for (const directory of directories) {
    for (const candidate of candidatesFor(api.join(directory, command))) {
      if (lookup.isFile(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

/** What an npm/pnpm `.cmd` shim launches. */
export type CmdShimTarget = { type: "node"; script: string } | { type: "native"; file: string };

/**
 * Read the target of an npm (`cmd-shim`) or pnpm `.cmd` shim.
 *
 * Both generators end the shim with a line that runs the target with `%*`;
 * the target is a quoted path relative to the shim's own directory
 * (`"%dp0%\node_modules\pkg\cli.js"` for npm, `"%~dp0\..\pkg\cli.js"` for
 * pnpm). A JavaScript target is run by Node; an `.exe`/`.com` target is run
 * directly. Anything else returns `undefined` and the caller falls back to
 * `cmd.exe`.
 */
export function parseCmdShim(content: string, shimPath: string): CmdShimTarget | undefined {
  const directory = path.win32.dirname(shimPath);
  const lines = content.split(/\r?\n/).filter((line) => line.includes("%*"));
  const line = lines.at(-1);

  if (line === undefined) {
    return undefined;
  }

  const quoted = [...line.matchAll(/"(%~?dp0%?[\\/][^"]+)"/gi)]
    .map((match) => match[1] ?? "")
    .filter((target) => !/[\\/]node(\.exe)?$/i.test(target));
  const raw = quoted.at(-1);

  if (raw === undefined) {
    return undefined;
  }

  const relative = raw.replace(/^%~?dp0%?[\\/]/i, "");
  const target = path.win32.resolve(directory, relative);

  if (/\.(c|m)?js$/i.test(target)) {
    return { type: "node", script: target };
  }

  if (/\.(exe|com)$/i.test(target)) {
    return { type: "native", file: target };
  }

  return undefined;
}

/**
 * Resolve a command to something `child_process.spawn` can start without a
 * shell. On Windows a `.cmd`/`.bat` npm shim is unwrapped to
 * `node <script>` (or its native `.exe`), so argv reaches the CLI intact
 * with no `cmd.exe` parsing in between; any other batch file falls back
 * to `cmd.exe`.
 */
export function resolveSpawnTarget(
  command: string,
  lookup: CommandLookup,
): SpawnTarget | undefined {
  const executable = findExecutable(command, lookup);

  if (executable === undefined) {
    return undefined;
  }

  if (lookup.platform !== "win32" || !/\.(cmd|bat)$/i.test(executable)) {
    return { type: "direct", file: executable, prefixArgs: [], executable };
  }

  const shim = parseCmdShim(lookup.readFile(executable) ?? "", executable);

  if (shim?.type === "node") {
    const bundledNode = path.win32.join(path.win32.dirname(executable), "node.exe");
    const node = lookup.isFile(bundledNode) ? bundledNode : lookup.execPath;

    return { type: "direct", file: node, prefixArgs: [shim.script], executable };
  }

  if (shim?.type === "native" && lookup.isFile(shim.file)) {
    return { type: "direct", file: shim.file, prefixArgs: [], executable };
  }

  return { type: "cmd", file: executable, executable };
}
