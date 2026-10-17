/**
 * Types and the state machine of the agent board (`warlock board`): a
 * git-ignored folder two coding agents — usually an implementer and a
 * reviewer — share to track work items and exchange append-only messages.
 */

/** Where the board lives, under the project root. */
export const BOARD_DIRECTORY = ".warlock/board";

/** Every state an item can be in. */
export const BOARD_STATES = [
  "todo",
  "in-progress",
  "ready-for-review",
  "changes-requested",
  "approved",
  "blocked",
] as const;

/** One item state. */
export type BoardState = (typeof BOARD_STATES)[number];

/**
 * The allowed moves: an item in the key state may move to any listed state,
 * and nowhere else. `approved` may only be reopened (`in-progress`).
 */
export const BOARD_TRANSITIONS: Readonly<Record<BoardState, readonly BoardState[]>> = {
  todo: ["in-progress", "blocked"],
  "in-progress": ["ready-for-review", "blocked", "todo"],
  "ready-for-review": ["approved", "changes-requested", "in-progress"],
  "changes-requested": ["in-progress", "blocked"],
  approved: ["in-progress"],
  blocked: ["todo", "in-progress"],
};

/** A review verdict a message can carry. */
export type BoardVerdict = "approved" | "changes-requested";

/** The exact final line each verdict is written as. */
export const BOARD_VERDICT_LINES: Readonly<Record<BoardVerdict, string>> = {
  approved: "VERDICT: APPROVED",
  "changes-requested": "VERDICT: CHANGES REQUESTED",
};

/** One recorded state change of an item. */
export type BoardHistoryEntry = {
  /** `null` for the creation entry. */
  from: BoardState | null;
  to: BoardState;
  /** The agent that made the move, or `null` when not given. */
  by: string | null;
  /** ISO time. */
  at: string;
  note: string | null;
};

/** One work item, stored as `items/NNNN-<slug>.json`. */
export type BoardItem = {
  id: number;
  title: string;
  state: BoardState;
  assignee: string | null;
  reviewer: string | null;
  createdAt: string;
  updatedAt: string;
  history: BoardHistoryEntry[];
};

/** One message, stored as `to-<agent>/NNNN-<slug>.md`. */
export type BoardMessage = {
  /** The per-recipient sequence number (`NNNN`). */
  number: number;
  /** Path relative to the project root, POSIX separators. */
  file: string;
  from: string;
  to: string;
  /** The item the message is about, or `null`. */
  item: number | null;
  subject: string;
  /** ISO time. */
  at: string;
  body: string;
  verdict: BoardVerdict | null;
};

/** One recipient's inbox, as `readBoardStatus` reports it. */
export type BoardInbox = {
  agent: string;
  /** Messages in the inbox. */
  messages: number;
  /** The highest message number `watch` has returned to this agent (0 = none). */
  cursor: number;
  /** Messages numbered above the cursor. */
  unread: number;
};

/** What `warlock board status --json` prints without an item id. */
export type BoardStatus = {
  schemaVersion: 1;
  items: BoardItem[];
  inboxes: BoardInbox[];
};

/** Whether a string is a board state. */
export function isBoardState(value: string): value is BoardState {
  return (BOARD_STATES as readonly string[]).includes(value);
}

/** Whether a string is a verdict. */
export function isBoardVerdict(value: string): value is BoardVerdict {
  return value === "approved" || value === "changes-requested";
}
