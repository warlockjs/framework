import { command } from "../../commands/cli-command";

/**
 * `warlock upgrade --to <version>` — apply the mechanical edits for every
 * breaking change between the installed release and the target, and list the
 * places that need a decision (`file:line` plus the reason). `--dry-run`
 * prints a diff and writes nothing; `--json` prints the result as JSON.
 *
 * Needs no app boot: it reads source files, `package.json` and Node version
 * files only. `ts-morph` (an optional peer) is loaded when the command runs.
 */
export const upgradeCommand = command({
  name: "upgrade",
  description:
    "Apply the code changes a Warlock upgrade needs (--to <version>), and list what to review by hand; --dry-run shows a diff, --json prints JSON",
  action: async (data) => {
    // Loaded here so ts-morph and the codemods never join another command's graph.
    const { runUpgradeCommand } = await import("../../upgrade/upgrade-command.action");
    await runUpgradeCommand(data.options);
  },
  options: [
    {
      text: "--to",
      description: "Version to upgrade to, e.g. 5.31 or 5.31.0 (required)",
      type: "string",
    },
    {
      text: "--from",
      description:
        "Version to upgrade from (default: the installed @warlock.js/core, so pass it once the new release is installed)",
      type: "string",
    },
    {
      text: "--dry-run",
      description: "Show the diff and the review list without writing any file",
      type: "boolean",
    },
    {
      text: "--json, -j",
      description: "Print the result as JSON",
      type: "boolean",
    },
  ],
});
