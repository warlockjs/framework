/**
 * `warlock grimoire guard [task]`: the change (git diff against the base)
 * checked against its task. The snapshot is opened with the cached route
 * facts, so the app never boots; the book is refreshed like `check` does.
 */
import { finishReport } from "../check/check-grimoire";
import { GrimoireError } from "../codes";
import type { GuardReport } from "../contracts/guard";
import { changedFiles, resolveBase } from "../git";
import { collectGuardInput, formatGuardReport, guardedChanges, runGuardChecks } from "../guard";
import { openGrimoire } from "../workspace";
import { reportError, type CommandContext } from "./actions";

/** Options the command passes (`--base`, `--commits`, `--hook`, `--json`). */
export type GuardCommandOptions = Record<string, unknown>;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * What an agent's Stop hook writes on stdin (JSON), read for at most
 * `timeoutMs`; `""` when stdin is a terminal, closed or silent.
 */
export function readHookInput(
  stream: NodeJS.ReadStream = process.stdin,
  timeoutMs = 1000,
): Promise<string> {
  if (stream.isTTY) return Promise.resolve("");

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const finish = (): void => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", finish);
      stream.off("error", finish);
      stream.pause();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onData = (chunk: Buffer | string): void => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    };
    const timer = setTimeout(finish, timeoutMs);

    timer.unref?.();
    stream.on("data", onData);
    stream.once("end", finish);
    stream.once("error", finish);
  });
}

/** True when the hook input says the agent already continued once because of this hook (`stop_hook_active`). */
export function stopHookActive(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);

    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).stop_hook_active === true
    );
  } catch {
    return false;
  }
}

/**
 * Run the guard and print its report. Exit code: 0 when no error, 1 on an
 * error finding; with `--hook`, 2 instead of 1 (everything on stderr), and 0
 * when the guard cannot run (no task, no git) or when the hook input on stdin
 * says the agent already went on once because of it (`stop_hook_active`): a
 * hook never traps an agent.
 */
export async function runGuard(
  context: CommandContext,
  task: string | undefined,
  options: GuardCommandOptions = {},
): Promise<number> {
  const { root, adapter, io } = context;
  const hook = options.hook === true;
  const out = hook ? io.err : io.out;

  try {
    const base = await resolveBase(root, text(options.base));
    // Listed before the snapshot is opened: opening writes the book, and a project without the ignore lines must not see it as a change.
    const changed = guardedChanges(await changedFiles(root, base));
    const snapshot = await openGrimoire(root, adapter, { routes: "cached" });
    const input = await collectGuardInput(root, snapshot, changed, {
      ...(task === undefined ? {} : { task }),
      base,
      ...(text(options.commits) === undefined ? {} : { commits: text(options.commits) as string }),
    });

    if (hook && input.scope === null) {
      const missing = runGuardChecks({ ...input, changed: [], commits: null });

      for (const finding of missing.filter((item) => item.code === "GR9008")) {
        io.err(`note: ${finding.code}  ${finding.message}`);
        io.err(`  fix: ${finding.hint}`);
      }

      return 0;
    }

    const checked = finishReport(snapshot, runGuardChecks(input));
    const report: GuardReport = {
      schemaVersion: 1,
      task: input.scope?.id ?? null,
      base,
      changed,
      findings: checked.findings,
      notApproved: snapshot.shots?.drift ?? [],
      counts: checked.counts,
      ok: checked.ok,
    };

    if (options.json === true) out(JSON.stringify(report, null, 2));
    else for (const line of formatGuardReport(report, root)) out(line);

    if (report.ok) return 0;

    if (!hook) return 1;

    // The agent already went on once because of this hook: report again, but let it stop, so a finding it may
    // not fix itself (a locked test, a wrong Files: line) never keeps it running.
    const input = typeof options.hookInput === "string" ? options.hookInput : await readHookInput();

    if (stopHookActive(input)) {
      io.err(
        "note: the guard already stopped this agent once; the findings above are left for the reviewer.",
      );

      return 0;
    }

    return 2;
  } catch (error) {
    if (hook && error instanceof GrimoireError) {
      io.err(`note: ${error.code}  ${error.message}`);

      return 0;
    }

    return reportError(io, error);
  }
}
