import type { SpawnTarget } from "./resolve-command";

/** A ready-to-spawn invocation. */
export type Invocation = {
  file: string;
  args: string[];
  /** Set for `cmd.exe` so Node does not re-quote the already-quoted command line. */
  windowsVerbatimArguments: boolean;
};

/**
 * Bytes `cmd.exe` cannot carry inside a double-quoted argument: a quote ends
 * the quoted span, `%` expands variables even inside quotes, and a newline
 * ends the command (the BatBadBut / CVE-2024-24576 class). An argument
 * holding one of them is refused rather than escaped.
 */
const CMD_UNSAFE = /["%\r\n\0]/;

/** `cmd.exe` command-line limit (8191 characters), with headroom for the wrapper. */
export const CMD_LINE_LIMIT = 8000;

/** `CreateProcess` command-line limit (32767 characters), with headroom. */
export const WINDOWS_LINE_LIMIT = 32000;

/** Linux `MAX_ARG_STRLEN` (128 KiB per argument), with headroom. */
export const POSIX_ARGUMENT_LIMIT = 120 * 1024;

/** Conservative total argv budget on POSIX (ARG_MAX is shared with the environment). */
export const POSIX_TOTAL_LIMIT = 512 * 1024;

/**
 * Quote one argument for a `cmd.exe /s /c "..."` line, or return `null` when
 * it holds a byte cmd cannot quote safely. Inside double quotes `& | < > ^`
 * are literal; trailing backslashes are doubled so the target program's
 * argv parser does not read the closing quote as escaped.
 */
export function quoteForCmd(argument: string): string | null {
  if (CMD_UNSAFE.test(argument)) {
    return null;
  }

  const trailing = /\\+$/.exec(argument)?.[0] ?? "";

  return `"${argument}${trailing}"`;
}

/**
 * Build the invocation for a target and argv. A `cmd` target becomes
 * `cmd.exe /d /v:off /s /c ""batch" "arg" …"` — AutoRun disabled, delayed
 * expansion off (so `!` stays literal), each element quoted. Returns a
 * `refused` reason when an argument cannot be quoted safely.
 */
export function buildInvocation(
  target: SpawnTarget,
  args: string[],
  comspec: string,
): Invocation | { refused: string } {
  if (target.type === "direct") {
    return {
      file: target.file,
      args: [...target.prefixArgs, ...args],
      windowsVerbatimArguments: false,
    };
  }

  const quoted: string[] = [];

  for (const element of [target.file, ...args]) {
    const safe = quoteForCmd(element);

    if (safe === null) {
      return {
        refused:
          'an argument contains ", %, a newline or a NUL byte, which cmd.exe cannot carry safely',
      };
    }

    quoted.push(safe);
  }

  return {
    file: comspec,
    args: ["/d", "/v:off", "/s", "/c", `"${quoted.join(" ")}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Whether an invocation's argv fits the platform's limits. Windows counts
 * the whole command line (8191 for `cmd.exe`, 32767 for `CreateProcess`,
 * each argument quoted); POSIX limits a single argument to 128 KiB on Linux
 * and shares `ARG_MAX` with the environment.
 */
export function fitsCommandLine(invocation: Invocation, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    const length = [invocation.file, ...invocation.args].reduce(
      (total, element) => total + element.length + 3,
      0,
    );

    return length <= (invocation.windowsVerbatimArguments ? CMD_LINE_LIMIT : WINDOWS_LINE_LIMIT);
  }

  let total = 0;

  for (const element of [invocation.file, ...invocation.args]) {
    const bytes = Buffer.byteLength(element, "utf8") + 1;

    if (bytes > POSIX_ARGUMENT_LIMIT) {
      return false;
    }

    total += bytes;
  }

  return total <= POSIX_TOTAL_LIMIT;
}
