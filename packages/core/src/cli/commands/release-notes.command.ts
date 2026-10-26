import { command } from "../../commands/cli-command";

/**
 * `warlock release-notes` prints the release summaries that ship inside the
 * installed `@warlock.js/core` package. It reads files only: no network and no
 * app boot, so it works before an upgrade, in CI and for an AI agent.
 */
export const releaseNotesCommand = command({
  name: "release-notes",
  description:
    "Print what changed in a Warlock release: the installed version by default, --from <version> for every release since it (breaking changes first), --version <v> for one, --list for the available ones, --json for data",
  action: async (data) => {
    const { runReleaseNotesCommand } =
      await import("../../release-notes/release-notes-command.action");
    runReleaseNotesCommand(data.options);
  },
  options: [
    {
      text: "--from",
      description:
        "Print every release after this version (e.g. 5.36), oldest first, led by a combined list of breaking changes",
      type: "string",
    },
    {
      text: "--to",
      description: "With --from: the last release to include (default: the installed version)",
      type: "string",
    },
    {
      text: "--version",
      description: "Print the summary of this one version",
      type: "string",
    },
    {
      text: "--list",
      description: "List the versions that have a summary, with their release dates",
      type: "boolean",
    },
    {
      text: "--json, -j",
      description: "Print { versions: [{ version, date, breaking, markdown }] } as JSON",
      type: "boolean",
    },
  ],
});
