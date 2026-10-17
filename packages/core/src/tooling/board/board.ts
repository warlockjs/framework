import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { WarlockError } from "../../errors/warlock-error";
import { formatBoardMessage, parseBoardMessage } from "./board-message";
import {
  BOARD_DIRECTORY,
  BOARD_TRANSITIONS,
  type BoardInbox,
  type BoardItem,
  type BoardMessage,
  type BoardState,
  type BoardStatus,
  type BoardVerdict,
  isBoardState,
} from "./board.types";

/** Agent names: lower-case letters, digits and dashes, starting with a letter or digit. */
const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** How many sequence numbers a writer tries before giving up on a contended slot. */
const MAX_ALLOCATION_ATTEMPTS = 1000;

/** The marker file `init` writes; its presence is what "initialized" means. */
const BOARD_FILE = "board.json";

/** What `initBoard` did. */
export type InitBoardResult = {
  /** The board directory, relative to the project root. */
  directory: string;
  /** `false` when the board already existed. */
  created: boolean;
  /** Whether `.warlock/board/` was added to `.gitignore` by this call. */
  gitignoreUpdated: boolean;
};

/** Inputs of {@link addBoardItem}. */
export type AddBoardItemInput = {
  title: string;
  assignee?: string | null;
  reviewer?: string | null;
  /** The agent creating it, recorded in the history. */
  by?: string | null;
  /** Clock, for tests. */
  now?: () => Date;
};

/** Inputs of {@link moveBoardItem}. */
export type MoveBoardItemOptions = {
  by?: string | null;
  note?: string | null;
  now?: () => Date;
};

/** Inputs of {@link sendBoardMessage}. */
export type SendBoardMessageInput = {
  to: string;
  from: string;
  subject: string;
  body?: string;
  /** The item the message is about. */
  item?: number | null;
  /** A review verdict; with `item`, also moves the item to that state. */
  verdict?: BoardVerdict | null;
  now?: () => Date;
};

/** What {@link sendBoardMessage} wrote. */
export type SendBoardMessageResult = {
  message: BoardMessage;
  /** The item after the verdict moved it, when the message carried one. */
  item: BoardItem | null;
};

/** Inputs of {@link watchBoard}. */
export type WatchBoardOptions = {
  agent: string;
  /** Return messages numbered above this. Default: the agent's cursor. */
  since?: number;
  /** Give up after this long; throws `WL7404`. Default: 10 minutes. */
  timeoutMs?: number;
  /** Poll interval. Default: 250 ms. */
  intervalMs?: number;
  /** Stop early (resolves with no messages). */
  signal?: AbortSignal;
};

/** What {@link watchBoard} returned. */
export type WatchBoardResult = {
  agent: string;
  /** The new messages, oldest first. */
  messages: BoardMessage[];
  /** The agent's cursor after the call. */
  cursor: number;
};

function boardRoot(cwd: string): string {
  return path.join(cwd, BOARD_DIRECTORY);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function pad(value: number): string {
  return String(value).padStart(4, "0");
}

/** A file-name slug: lower-case, dashes, at most 48 characters. */
export function boardSlug(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : fallback;
}

/** Throw unless `name` is a valid agent name. */
export function assertAgentName(name: string, label = "agent"): void {
  if (!AGENT_NAME.test(name)) {
    throw new Error(
      `Invalid ${label} name ${JSON.stringify(name)}: use lower-case letters, digits and dashes (e.g. "reviewer").`,
    );
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Write a file through a temp file and a rename, so a reader never sees half of it. */
function writeAtomic(file: string, content: string): void {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;

  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, file);
}

/** The `NNNN` numbers of the files in a directory named `NNNN-…`. */
function numberedEntries(directory: string, extension: string): { number: number; name: string }[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => !name.startsWith(".") && name.endsWith(extension))
    .flatMap((name) => {
      const match = /^(\d+)-/.exec(name);
      return match?.[1] ? [{ number: Number.parseInt(match[1], 10), name }] : [];
    })
    .sort((first, second) => first.number - second.number);
}

/**
 * Reserve the next free sequence number in `directory` by creating
 * `.seq/NNNN` exclusively (`wx`). Two writers racing for the same number:
 * one gets `EEXIST` and moves on to the next, so numbers are never shared.
 */
function reserveNumber(directory: string, start: number): number {
  const sequence = path.join(directory, ".seq");

  mkdirSync(sequence, { recursive: true });

  for (let number = start, attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; number++, attempt++) {
    try {
      writeFileSync(path.join(sequence, pad(number)), "", { flag: "wx" });
      return number;
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") continue;
      throw error;
    }
  }

  throw new Error(`Could not allocate a sequence number in ${directory}.`);
}

function nextNumber(directory: string, extension: string): number {
  const entries = numberedEntries(directory, extension);
  const highest = entries[entries.length - 1]?.number ?? 0;

  return reserveNumber(directory, highest + 1);
}

/** Throw `WL7401` unless the board exists. */
function assertInitialized(cwd: string): string {
  const root = boardRoot(cwd);

  if (!existsSync(path.join(root, BOARD_FILE))) {
    throw new WarlockError(
      "WL7401",
      `No agent board in ${BOARD_DIRECTORY}. Run \`warlock board init\` at the project root.`,
    );
  }

  return root;
}

/** Whether a `.gitignore` already ignores the board folder (or `.warlock` as a whole). */
export function gitignoreCoversBoard(content: string): boolean {
  const covering = new Set([
    ".warlock",
    ".warlock/",
    "/.warlock",
    "/.warlock/",
    ".warlock/*",
    "/.warlock/*",
    ".warlock/board",
    ".warlock/board/",
    "/.warlock/board",
    "/.warlock/board/",
  ]);

  return content.split(/\r?\n/).some((line) => covering.has(line.trim()));
}

/**
 * Create the board (idempotent): `.warlock/board/` with its `board.json`
 * marker, `items/`, and `.warlock/board/` in `.gitignore` unless the project
 * already ignores it. A `.gitignore` is created when there is none.
 */
export function initBoard(
  cwd = process.cwd(),
  now: () => Date = () => new Date(),
): InitBoardResult {
  const root = boardRoot(cwd);
  const marker = path.join(root, BOARD_FILE);
  const created = !existsSync(marker);

  mkdirSync(path.join(root, "items"), { recursive: true });
  mkdirSync(path.join(root, "cursors"), { recursive: true });

  if (created) {
    writeAtomic(
      marker,
      `${JSON.stringify({ schemaVersion: 1, createdAt: now().toISOString() }, null, 2)}\n`,
    );
  }

  const gitignore = path.join(cwd, ".gitignore");
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  let gitignoreUpdated = false;

  if (!gitignoreCoversBoard(current)) {
    const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";

    writeFileSync(
      gitignore,
      `${current}${separator}${current.length > 0 ? "\n" : ""}# Agent board (warlock board)\n${BOARD_DIRECTORY}/\n`,
      "utf8",
    );
    gitignoreUpdated = true;
  }

  return { directory: BOARD_DIRECTORY, created, gitignoreUpdated };
}

function parseItem(value: unknown): BoardItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const id = Reflect.get(value, "id");
  const title = Reflect.get(value, "title");
  const state = Reflect.get(value, "state");

  if (typeof id !== "number" || typeof title !== "string") return undefined;
  if (typeof state !== "string" || !isBoardState(state)) return undefined;

  const text = (key: string): string | null => {
    const field = Reflect.get(value, key);
    return typeof field === "string" ? field : null;
  };
  const history = Reflect.get(value, "history");

  return {
    id,
    title,
    state,
    assignee: text("assignee"),
    reviewer: text("reviewer"),
    createdAt: text("createdAt") ?? "",
    updatedAt: text("updatedAt") ?? "",
    history: Array.isArray(history)
      ? history.flatMap((entry: unknown) => {
          if (typeof entry !== "object" || entry === null) return [];

          const from = Reflect.get(entry, "from");
          const to = Reflect.get(entry, "to");
          const by = Reflect.get(entry, "by");
          const at = Reflect.get(entry, "at");
          const note = Reflect.get(entry, "note");

          if (typeof to !== "string" || !isBoardState(to)) return [];

          return [
            {
              from: typeof from === "string" && isBoardState(from) ? from : null,
              to,
              by: typeof by === "string" ? by : null,
              at: typeof at === "string" ? at : "",
              note: typeof note === "string" ? note : null,
            },
          ];
        })
      : [],
  };
}

function itemFile(root: string, id: number): string | undefined {
  const entry = numberedEntries(path.join(root, "items"), ".json").find(
    (candidate) => candidate.number === id,
  );

  return entry ? path.join(root, "items", entry.name) : undefined;
}

/** Every item, by id. Throws `WL7401` when the board does not exist. */
export function listBoardItems(cwd = process.cwd()): BoardItem[] {
  const root = assertInitialized(cwd);
  const directory = path.join(root, "items");

  return numberedEntries(directory, ".json").flatMap(({ name }) => {
    try {
      const item = parseItem(JSON.parse(readFileSync(path.join(directory, name), "utf8")));
      return item ? [item] : [];
    } catch {
      return [];
    }
  });
}

/** One item. Throws `WL7402` for an unknown id. */
export function readBoardItem(id: number, cwd = process.cwd()): BoardItem {
  const root = assertInitialized(cwd);
  const file = itemFile(root, id);
  const item = file ? parseItem(JSON.parse(readFileSync(file, "utf8"))) : undefined;

  if (!item) {
    throw new WarlockError(
      "WL7402",
      `Board item ${id} does not exist. Run \`warlock board status\` to list the items.`,
    );
  }

  return item;
}

/** Add an item in state `todo`, with a fresh id no other writer can take. */
export function addBoardItem(input: AddBoardItemInput, cwd = process.cwd()): BoardItem {
  const root = assertInitialized(cwd);
  const title = input.title.replace(/[\r\n]+/g, " ").trim();

  if (title.length === 0) throw new Error("A board item needs a title.");

  for (const [label, name] of [
    ["assignee", input.assignee],
    ["reviewer", input.reviewer],
    ["by", input.by],
  ] as const) {
    if (name) assertAgentName(name, label);
  }

  const directory = path.join(root, "items");
  const id = nextNumber(directory, ".json");
  const at = (input.now ?? (() => new Date()))().toISOString();
  const item: BoardItem = {
    id,
    title,
    state: "todo",
    assignee: input.assignee ?? null,
    reviewer: input.reviewer ?? null,
    createdAt: at,
    updatedAt: at,
    history: [{ from: null, to: "todo", by: input.by ?? null, at, note: null }],
  };

  writeAtomic(
    path.join(directory, `${pad(id)}-${boardSlug(title, "item")}.json`),
    `${JSON.stringify(item, null, 2)}\n`,
  );

  return item;
}

/** The states an item in `state` may move to. */
export function nextBoardStates(state: BoardState): readonly BoardState[] {
  return BOARD_TRANSITIONS[state];
}

/** Throw `WL7403` unless `from → to` is in {@link BOARD_TRANSITIONS}. */
export function assertBoardTransition(id: number, from: BoardState, to: BoardState): void {
  if (!BOARD_TRANSITIONS[from].includes(to)) {
    throw new WarlockError(
      "WL7403",
      `Board item ${id} is "${from}" and cannot move to "${to}". Allowed next states: ${BOARD_TRANSITIONS[from].join(", ")}.`,
    );
  }
}

/**
 * Move an item to another state, recording who moved it and why. Throws
 * `WL7402` for an unknown id and `WL7403` for a move the state machine does
 * not allow.
 */
export function moveBoardItem(
  id: number,
  to: BoardState,
  options: MoveBoardItemOptions = {},
  cwd = process.cwd(),
): BoardItem {
  const root = assertInitialized(cwd);
  const item = readBoardItem(id, cwd);
  const file = itemFile(root, id);

  if (options.by) assertAgentName(options.by, "by");

  assertBoardTransition(id, item.state, to);

  const at = (options.now ?? (() => new Date()))().toISOString();
  const moved: BoardItem = {
    ...item,
    state: to,
    updatedAt: at,
    history: [
      ...item.history,
      { from: item.state, to, by: options.by ?? null, at, note: options.note ?? null },
    ],
  };

  if (file) writeAtomic(file, `${JSON.stringify(moved, null, 2)}\n`);

  return moved;
}

function inboxDirectory(root: string, agent: string): string {
  return path.join(root, `to-${agent}`);
}

/**
 * Write a message to `to-<agent>/NNNN-<slug>.md`. Messages are append-only:
 * the number is reserved exclusively and the file is created with `wx`, so it
 * is never rewritten. A verdict with an `item` also moves the item to
 * `approved` / `changes-requested` — before the message is written, so a
 * refused move (`WL7403`) leaves no message behind.
 */
export function sendBoardMessage(
  input: SendBoardMessageInput,
  cwd = process.cwd(),
): SendBoardMessageResult {
  const root = assertInitialized(cwd);

  assertAgentName(input.to, "recipient");
  assertAgentName(input.from, "sender");

  const subject = input.subject.replace(/[\r\n]+/g, " ").trim();

  if (subject.length === 0) throw new Error("A board message needs a subject.");

  const itemId = input.item ?? null;
  const verdict = input.verdict ?? null;
  const now = input.now ?? (() => new Date());

  if (itemId !== null) readBoardItem(itemId, cwd);

  const item =
    itemId !== null && verdict !== null
      ? moveBoardItem(itemId, verdict, { by: input.from, note: subject, now }, cwd)
      : null;

  const directory = inboxDirectory(root, input.to);

  mkdirSync(directory, { recursive: true });

  const number = nextNumber(directory, ".md");
  const at = now().toISOString();
  const name = `${pad(number)}-${boardSlug(subject, "message")}.md`;
  const file = path.join(directory, name);

  writeFileSync(
    file,
    formatBoardMessage(
      { from: input.from, to: input.to, item: itemId, subject, at },
      input.body ?? "",
      verdict,
    ),
    { encoding: "utf8", flag: "wx" },
  );

  return {
    message: {
      number,
      file: toPosix(path.relative(cwd, file)),
      from: input.from,
      to: input.to,
      item: itemId,
      subject,
      at,
      body: (input.body ?? "").replace(/\s+$/, ""),
      verdict,
    },
    item,
  };
}

/** The messages in an agent's inbox numbered above `since`, oldest first. */
export function listBoardMessages(
  agent: string,
  options: { since?: number } = {},
  cwd = process.cwd(),
): BoardMessage[] {
  const root = assertInitialized(cwd);

  assertAgentName(agent);

  const directory = inboxDirectory(root, agent);
  const since = options.since ?? 0;

  return numberedEntries(directory, ".md")
    .filter((entry) => entry.number > since)
    .map(({ number, name }) => {
      const file = path.join(directory, name);
      const parsed = parseBoardMessage(readFileSync(file, "utf8"));

      return {
        number,
        file: toPosix(path.relative(cwd, file)),
        from: parsed.from,
        to: parsed.to || agent,
        item: parsed.item,
        subject: parsed.subject,
        at: parsed.at,
        body: parsed.body,
        verdict: parsed.verdict,
      };
    });
}

/** The highest message number `watch` has returned to `agent` (0 when none). */
export function readBoardCursor(agent: string, cwd = process.cwd()): number {
  const root = assertInitialized(cwd);

  assertAgentName(agent);

  const file = path.join(root, "cursors", agent);

  if (!existsSync(file)) return 0;

  const value = Number.parseInt(readFileSync(file, "utf8").trim(), 10);

  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** Record that `agent` has seen messages up to `number`. Never moves the cursor back. */
export function writeBoardCursor(agent: string, number: number, cwd = process.cwd()): number {
  const root = assertInitialized(cwd);
  const current = readBoardCursor(agent, cwd);
  const next = Math.max(current, number);

  if (next !== current) {
    mkdirSync(path.join(root, "cursors"), { recursive: true });
    writeAtomic(path.join(root, "cursors", agent), `${next}\n`);
  }

  return next;
}

/** Every item and every inbox with its message count, cursor and unread count. */
export function readBoardStatus(cwd = process.cwd()): BoardStatus {
  const root = assertInitialized(cwd);
  const inboxes: BoardInbox[] = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("to-"))
    .map((entry) => entry.name.slice(3))
    .filter((agent) => /^[a-z0-9][a-z0-9-]*$/.test(agent))
    .sort()
    .map((agent) => {
      const numbers = numberedEntries(inboxDirectory(root, agent), ".md").map(
        (entry) => entry.number,
      );
      const cursor = readBoardCursor(agent, cwd);

      return {
        agent,
        messages: numbers.length,
        cursor,
        unread: numbers.filter((number) => number > cursor).length,
      };
    });

  return { schemaVersion: 1, items: listBoardItems(cwd), inboxes };
}

/**
 * Block until `agent` has a message numbered above `since` (default: its
 * cursor), then return every such message and advance the cursor past them.
 *
 * Polls the inbox every `intervalMs`; throws `WL7404` when `timeoutMs` passes
 * first. An aborted `signal` resolves with no messages.
 */
export async function watchBoard(
  options: WatchBoardOptions,
  cwd = process.cwd(),
): Promise<WatchBoardResult> {
  assertInitialized(cwd);
  assertAgentName(options.agent);

  const since = options.since ?? readBoardCursor(options.agent, cwd);
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const messages = listBoardMessages(options.agent, { since }, cwd);

    if (messages.length > 0) {
      const newest = messages[messages.length - 1]?.number ?? since;

      return {
        agent: options.agent,
        messages,
        cursor: writeBoardCursor(options.agent, newest, cwd),
      };
    }

    if (options.signal?.aborted) {
      return { agent: options.agent, messages: [], cursor: readBoardCursor(options.agent, cwd) };
    }

    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      throw new WarlockError(
        "WL7404",
        `No new message for "${options.agent}" after ${Math.round(timeoutMs / 1000)}s (watching messages above #${since}).`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}
