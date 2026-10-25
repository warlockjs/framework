import { runUpgradeCheck, type UpgradeCheckOptions } from "./check-upgrade";
import { formatUpgradeCheckReport } from "./format-upgrade-check-report";
import { formatUpgradeReport } from "./format-upgrade-report";
import { TsMorphMissingError } from "./load-ts-morph";
import { type RunUpgradeOptions, runUpgrade, UpgradeUsageError } from "./run-upgrade";

type Output = { log(message: string): void; error(message: string): void };

function positive(value: string | boolean | number | undefined): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The `warlock upgrade` action. Returns the exit code it set: 0 when it ran
 * (even with places to review), 1 for unusable arguments or a missing ts-morph.
 * With `--check` it rehearses the upgrade on a copy and returns 1 when a step
 * failed there.
 */
export async function runUpgradeCommand(
  options: Record<string, string | boolean | number>,
  overrides: Pick<RunUpgradeOptions, "root" | "codemods" | "loadTsMorph"> &
    Pick<UpgradeCheckOptions, "run" | "scratchRoot"> = {},
  output: Output = console,
): Promise<number> {
  const json = Boolean(options.json);
  const fail = (message: string): number => {
    if (json) output.log(JSON.stringify({ error: message }, null, 2));
    else output.error(message);
    process.exitCode = 1;
    return 1;
  };

  const to =
    typeof options.to === "string" || typeof options.to === "number" ? String(options.to) : "";
  if (!to) {
    return fail(
      "Pass the version to upgrade to, and the version upgrading from once the new release is installed: warlock upgrade --from 5.30 --to 5.31.0",
    );
  }

  try {
    if (options.check) {
      const result = await runUpgradeCheck({
        ...overrides,
        to,
        ...(options.from !== undefined && options.from !== true && { from: String(options.from) }),
        skipInstall: Boolean(options.skipInstall),
        keep: Boolean(options.keep),
        ...(positive(options.timeoutMinutes) && { timeoutMinutes: positive(options.timeoutMinutes) }),
        ...(positive(options.memoryMb) && { memoryMb: positive(options.memoryMb) }),
      });

      output.log(json ? JSON.stringify(result, null, 2) : formatUpgradeCheckReport(result));

      if (!result.ok) process.exitCode = 1;

      return result.ok ? 0 : 1;
    }

    const result = await runUpgrade({
      ...overrides,
      to,
      ...(options.from !== undefined && options.from !== true && { from: String(options.from) }),
      dryRun: Boolean(options.dryRun),
    });

    output.log(json ? JSON.stringify(result, null, 2) : formatUpgradeReport(result));
    return 0;
  } catch (error) {
    if (error instanceof UpgradeUsageError || error instanceof TsMorphMissingError) {
      return fail(error.message);
    }
    throw error;
  }
}
