import { command } from "../../commands/cli-command";
import { releaseCommandAction } from "./release/release-command.action";

/**
 * `warlock release <action> [id]` — the deploy pipeline for an application:
 * candidate, gate, migrations, stage, activate, verify, rollback, list,
 * status and prune. Reads the `release` section of `warlock.config.ts`.
 */
export const releaseCommand = command({
  name: "release <action> [id]",
  description:
    "Release pipeline: candidate, gate, migrations, stage, activate, verify, rollback, list, status, prune",
  // Config only. The migrations action starts the database itself, so the
  // other actions never connect to anything.
  preload: { warlockConfig: true },
  action: releaseCommandAction,
  options: [
    {
      text: "--commit",
      type: "string",
      description: "candidate: commit to freeze (default HEAD)",
    },
    {
      text: "--allow-dirty",
      type: "boolean",
      description: "candidate: freeze even with uncommitted changes in the working tree",
    },
    {
      text: "--prove",
      type: "boolean",
      description:
        "migrations: really run the pending migrations and record the proof (without it, only the plan is shown)",
    },
    {
      text: "--target",
      type: "string",
      description: "migrations: name of a release.migrations.targets entry to apply to the env",
    },
    {
      text: "--preflight",
      type: "boolean",
      description: "activate: run the preflight checks only",
    },
    {
      text: "--allow-same",
      type: "boolean",
      description: "activate: accept a version equal to the active one",
    },
    {
      text: "--dry-run",
      type: "boolean",
      description: "activate, rollback, prune: show what would change without changing it",
    },
    {
      text: "--keep",
      type: "string",
      description: "prune: number of newest releases to keep",
    },
    {
      text: "--json, -j",
      type: "boolean",
      description: "Print the result as JSON",
    },
  ],
});
