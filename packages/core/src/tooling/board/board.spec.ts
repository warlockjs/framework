import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WarlockError } from "../../errors/warlock-error";
import {
  addBoardItem,
  gitignoreCoversBoard,
  initBoard,
  listBoardMessages,
  moveBoardItem,
  readBoardCursor,
  readBoardItem,
  readBoardStatus,
  sendBoardMessage,
  watchBoard,
} from "./board";
import { formatBoardMessage, parseBoardMessage } from "./board-message";
import { BOARD_STATES, BOARD_TRANSITIONS } from "./board.types";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), "warlock-board-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof WarlockError ? error.code : `not coded: ${String(error)}`;
  }

  return undefined;
}

describe("initBoard", () => {
  it("creates the board and git-ignores it, creating .gitignore when missing", () => {
    const result = initBoard(cwd);

    expect(result).toEqual({ directory: ".warlock/board", created: true, gitignoreUpdated: true });
    expect(existsSync(path.join(cwd, ".warlock/board/board.json"))).toBe(true);
    expect(readFileSync(path.join(cwd, ".gitignore"), "utf8")).toContain(".warlock/board/\n");
  });

  it("appends to an existing .gitignore and is idempotent", () => {
    writeFileSync(path.join(cwd, ".gitignore"), "node_modules/");

    initBoard(cwd);
    const second = initBoard(cwd);
    const content = readFileSync(path.join(cwd, ".gitignore"), "utf8");

    expect(second.created).toBe(false);
    expect(second.gitignoreUpdated).toBe(false);
    expect(content.startsWith("node_modules/\n")).toBe(true);
    expect(content.match(/\.warlock\/board\//g)).toHaveLength(1);
  });

  it("leaves .gitignore alone when .warlock is already ignored", () => {
    writeFileSync(path.join(cwd, ".gitignore"), "dist/\n.warlock/\n");

    expect(initBoard(cwd).gitignoreUpdated).toBe(false);
    expect(readFileSync(path.join(cwd, ".gitignore"), "utf8")).toBe("dist/\n.warlock/\n");
  });

  it("recognises the ignore lines that cover the board", () => {
    expect(gitignoreCoversBoard("/.warlock\n")).toBe(true);
    expect(gitignoreCoversBoard(".warlock/board\n")).toBe(true);
    expect(gitignoreCoversBoard(".warlock/cache\n")).toBe(false);
  });

  it("refuses every other operation before init with WL7401", () => {
    expect(codeOf(() => readBoardStatus(cwd))).toBe("WL7401");
    expect(codeOf(() => addBoardItem({ title: "x" }, cwd))).toBe("WL7401");
  });
});

describe("items and the state machine", () => {
  beforeEach(() => {
    initBoard(cwd);
  });

  it("allocates increasing ids, one file per item", () => {
    const first = addBoardItem({ title: "Add the orders module", assignee: "implementer" }, cwd);
    const second = addBoardItem({ title: "Fix pagination", reviewer: "reviewer" }, cwd);

    expect([first.id, second.id]).toEqual([1, 2]);
    expect(first.state).toBe("todo");
    expect(
      readdirSync(path.join(cwd, ".warlock/board/items")).filter((name) => !name.startsWith(".")),
    ).toEqual(["0001-add-the-orders-module.json", "0002-fix-pagination.json"]);
  });

  it("never reuses a reserved number, even when the item file is gone", () => {
    addBoardItem({ title: "one" }, cwd);
    rmSync(path.join(cwd, ".warlock/board/items/0001-one.json"));

    expect(addBoardItem({ title: "two" }, cwd).id).toBe(2);
  });

  it("allows every transition in the table and records history", () => {
    const item = addBoardItem({ title: "Work" }, cwd);

    moveBoardItem(item.id, "in-progress", { by: "implementer" }, cwd);
    moveBoardItem(item.id, "ready-for-review", { by: "implementer", note: "done" }, cwd);
    moveBoardItem(item.id, "changes-requested", { by: "reviewer" }, cwd);
    moveBoardItem(item.id, "in-progress", {}, cwd);
    moveBoardItem(item.id, "ready-for-review", {}, cwd);
    const approved = moveBoardItem(item.id, "approved", { by: "reviewer" }, cwd);

    expect(approved.state).toBe("approved");
    expect(approved.history.map((entry) => entry.to)).toEqual([
      "todo",
      "in-progress",
      "ready-for-review",
      "changes-requested",
      "in-progress",
      "ready-for-review",
      "approved",
    ]);
    expect(approved.history[2]).toMatchObject({
      from: "in-progress",
      by: "implementer",
      note: "done",
    });
    expect(readBoardItem(item.id, cwd).state).toBe("approved");
  });

  it("refuses every transition not in the table with WL7403 naming the next states", () => {
    for (const from of BOARD_STATES) {
      for (const to of BOARD_STATES) {
        if (BOARD_TRANSITIONS[from].includes(to)) continue;

        const item = addBoardItem({ title: `${from} to ${to}` }, cwd);
        const steps = findPath(from);

        for (const step of steps) moveBoardItem(item.id, step, {}, cwd);

        let message = "";

        try {
          moveBoardItem(item.id, to, {}, cwd);
        } catch (error) {
          expect(error).toBeInstanceOf(WarlockError);
          expect(error instanceof WarlockError ? error.code : "").toBe("WL7403");
          message = error instanceof Error ? error.message : "";
        }

        expect(message, `${from} → ${to}`).toContain(BOARD_TRANSITIONS[from].join(", "));
      }
    }
  });

  it("answers an unknown id with WL7402", () => {
    expect(codeOf(() => readBoardItem(9, cwd))).toBe("WL7402");
    expect(codeOf(() => moveBoardItem(9, "in-progress", {}, cwd))).toBe("WL7402");
  });
});

/** The moves that take a new item (in `todo`) to `state`. */
function findPath(state: (typeof BOARD_STATES)[number]): (typeof BOARD_STATES)[number][] {
  const paths: Record<(typeof BOARD_STATES)[number], (typeof BOARD_STATES)[number][]> = {
    todo: [],
    "in-progress": ["in-progress"],
    "ready-for-review": ["in-progress", "ready-for-review"],
    "changes-requested": ["in-progress", "ready-for-review", "changes-requested"],
    approved: ["in-progress", "ready-for-review", "approved"],
    blocked: ["blocked"],
  };

  return paths[state];
}

describe("messages", () => {
  beforeEach(() => {
    initBoard(cwd);
  });

  it("numbers messages per recipient and never rewrites one", () => {
    const first = sendBoardMessage(
      { to: "reviewer", from: "implementer", subject: "Ready", body: "Look" },
      cwd,
    );
    const second = sendBoardMessage(
      { to: "reviewer", from: "implementer", subject: "Also this" },
      cwd,
    );
    const other = sendBoardMessage(
      { to: "implementer", from: "reviewer", subject: "Question" },
      cwd,
    );

    expect([first.message.number, second.message.number, other.message.number]).toEqual([1, 2, 1]);
    expect(first.message.file).toBe(".warlock/board/to-reviewer/0001-ready.md");

    const before = readFileSync(path.join(cwd, first.message.file), "utf8");

    sendBoardMessage({ to: "reviewer", from: "implementer", subject: "Ready" }, cwd);

    expect(readFileSync(path.join(cwd, first.message.file), "utf8")).toBe(before);
    expect(listBoardMessages("reviewer", {}, cwd).map((message) => message.subject)).toEqual([
      "Ready",
      "Also this",
      "Ready",
    ]);
    expect(listBoardMessages("reviewer", { since: 2 }, cwd)).toHaveLength(1);
  });

  it("writes the verdict as the last line and moves the item", () => {
    const item = addBoardItem({ title: "Orders" }, cwd);

    moveBoardItem(item.id, "in-progress", {}, cwd);
    moveBoardItem(item.id, "ready-for-review", {}, cwd);

    const result = sendBoardMessage(
      {
        to: "implementer",
        from: "reviewer",
        subject: "Review of orders",
        body: "Rename the resource.",
        item: item.id,
        verdict: "changes-requested",
      },
      cwd,
    );
    const text = readFileSync(path.join(cwd, result.message.file), "utf8");

    expect(text.trimEnd().split("\n").pop()).toBe("VERDICT: CHANGES REQUESTED");
    expect(result.item?.state).toBe("changes-requested");
    expect(readBoardItem(item.id, cwd).history.at(-1)).toMatchObject({ by: "reviewer" });

    const [read] = listBoardMessages("implementer", {}, cwd);

    expect(read).toMatchObject({
      from: "reviewer",
      item: item.id,
      verdict: "changes-requested",
      body: "Rename the resource.",
    });
  });

  it("refuses a verdict the item's state does not allow, writing no message", () => {
    const item = addBoardItem({ title: "Not started" }, cwd);

    expect(
      codeOf(() =>
        sendBoardMessage(
          {
            to: "implementer",
            from: "reviewer",
            subject: "ok",
            item: item.id,
            verdict: "approved",
          },
          cwd,
        ),
      ),
    ).toBe("WL7403");
    expect(existsSync(path.join(cwd, ".warlock/board/to-implementer"))).toBe(false);
  });

  it("rejects invalid agent names", () => {
    expect(() => sendBoardMessage({ to: "Reviewer!", from: "a", subject: "x" }, cwd)).toThrow(
      /Invalid recipient/,
    );
  });

  it("reports items and inbox counts in the status", () => {
    addBoardItem({ title: "A" }, cwd);
    sendBoardMessage({ to: "reviewer", from: "implementer", subject: "one" }, cwd);
    sendBoardMessage({ to: "reviewer", from: "implementer", subject: "two" }, cwd);

    const status = readBoardStatus(cwd);

    expect(status.items).toHaveLength(1);
    expect(status.inboxes).toEqual([{ agent: "reviewer", messages: 2, cursor: 0, unread: 2 }]);
  });
});

describe("message format", () => {
  it("round-trips front matter, body and verdict", () => {
    const text = formatBoardMessage(
      {
        from: "reviewer",
        to: "implementer",
        item: 4,
        subject: "Looks good",
        at: "2026-01-01T00:00:00.000Z",
      },
      "Ship it.\n",
      "approved",
    );

    expect(text).toContain("\nVERDICT: APPROVED\n");
    expect(parseBoardMessage(text)).toEqual({
      from: "reviewer",
      to: "implementer",
      item: 4,
      subject: "Looks good",
      at: "2026-01-01T00:00:00.000Z",
      body: "Ship it.",
      verdict: "approved",
    });
  });

  it("only reads a verdict from the last line", () => {
    const parsed = parseBoardMessage("---\nfrom: a\n---\n\nVERDICT: APPROVED\nbut not yet\n");

    expect(parsed.verdict).toBeNull();
    expect(parsed.body).toBe("VERDICT: APPROVED\nbut not yet");
  });
});

describe("watchBoard", () => {
  beforeEach(() => {
    initBoard(cwd);
  });

  it("returns a message written while it waits, then advances the cursor", async () => {
    const watching = watchBoard({ agent: "reviewer", timeoutMs: 5_000, intervalMs: 20 }, cwd);

    setTimeout(() => {
      sendBoardMessage({ to: "reviewer", from: "implementer", subject: "Ready for review" }, cwd);
    }, 60);

    const result = await watching;

    expect(result.messages.map((message) => message.subject)).toEqual(["Ready for review"]);
    expect(result.cursor).toBe(1);
    expect(readBoardCursor("reviewer", cwd)).toBe(1);
    expect(readBoardStatus(cwd).inboxes[0]?.unread).toBe(0);
  });

  it("returns already-unread messages at once", async () => {
    sendBoardMessage({ to: "reviewer", from: "implementer", subject: "one" }, cwd);
    sendBoardMessage({ to: "reviewer", from: "implementer", subject: "two" }, cwd);

    const result = await watchBoard({ agent: "reviewer", timeoutMs: 1_000 }, cwd);

    expect(result.messages).toHaveLength(2);
    expect(result.cursor).toBe(2);
  });

  it("honours --since over the cursor", async () => {
    sendBoardMessage({ to: "reviewer", from: "implementer", subject: "one" }, cwd);
    sendBoardMessage({ to: "reviewer", from: "implementer", subject: "two" }, cwd);

    const result = await watchBoard({ agent: "reviewer", since: 1, timeoutMs: 1_000 }, cwd);

    expect(result.messages.map((message) => message.number)).toEqual([2]);
  });

  it("times out with WL7404 when nothing arrives", async () => {
    sendBoardMessage({ to: "reviewer", from: "implementer", subject: "seen" }, cwd);
    await watchBoard({ agent: "reviewer", timeoutMs: 1_000 }, cwd);

    const startedAt = Date.now();

    await expect(
      watchBoard({ agent: "reviewer", timeoutMs: 120, intervalMs: 20 }, cwd),
    ).rejects.toMatchObject({
      code: "WL7404",
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
