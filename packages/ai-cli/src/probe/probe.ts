import { spawn } from "node:child_process";
import type { CliAdapter, CliProbeResult } from "../contracts";
import { CliError } from "../errors";
import { killProcessTree } from "../spawn/process-tree";
import { buildInvocation } from "../spawn/invocation";
import type { SpawnTarget } from "../spawn/resolve-command";

/** How long a single `--help`/`--version` call may take. */
export const PROBE_TIMEOUT_MS = 30_000;

/** Output cap per probe call; help screens are a few KiB. */
const PROBE_OUTPUT_LIMIT = 1024 * 1024;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a help screen lists a flag or subcommand. Flags (`--json`, `-p`)
 * must appear as a whole token — `--json` does not match `--json-schema`;
 * a bare word (`exec`) is matched as a whole word.
 *
 * @example
 * helpLists("  -p, --print  Print response", "--print"); // true
 * helpLists("  --output-format <format>", "--output"); // false
 */
export function helpLists(help: string, flag: string): boolean {
  const escaped = escapeRegExp(flag);

  if (flag.startsWith("-")) {
    return new RegExp(`(^|[\\s,\\[(|/"'\`])${escaped}(?=$|[\\s,=\\])|<\\[.:;"'\`])`, "m").test(
      help,
    );
  }

  return new RegExp(`(^|[^\\w-])${escaped}(?=$|[^\\w-])`, "m").test(help);
}

/** The first version-looking token of `--version` output, else its first line. */
export function parseVersion(output: string): string {
  const match = /\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/.exec(output);

  if (match) {
    return match[0];
  }

  const firstLine = output.trim().split(/\r?\n/)[0]?.trim();

  return firstLine && firstLine.length > 0 ? firstLine : "unknown";
}

/** Flags a plan requires that the help screen does not list. */
export function missingFlags(help: string, required: readonly string[]): string[] {
  return required.filter((flag) => !helpLists(help, flag));
}

type CaptureInput = {
  target: SpawnTarget;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  comspec: string;
  platform: NodeJS.Platform;
};

/** Run a probe invocation and capture stdout + stderr (help is printed to either). */
function capture(
  input: CaptureInput,
): Promise<{ output: string; exitCode: number | null; error?: Error }> {
  return new Promise((resolve) => {
    const invocation = buildInvocation(input.target, input.args, input.comspec);

    if ("refused" in invocation) {
      resolve({ output: "", exitCode: null, error: new Error(invocation.refused) });

      return;
    }

    const child = spawn(invocation.file, invocation.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      detached: input.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const collect = (chunk: Buffer): void => {
      if (size < PROBE_OUTPUT_LIMIT) {
        chunks.push(chunk);
        size += chunk.length;
      }
    };

    const timer = setTimeout(() => {
      killProcessTree(child, input.platform, 0);
    }, PROBE_TIMEOUT_MS);

    const finish = (exitCode: number | null, error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({ output: Buffer.concat(chunks).toString("utf8"), exitCode, error });
    };

    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

export type ProbeInput = Omit<CaptureInput, "args"> & { adapter: CliAdapter };

/**
 * Read the CLI's version and help screens. A help invocation that cannot
 * run at all (spawn error, no output) fails the probe; a non-zero exit with
 * output is accepted, because several CLIs exit 1 after printing help.
 */
export async function probeCli(input: ProbeInput): Promise<CliProbeResult> {
  const { adapter } = input;
  const versionRun = await capture({ ...input, args: adapter.probe.version });

  if (versionRun.error !== undefined) {
    throw new CliError(
      `${adapter.title}: could not run "${input.target.executable} ${adapter.probe.version.join(" ")}": ${versionRun.error.message}`,
      {
        type: "probe-failed",
        adapter: adapter.name,
        executable: input.target.executable,
        cause: versionRun.error,
      },
    );
  }

  const version = parseVersion(versionRun.output);
  const helps: string[] = [];

  for (const args of adapter.probe.help) {
    const helpRun = await capture({ ...input, args });

    if (helpRun.error !== undefined || helpRun.output.trim().length === 0) {
      throw new CliError(
        `${adapter.title} ${version}: "${input.target.executable} ${args.join(" ")}" printed no help` +
          (helpRun.error ? ` (${helpRun.error.message})` : "") +
          "; the capability probe cannot verify the flags this adapter needs.",
        {
          type: "probe-failed",
          adapter: adapter.name,
          version,
          executable: input.target.executable,
          cause: helpRun.error,
        },
      );
    }

    helps.push(helpRun.output);
  }

  return { executable: input.target.executable, version, help: helps.join("\n") };
}

/** Throw a `capability` error naming the first required flag the help does not list. */
export function assertCapabilities(
  adapter: CliAdapter,
  probe: CliProbeResult,
  required: readonly string[],
): void {
  const missing = missingFlags(probe.help, required);
  const flag = missing[0];

  if (flag === undefined) {
    return;
  }

  const helpCommands = adapter.probe.help
    .map((args) => `${adapter.command} ${args.join(" ")}`)
    .join(", ");

  throw new CliError(
    `${adapter.title} ${probe.version} (${probe.executable}) does not support ${missing.join(", ")}: ` +
      `not listed in "${helpCommands}". This adapter was verified against ${adapter.title} ` +
      `${adapter.verification.version}; install a compatible version or drop the option that needs ${flag}.`,
    {
      type: "capability",
      adapter: adapter.name,
      flag,
      version: probe.version,
      executable: probe.executable,
    },
  );
}
