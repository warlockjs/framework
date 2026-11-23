/**
 * The Approve and Reject buttons of the Bird view: `POST /approve` and
 * `POST /reject` with `{ ids: string[], language?: string, note?: string }`.
 * Development only: in production the panel refuses both. Contract stub of
 * the 5.64 shared contracts; the approvals implementation replaces the bodies.
 */
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { GrimoirePanelError } from "./data";

/** What a button sends. */
export type ApprovalRequest = { ids: string[]; language?: string; note?: string };

/** What the panel answers: the ids it approved or rejected. */
export type ApprovalAnswer = { done: string[] };

export async function approveFromPanel(
  snapshot: GrimoireSnapshot,
  body: unknown,
): Promise<ApprovalAnswer> {
  void snapshot;
  void body;

  throw new GrimoirePanelError(501, "Approving is not built yet.");
}

export async function rejectFromPanel(
  snapshot: GrimoireSnapshot,
  body: unknown,
): Promise<ApprovalAnswer> {
  void snapshot;
  void body;

  throw new GrimoirePanelError(501, "Rejecting is not built yet.");
}
