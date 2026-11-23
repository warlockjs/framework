/**
 * `warlock grimoire approve <target>` and `reject <target>`: accept or refuse
 * a change since the approved baseline (`grimoire/approved/baseline.json`).
 */
import { GrimoireError } from "../codes";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { approveItems, rejectItems, selectDrift } from "../shots/approve";
import { openGrimoire } from "../workspace";
import { reportError, type CommandContext } from "./actions";

function openFor(context: CommandContext): Promise<GrimoireSnapshot> {
  return openGrimoire(context.root, context.adapter, { routes: "cached", write: false });
}

function targetsOf(target: string | undefined, options: Record<string, unknown>): string[] {
  if (options.all === true) return ["all"];

  if (typeof target !== "string" || target.trim() === "") {
    throw new GrimoireError(
      "GR9010",
      "Name what to approve: a change id from the check, a <feature>/<flow>, or --all.",
    );
  }

  return [target.trim()];
}

function print(
  context: CommandContext,
  done: readonly string[],
  options: Record<string, unknown>,
  verb: "approved" | "rejected",
): void {
  if (options.json === true) {
    context.io.out(JSON.stringify({ done }, null, 2));

    return;
  }

  for (const id of done) context.io.out(id);

  context.io.out(`${verb} ${done.length}`);
}

/**
 * Approve the drift items `target` names: a drift id, a `<feature>/<flow>`
 * (every item of the flow), or every item with `--all`; `--lang` keeps one
 * language's images. `--all` with no baseline creates it from the current
 * state. Exit code 0 when it ran.
 */
export async function runApprove(
  context: CommandContext,
  target: string | undefined,
  options: Record<string, unknown> = {},
): Promise<number> {
  try {
    const targets = targetsOf(target, options);
    const snapshot = await openFor(context);
    const language = typeof options.lang === "string" ? options.lang : undefined;

    if (snapshot.shots?.baseline == null) {
      if (options.all !== true) {
        throw new GrimoireError(
          "GR9010",
          "Nothing is approved yet, so there is no change to name. Approve the current state with --all.",
        );
      }

      print(
        context,
        await approveItems(snapshot, [], undefined, { createWhenMissing: true }),
        options,
        "approved",
      );

      return 0;
    }

    const items = selectDrift(snapshot, { targets, ...(language === undefined ? {} : { language }) });

    print(context, await approveItems(snapshot, items), options, "approved");

    return 0;
  } catch (error) {
    return reportError(context.io, error);
  }
}

/** Reject the drift items `target` names (same targets as approve; `--note` records why). */
export async function runReject(
  context: CommandContext,
  target: string | undefined,
  options: Record<string, unknown> = {},
): Promise<number> {
  try {
    const targets = targetsOf(target, options);
    const snapshot = await openFor(context);
    const language = typeof options.lang === "string" ? options.lang : undefined;
    const note = typeof options.note === "string" && options.note.trim() !== "" ? options.note.trim() : null;
    const items = selectDrift(snapshot, { targets, ...(language === undefined ? {} : { language }) });

    print(context, await rejectItems(snapshot, items, note), options, "rejected");

    return 0;
  } catch (error) {
    return reportError(context.io, error);
  }
}
