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
 * Run the guard and print its report. Exit code: 0 when no error, 1 on an
 * error finding; with `--hook`, 2 instead of 1 (everything on stderr), and 0
 * when the guard cannot run (no task, no git): a hook never traps an agent
 * that works without a task.
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

    return report.ok ? 0 : hook ? 2 : 1;
  } catch (error) {
    if (hook && error instanceof GrimoireError) {
      io.err(`note: ${error.code}  ${error.message}`);

      return 0;
    }

    return reportError(io, error);
  }
}
