import { compareVersions } from "./semver";
import { hasStagedArtefacts } from "./stage";
import {
  appendLog,
  pointerPath,
  readManifest,
  readPointer,
  releaseDir,
  switchPointer,
  writeManifest,
  type ReleaseContext,
} from "./store";
import type { ReleaseManifest } from "./types";

export type PreflightCheck = { name: string; ok: boolean; detail: string };

export type ActivateOptions = {
  /** Run the preflight checks and stop. */
  preflightOnly?: boolean;
  /** Report what would change without changing anything. */
  dryRun?: boolean;
  /** Accept a version equal to the active one (a different commit). */
  allowSame?: boolean;
};

export type ActivationResult = {
  id: string;
  /** The release that was active before, if any */
  previousId: string | null;
  checks: PreflightCheck[];
  /** Whether the pointer was switched */
  switched: boolean;
  dryRun: boolean;
  /** Whether the restart command ran, and succeeded */
  restarted: boolean | null;
  restartOutput?: string;
  ok: boolean;
  message: string;
};

/**
 * The checks every activation must pass.
 *
 * The version rule is strict on purpose: the candidate has to be greater than
 * the active release. Equal versions need `allowSame` (a rebuild of the same
 * version from another commit); a lower version is never activated this way,
 * `release rollback` is the path back.
 */
export async function runPreflight(
  context: ReleaseContext,
  manifest: ReleaseManifest,
  options: Pick<ActivateOptions, "allowSame"> = {},
): Promise<{ checks: PreflightCheck[]; activeId: string | null }> {
  const checks: PreflightCheck[] = [];
  const activeId = await readPointer(context, "current");

  checks.push({
    name: "staged",
    ok: manifest.status === "staged" && (await hasStagedArtefacts(context, manifest.id)),
    detail: "staged artefacts are present (run `warlock release stage`)",
  });

  checks.push({
    name: "gate",
    ok: manifest.gate?.passed === true,
    detail: "the gate passed",
  });

  if (manifest.migrations) {
    checks.push({
      name: "migrations",
      ok: manifest.migrations.passed,
      detail: "the recorded migration proof passed",
    });
  }

  if (activeId === manifest.id) {
    checks.push({ name: "not-active", ok: false, detail: "this release is already active" });
  } else if (activeId) {
    const active = await readManifest(context, activeId);
    const order = compareVersions(manifest.version, active.version);

    checks.push({
      name: "version",
      ok: order > 0 || (order === 0 && options.allowSame === true),
      detail:
        order > 0
          ? `${manifest.version} is greater than the active ${active.version}`
          : order === 0
            ? `${manifest.version} equals the active version (pass --allow-same to accept)`
            : `${manifest.version} is lower than the active ${active.version} (use \`release rollback\`)`,
    });
  } else {
    checks.push({ name: "version", ok: true, detail: "no active release yet" });
  }

  return { checks, activeId };
}

async function restart(
  context: ReleaseContext,
  id: string,
): Promise<{ ran: boolean; ok: boolean; output?: string }> {
  const command = context.config.restart.command;

  if (!command) return { ran: false, ok: true };

  const result = await context.runner(command, {
    cwd: context.root,
    timeoutMs: context.config.restart.timeoutMs,
    env: {
      WARLOCK_RELEASE_ID: id,
      WARLOCK_RELEASE_DIR: releaseDir(context, id),
      WARLOCK_RELEASE_CURRENT: pointerPath(context, "current"),
    },
  });

  return { ran: true, ok: result.code === 0 && !result.timedOut, output: result.output };
}

/**
 * Preflight, then switch `current` to the release and run the restart
 * command.
 *
 * The switch is one atomic symlink rename. The old `current` becomes
 * `previous`. Warlock restarts nothing itself: only the configured
 * `release.restart.command` runs, and when it is unset the pointer switch is
 * the whole activation. If the restart command fails the pointer stays on the
 * new release (the restart may have partly taken effect) and the result says
 * so; `release rollback` is the way back.
 *
 * @example
 * const result = await activateRelease(context, "1.4.0-a1b2c3d", { dryRun: true });
 */
export async function activateRelease(
  context: ReleaseContext,
  id: string,
  options: ActivateOptions = {},
): Promise<ActivationResult> {
  const manifest = await readManifest(context, id);
  const { checks, activeId } = await runPreflight(context, manifest, options);
  const failed = checks.filter((check) => !check.ok);
  const base = {
    id,
    previousId: activeId,
    checks,
    switched: false,
    dryRun: options.dryRun === true,
    restarted: null,
  };

  if (failed.length > 0) {
    const message = `Preflight failed: ${failed.map((check) => check.name).join(", ")}.`;

    if (!options.preflightOnly && !options.dryRun) {
      await appendLog(context, { event: "activate", release: id, ok: false, detail: message });
    }

    return { ...base, ok: false, message };
  }

  if (options.preflightOnly) {
    return { ...base, ok: true, message: "Preflight passed." };
  }

  if (options.dryRun) {
    return {
      ...base,
      ok: true,
      message: `Dry run: would switch current to ${id}${activeId ? ` (previous becomes ${activeId})` : ""}${
        context.config.restart.command ? " and run the restart command" : ""
      }.`,
    };
  }

  if (activeId) await switchPointer(context, "previous", activeId);
  await switchPointer(context, "current", id);

  if (activeId) {
    const old = await readManifest(context, activeId);

    await writeManifest(context, { ...old, status: "superseded" });
  }

  const restarted = await restart(context, id);

  await writeManifest(context, {
    ...manifest,
    status: "active",
    activation: {
      at: context.now().toISOString(),
      previousId: activeId,
      restarted: restarted.ran && restarted.ok,
    },
  });

  if (!restarted.ok) {
    const message = `Switched current to ${id}, but the restart command failed. Fix it or run \`warlock release rollback\`.`;

    await appendLog(context, { event: "activate", release: id, ok: false, detail: message });

    return {
      ...base,
      switched: true,
      restarted: false,
      restartOutput: restarted.output,
      ok: false,
      message,
    };
  }

  const message = `Activated ${id}${restarted.ran ? " and ran the restart command" : ""}.`;

  await appendLog(context, { event: "activate", release: id, ok: true, detail: message });

  return {
    ...base,
    switched: true,
    restarted: restarted.ran ? true : null,
    ok: true,
    message,
  };
}

export type RollbackResult = {
  from: string | null;
  to: string | null;
  switched: boolean;
  dryRun: boolean;
  restarted: boolean | null;
  restartOutput?: string;
  ok: boolean;
  message: string;
};

/**
 * Switch `current` back to `previous`, and `previous` to the release that was
 * just left (so a second rollback returns to it), then run the restart
 * command.
 *
 * Migrations are never rolled back here. A migration may have dropped or
 * rewritten data that no reverse step can restore, and the code that ran
 * before usually tolerates the newer schema; deciding to undo a schema change
 * is a separate, deliberate step (`warlock migrate --rollback`) taken with the
 * data in view.
 */
export async function rollbackRelease(
  context: ReleaseContext,
  options: { dryRun?: boolean } = {},
): Promise<RollbackResult> {
  const current = await readPointer(context, "current");
  const previous = await readPointer(context, "previous");
  const base = {
    from: current,
    to: previous,
    switched: false,
    dryRun: options.dryRun === true,
    restarted: null,
  };

  if (!current || !previous) {
    return { ...base, ok: false, message: "There is no previous release to roll back to." };
  }

  // Both manifests must exist before anything moves.
  const target = await readManifest(context, previous);
  const left = await readManifest(context, current);

  if (!(await hasStagedArtefacts(context, previous))) {
    return {
      ...base,
      ok: false,
      message: `The staged files of ${previous} are gone; cannot roll back to it.`,
    };
  }

  if (options.dryRun) {
    return {
      ...base,
      ok: true,
      message: `Dry run: would switch current back to ${previous}${
        context.config.restart.command ? " and run the restart command" : ""
      }.`,
    };
  }

  await switchPointer(context, "previous", current);
  await switchPointer(context, "current", previous);
  await writeManifest(context, { ...left, status: "superseded" });
  await writeManifest(context, { ...target, status: "active" });

  const restarted = await restart(context, previous);

  if (!restarted.ok) {
    const message = `Rolled current back to ${previous}, but the restart command failed.`;

    await appendLog(context, { event: "rollback", release: previous, ok: false, detail: message });

    return {
      ...base,
      switched: true,
      restarted: false,
      restartOutput: restarted.output,
      ok: false,
      message,
    };
  }

  const message = `Rolled back from ${current} to ${previous}${
    restarted.ran ? " and ran the restart command" : ""
  }.`;

  await appendLog(context, { event: "rollback", release: previous, ok: true, detail: message });

  return {
    ...base,
    switched: true,
    restarted: restarted.ran ? true : null,
    ok: true,
    message,
  };
}
