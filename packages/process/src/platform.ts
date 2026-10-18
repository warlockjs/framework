import type { Identity } from "./identity";

export type PortablePlatform = "darwin" | "win32";
export type Command = { file: string; args: string[]; env?: Record<string, string> };
export type Execute = (command: Command) => Promise<string>;
export type OwnershipProof = { pid: number; token: string; gated: boolean };
export type ReadProof = (pid: number) => Promise<OwnershipProof | undefined>;
type Row = {
  pid: number;
  parent: number;
  start: string;
  rss: number;
  group: number;
  state: string;
};

export class UnsupportedProcessPlatformError extends Error {
  constructor(public readonly platform: string) {
    super(`Process supervision is unsupported on ${platform}`);
    this.name = "UnsupportedProcessPlatformError";
  }
}
export function supported(platform: string): void {
  if (!["linux", "darwin", "win32"].includes(platform))
    throw new UnsupportedProcessPlatformError(platform);
}
function validPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid process PID");
}

/** Apple ps(1): lstart uses strftime %c. LC_ALL=C gives %a %b %e %H:%M:%S %Y.
 * https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/ps.1
 * https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c (lstarted)
 * https://github.com/apple-oss-distributions/Libc/blob/main/stdtime/FreeBSD/timelocal.c (_C_time_locale)
 */
export function parseDarwinStart(source: string): string {
  const match =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(
      source.trim(),
    );
  if (!match) throw new Error("Invalid macOS process start time");
  const [, weekday, month, day, hour, minute, second, year] = match;
  const monthIndex = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec"
    .split(" ")
    .indexOf(month ?? "");
  const date = new Date(
    Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute), Number(second)),
  );
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second) ||
    "Sun Mon Tue Wed Thu Fri Sat".split(" ")[date.getUTCDay()] !== weekday
  )
    throw new Error("Invalid macOS process start time");
  return String(date.getTime() / 1000);
}
export function darwinCommand(pid: number, tree = false): Command {
  validPid(pid);
  return {
    file: "/bin/ps",
    args: [...(tree ? ["-ax"] : ["-p", String(pid)]), "-o", "pid=,ppid=,pgid=,state=,rss=,lstart="],
    env: { LC_ALL: "C", TZ: "UTC" },
  };
}
export function parseDarwinRows(source: string): Row[] {
  return source.trim()
    ? source
        .trim()
        .split("\n")
        .map((line) => {
          const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
          if (!match) throw new Error("Invalid macOS process observation");
          return {
            pid: Number(match[1]),
            parent: Number(match[2]),
            group: Number(match[3]),
            state: match[4] ?? "",
            rss: Number(match[5]) * 1024,
            start: parseDarwinStart(match[6] ?? ""),
          };
        })
    : [];
}

/** CIM CreationDate is a DateTime; serialize UTC ticks as text, never a locale date
 * or JSON number (100ns ticks exceed Number's precision). WorkingSetSize is bytes.
 * https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process
 */
export function windowsCommand(pid: number, tree = false): Command {
  validPid(pid);
  const query = `Get-CimInstance Win32_Process${tree ? "" : ` -Filter 'ProcessId=${pid}'`}`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$rows = @(${query} | ForEach-Object {`,
    `if ([int]$_.ProcessId -eq ${pid} -and $null -eq $_.CreationDate) { throw 'Cannot read process creation time' }`,
    "if ($null -ne $_.CreationDate) {",
    "[pscustomobject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; start = $_.CreationDate.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture); rss = [double]$_.WorkingSetSize }",
    "}",
    "})",
    "ConvertTo-Json -InputObject $rows -Compress",
  ].join("\n");
  return {
    file: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
  };
}
export function parseWindowsRows(source: string): Row[] {
  const value: unknown = JSON.parse(source.replace(/^\uFEFF/, ""));
  if (!Array.isArray(value)) throw new Error("Invalid Windows process observation");
  return value.map((row: unknown) => {
    if (
      !row ||
      typeof row !== "object" ||
      !("pid" in row) ||
      typeof row.pid !== "number" ||
      !Number.isSafeInteger(row.pid) ||
      row.pid < 0 ||
      !("parent" in row) ||
      typeof row.parent !== "number" ||
      !Number.isSafeInteger(row.parent) ||
      row.parent < 0 ||
      !("start" in row) ||
      typeof row.start !== "string" ||
      !/^\d{18}$/.test(row.start) ||
      !("rss" in row) ||
      typeof row.rss !== "number" ||
      !Number.isFinite(row.rss) ||
      row.rss < 0
    )
      throw new Error("Invalid Windows process observation");
    return {
      pid: row.pid,
      parent: row.parent,
      start: row.start,
      rss: row.rss,
      group: row.pid,
      state: "R",
    };
  });
}
export function taskkillCommand(pid: number): Command {
  validPid(pid);
  // Never accept an image name, filter, wildcard or shell interpolation.
  return { file: "taskkill.exe", args: ["/PID", String(pid), "/T", "/F"] };
}
export function treeMemory(rows: Row[], pid: number): number {
  const root = rows.find((row) => row.pid === pid);
  if (!root) return 0;
  const included = new Map<number, Row>([[pid, root]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const parent = included.get(row.parent);
      // Reject a reused parent PID whose creation time is later than the child.
      if (!included.has(row.pid) && parent && BigInt(row.start) >= BigInt(parent.start)) {
        included.set(row.pid, row);
        changed = true;
      }
    }
  }
  return [...included.values()].reduce((total, row) => total + row.rss, 0);
}

/** All OS effects are injected; foreign-platform specs never execute real commands. */
export async function portableIdentity(
  platform: PortablePlatform,
  pid: number,
  token: boolean,
  execute: Execute,
  readProof: ReadProof,
): Promise<Identity | undefined> {
  validPid(pid);
  const command = platform === "darwin" ? darwinCommand : windowsCommand;
  const parse = platform === "darwin" ? parseDarwinRows : parseWindowsRows;
  const rows = parse(await execute(command(pid, token)));
  const before = rows.find((row) => row.pid === pid);
  if (!before || /^[ZX]/.test(before.state)) return undefined;
  if (!token) return before;
  const proof = await readProof(pid);
  const after = parse(await execute(command(pid))).find((row) => row.pid === pid);
  if (
    !after ||
    after.start !== before.start ||
    after.group !== before.group ||
    /^[ZX]/.test(after.state)
  )
    return undefined;
  return {
    start: after.start,
    group: after.group,
    state: proof?.pid === pid && proof.gated ? "T" : after.state,
    rss: treeMemory(rows, pid),
    token: proof?.pid === pid ? proof.token : undefined,
  };
}
