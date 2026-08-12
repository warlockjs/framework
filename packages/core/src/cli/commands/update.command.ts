import { colors } from "@mongez/copper";
import { updateWarlockPackages } from "../../updater/update-warlock-packages";
import { command } from "../../commands/cli-command";

export const updateCommand = command({
  name: "update",
  description: "Update all @warlock.js packages in this project to their latest version",
  action: async (data) => {
    // `parseCliArgs` camelCases every flag, so `--no-install` arrives as
    // `options.noInstall` (not `options["no-install"]`).
    const check = Boolean(data.options.check);
    const dryRun = check || Boolean(data.options.dryRun);

    const result = await updateWarlockPackages({
      install: !data.options.noInstall,
      dryRun,
    });

    // `updateWarlockPackages` resolves on a failed install so the dev-server
    // shortcut can survive it; a one-shot CLI run must still exit non-zero.
    if (result.outcome === "install-failed") {
      throw result.error ?? new Error("Package manager install failed.");
    }

    // `--check` is a gate, so its exit code carries the answer: 0 current,
    // 1 behind. `--dry-run` only reports, and always succeeds.
    if (check && result.outcome === "outdated") {
      console.log(
        colors.dim("Run ") +
          colors.cyan("warlock update") +
          colors.dim(" to apply these, or --dry-run to preview without a gate."),
      );
      process.exit(1);
    }
  },
  options: [
    {
      text: "--no-install",
      description:
        "Rewrite the @warlock.js versions in package.json without running the package manager install",
      type: "boolean",
    },
    {
      text: "--dry-run",
      description: "Show which packages would be updated without changing package.json",
      type: "boolean",
    },
    {
      text: "--check",
      description:
        "Like --dry-run, but exits 1 when any package is behind — a CI gate for staying current",
      type: "boolean",
    },
  ],
});
