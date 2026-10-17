import { formatUpgradeReport } from "./format-upgrade-report";
import { TsMorphMissingError } from "./load-ts-morph";
import { type RunUpgradeOptions, runUpgrade, UpgradeUsageError } from "./run-upgrade";

type Output = { log(message: string): void; error(message: string): void };

/**
 * The `warlock upgrade` action. Returns the exit code it set: 0 when it ran
 * (even with places to review), 1 for unusable arguments or a missing ts-morph.
 */
export async function runUpgradeCommand(
  options: Record<string, string | boolean | number>,
  overrides: Pick<RunUpgradeOptions, "root" | "codemods" | "loadTsMorph"> = {},
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
  if (!to) return fail("Pass the version to upgrade to: warlock upgrade --to 5.31");

  try {
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
