import type { CommandActionData } from "../../../commands/types";
import { loadConfigFiles } from "../../../config/load-config-files";
import { connectorsManager } from "../../../connectors/connectors-manager";
import { activateRelease, rollbackRelease } from "../../../release/activate";
import { createCandidate } from "../../../release/candidate";
import { resolveReleaseConfig } from "../../../release/config";
import { runGate } from "../../../release/gate";
import {
  planMigrationProof,
  proveMigrations,
  type MigrationProofProvider,
} from "../../../release/migrations-proof";
import { pruneReleases } from "../../../release/prune";
import { listReleases, releaseStatus } from "../../../release/report";
import { shellRunner } from "../../../release/runner";
import { stageRelease } from "../../../release/stage";
import { resolveRelease, type ReleaseContext } from "../../../release/store";
import { verifyRelease } from "../../../release/verify";
import { warlockConfigManager } from "../../../warlock-config/warlock-config.manager";
import { flushAndExit } from "../../flush-and-exit";

const ACTIONS = [
  "candidate",
  "gate",
  "migrations",
  "stage",
  "activate",
  "verify",
  "rollback",
  "list",
  "status",
  "prune",
] as const;

type ReleaseAction = (typeof ACTIONS)[number];

/** What an action produced: a JSON-able payload, text lines and the verdict. */
export type ReleaseActionOutput = {
  ok: boolean;
  data: unknown;
  lines: string[];
};

export type ReleaseActionDependencies = {
  context: ReleaseContext;
  /** Starts the database and returns the provider; only `migrations` calls it. */
  openMigrations: (target: string | null) => Promise<MigrationProofProvider>;
};

function stringOption(data: CommandActionData, name: string): string | undefined {
  const value = data.options[name];

  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} requires a value.`);
  }

  return value;
}

function flag(data: CommandActionData, name: string): boolean {
  return data.options[name] === true;
}

function allowOptions(data: CommandActionData, action: ReleaseAction, allowed: string[]): void {
  for (const key of Object.keys(data.options)) {
    if (key !== "json" && !allowed.includes(key)) {
      throw new Error(`Unsupported option for release ${action}: --${key}`);
    }
  }
}

/**
 * Run one `warlock release` action and describe the result. Pure of process
 * state (no printing, no exit), so it can be tested with temp directories and
 * a fake runner.
 */
export async function runReleaseAction(
  data: CommandActionData,
  dependencies: ReleaseActionDependencies,
): Promise<ReleaseActionOutput> {
  const [action, id, ...extra] = data.args;
  const { context } = dependencies;

  if (!ACTIONS.includes(action as ReleaseAction) || extra.length > 0) {
    throw new Error(`Usage: warlock release <${ACTIONS.join(" | ")}> [id]`);
  }

  switch (action as ReleaseAction) {
    case "candidate": {
      allowOptions(data, "candidate", ["commit", "allowDirty"]);
      const manifest = await createCandidate(context, {
        commit: stringOption(data, "commit"),
        allowDirty: flag(data, "allowDirty"),
      });

      return {
        ok: true,
        data: manifest,
        lines: [`Created candidate ${manifest.id} (commit ${manifest.commit.slice(0, 7)}).`],
      };
    }

    case "gate": {
      allowOptions(data, "gate", []);
      const target = await resolveRelease(context, id);
      const manifest = await runGate(context, target.id);
      const results = manifest.gate?.results ?? [];
      const lines = results.map(
        (result) =>
          `${result.status === "passed" ? "PASS" : "FAIL"} ${result.name} (${result.durationMs}ms)`,
      );
      const failed = results.find((result) => result.status === "failed");

      if (failed?.output) lines.push("", failed.output.trim());
      lines.push(manifest.gate?.passed ? `Gate passed for ${manifest.id}.` : "Gate failed.");

      return { ok: manifest.gate?.passed === true, data: manifest, lines };
    }

    case "migrations": {
      allowOptions(data, "migrations", ["prove", "target"]);
      const targetName = stringOption(data, "target") ?? null;
      const provider = await dependencies.openMigrations(targetName);

      if (!flag(data, "prove")) {
        const plan = await planMigrationProof(context, provider, targetName);

        return {
          ok: true,
          data: plan,
          lines: [
            plan.pending.length === 0
              ? "Nothing is pending."
              : `Pending, in order: ${plan.pending.join(", ")}.`,
            "Pass --prove to run them and record the proof.",
          ],
        };
      }

      const release = await resolveRelease(context, id);
      const proof = await proveMigrations(context, provider, {
        target: targetName,
        releaseId: release.id,
      });
      const lines = [
        `Applied ${proof.applied.length} migration(s): ${proof.applied.join(", ") || "none"}.`,
        `Tables added: ${proof.tablesAdded.join(", ") || "none"}; removed: ${
          proof.tablesRemoved.join(", ") || "none"
        }.`,
        ...proof.problems.map((problem) => `PROBLEM ${problem}`),
        proof.passed ? "Migration proof passed." : "Migration proof failed.",
      ];

      return { ok: proof.passed, data: proof, lines };
    }

    case "stage": {
      allowOptions(data, "stage", []);
      const target = await resolveRelease(context, id);
      const manifest = await stageRelease(context, target.id);

      return {
        ok: true,
        data: manifest,
        lines: [`Staged ${manifest.id} (${manifest.staged?.files} files).`],
      };
    }

    case "activate": {
      allowOptions(data, "activate", ["preflight", "allowSame", "dryRun"]);
      const target = await resolveRelease(context, id);
      const result = await activateRelease(context, target.id, {
        preflightOnly: flag(data, "preflight"),
        dryRun: flag(data, "dryRun"),
        allowSame: flag(data, "allowSame"),
      });
      const lines = [
        ...result.checks.map(
          (check) => `${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`,
        ),
        result.message,
      ];

      if (result.restartOutput) lines.push("", result.restartOutput.trim());

      return { ok: result.ok, data: result, lines };
    }

    case "verify": {
      allowOptions(data, "verify", []);
      const result = await verifyRelease(context);

      return {
        ok: result.ok,
        data: result,
        lines: [
          result.ok
            ? `Verified ${result.id} after ${result.attempts} attempt(s).`
            : `Verification of ${result.id} failed after ${result.attempts} attempt(s): ${result.reason}`,
        ],
      };
    }

    case "rollback": {
      allowOptions(data, "rollback", ["dryRun"]);
      const result = await rollbackRelease(context, { dryRun: flag(data, "dryRun") });
      const lines = [result.message];

      if (result.restartOutput) lines.push("", result.restartOutput.trim());
      if (result.ok && !result.dryRun) {
        lines.push(
          "Migrations were not rolled back. Run `warlock migrate --rollback` yourself if needed.",
        );
      }

      return { ok: result.ok, data: result, lines };
    }

    case "list": {
      allowOptions(data, "list", []);
      const listing = await listReleases(context);

      return {
        ok: true,
        data: listing,
        lines:
          listing.releases.length === 0
            ? ["No releases yet."]
            : listing.releases.map((release) => {
                const marks = [
                  release.id === listing.current ? "current" : "",
                  release.id === listing.previous ? "previous" : "",
                ].filter(Boolean);

                return `${release.id}  ${release.status}  ${release.createdAt}${
                  marks.length > 0 ? `  [${marks.join(", ")}]` : ""
                }`;
              }),
      };
    }

    case "status": {
      allowOptions(data, "status", []);
      const report = await releaseStatus(context);
      const lines = report.active
        ? [
            `Active: ${report.active.id} (version ${report.active.version}, commit ${report.active.commit.slice(0, 7)})`,
            `Previous: ${report.previous ?? "none"}`,
          ]
        : ["No active release."];

      for (const entry of report.log) {
        lines.push(
          `${entry.at}  ${entry.event}  ${entry.release ?? "-"}  ${entry.ok ? "ok" : "failed"}`,
        );
      }

      return { ok: true, data: report, lines };
    }

    case "prune": {
      allowOptions(data, "prune", ["keep", "dryRun"]);
      const keep = stringOption(data, "keep");

      if (keep === undefined) throw new Error("release prune needs --keep <n>.");

      const result = await pruneReleases(context, {
        keep: Number(keep),
        dryRun: flag(data, "dryRun"),
      });

      return {
        ok: true,
        data: result,
        lines: [
          `${result.dryRun ? "Would remove" : "Removed"}: ${result.removed.join(", ") || "nothing"}.`,
        ],
      };
    }
  }
}

/** Start the database the way `warlock migrate` does, then wrap cascade. */
async function openCascadeMigrations(target: string | null): Promise<MigrationProofProvider> {
  const { createCascadeMigrationProvider } =
    await import("../../../release/cascade-migration-provider");

  if (target !== null) {
    const targets = warlockConfigManager.get("release")?.migrations?.targets ?? {};
    const entry = targets[target];

    if (!entry) throw new Error(`release.migrations.targets has no "${target}" entry.`);

    // Applied before the database config is read, so it reaches `env()` calls.
    Object.assign(process.env, entry.env ?? {});
  }

  await loadConfigFiles(["database", "log"]);
  await connectorsManager.start(["database", "logger"]);

  return createCascadeMigrationProvider();
}

export async function releaseCommandAction(data: CommandActionData): Promise<void> {
  const context: ReleaseContext = {
    root: process.cwd(),
    config: resolveReleaseConfig(warlockConfigManager.get("release")),
    runner: shellRunner,
    now: () => new Date(),
    nodeVersion: process.version,
  };

  let output: ReleaseActionOutput;

  try {
    output = await runReleaseAction(data, { context, openMigrations: openCascadeMigrations });
  } catch (error) {
    if (data.options.json === true) {
      console.log(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
    } else {
      console.error((error as Error).message);
    }

    return flushAndExit(1);
  }

  if (data.options.json === true) {
    console.log(JSON.stringify({ ok: output.ok, ...asObject(output.data) }, null, 2));
  } else {
    for (const line of output.lines) console.log(line);
  }

  if (!output.ok) return flushAndExit(1);
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { data: value };
}
