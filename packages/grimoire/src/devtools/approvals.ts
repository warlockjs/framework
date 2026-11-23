/**
 * The Approve and Reject buttons of the Bird view: `POST /approve` and
 * `POST /reject` with `{ ids: string[], language?: string, note?: string }`.
 * Development only: in production the panel refuses both. `ids` hold change
 * ids, `<feature>/<flow>` targets or `"all"`.
 */
import { GrimoireError } from "../codes";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { approveItems, rejectItems, selectDrift } from "../shots/approve";
import { GrimoirePanelError } from "./data";

/** What a button sends. `ids` are change ids, `<feature>/<flow>` targets, or `"all"`. */
export type ApprovalRequest = { ids: string[]; language?: string; note?: string };

/** What the panel answers: the ids it approved or rejected. */
export type ApprovalAnswer = { done: string[] };

function readBody(body: unknown): ApprovalRequest {
  const record =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const ids = record?.ids;

  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || id === "")
  ) {
    throw new GrimoirePanelError(400, "Send { ids: string[] } with at least one change id.");
  }

  // "--all" (the command line's spelling) is the same target as "all".
  const request: ApprovalRequest = {
    ids: (ids as string[]).map((id) => (id === "--all" ? "all" : id)),
  };

  if (record?.language !== undefined) {
    if (typeof record.language !== "string") {
      throw new GrimoirePanelError(400, "language must be a string.");
    }

    request.language = record.language;
  }

  if (record?.note !== undefined) {
    if (typeof record.note !== "string")
      throw new GrimoirePanelError(400, "note must be a string.");

    request.note = record.note;
  }

  return request;
}

function asPanelError(error: unknown): never {
  if (error instanceof GrimoireError) {
    throw new GrimoirePanelError(error.code === "GR9010" ? 404 : 400, error.message);
  }

  throw error;
}

export async function approveFromPanel(
  snapshot: GrimoireSnapshot,
  body: unknown,
): Promise<ApprovalAnswer> {
  const request = readBody(body);

  try {
    // "Approve all" with nothing approved yet creates the baseline from the current state.
    if (snapshot.shots?.baseline == null && request.ids.includes("all")) {
      return { done: await approveItems(snapshot, [], undefined, { createWhenMissing: true }) };
    }

    const items = selectDrift(snapshot, {
      targets: request.ids,
      ...(request.language === undefined ? {} : { language: request.language }),
    });

    return { done: await approveItems(snapshot, items) };
  } catch (error) {
    return asPanelError(error);
  }
}

export async function rejectFromPanel(
  snapshot: GrimoireSnapshot,
  body: unknown,
): Promise<ApprovalAnswer> {
  const request = readBody(body);

  try {
    const items = selectDrift(snapshot, {
      targets: request.ids,
      ...(request.language === undefined ? {} : { language: request.language }),
    });

    return { done: await rejectItems(snapshot, items, request.note?.trim() || null) };
  } catch (error) {
    return asPanelError(error);
  }
}
