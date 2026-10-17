import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBoardInvocation, runBoardInvocation } from "./board-command.action";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), "warlock-board-cli-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("parseBoardInvocation", () => {
  it("parses every action", () => {
    expect(parseBoardInvocation(["init"], {}, cwd, {})).toEqual({ type: "init" });
    expect(
      parseBoardInvocation(["add", "Add", "orders"], { assignee: "implementer" }, cwd, {}),
    ).toEqual({
      type: "add",
      title: "Add orders",
      assignee: "implementer",
      reviewer: null,
      by: null,
    });
    expect(parseBoardInvocation(["status"], {}, cwd, {})).toEqual({ type: "overview" });
    expect(parseBoardInvocation(["status", "3"], {}, cwd, {})).toEqual({ type: "item", id: 3 });
    expect(
      parseBoardInvocation(["status", "3", "ready-for-review"], { note: "done" }, cwd, {
        WARLOCK_AGENT: "implementer",
      }),
    ).toEqual({ type: "move", id: 3, state: "ready-for-review", by: "implementer", note: "done" });
    expect(
      parseBoardInvocation(["watch", "reviewer"], { timeout: "1.5", since: "4" }, cwd, {}),
    ).toEqual({
      type: "watch",
      agent: "reviewer",
      timeoutMs: 1500,
      since: 4,
    });
  });

  it("reads --body @file and validates the verdict", () => {
    writeFileSync(path.join(cwd, "review.md"), "Looks fine.\n");

    expect(
      parseBoardInvocation(
        ["send", "implementer", "Review", "done"],
        { from: "reviewer", body: "@review.md", item: "2", verdict: "approved" },
        cwd,
        {},
      ),
    ).toEqual({
      type: "send",
      to: "implementer",
      from: "reviewer",
      subject: "Review done",
      body: "Looks fine.\n",
      item: 2,
      verdict: "approved",
    });
    expect(() =>
      parseBoardInvocation(
        ["send", "implementer", "x"],
        { from: "reviewer", verdict: "lgtm" },
        cwd,
        {},
      ),
    ).toThrow(/--verdict/);
    expect(() => parseBoardInvocation(["send", "implementer", "x"], {}, cwd, {})).toThrow(/--from/);
  });

  it("refuses unknown actions, states and ids", () => {
    expect(() => parseBoardInvocation(["publish"], {}, cwd, {})).toThrow(
      /Unknown board action "publish"/,
    );
    expect(() => parseBoardInvocation(["status", "1", "done"], {}, cwd, {})).toThrow(
      /Unknown state/,
    );
    expect(() => parseBoardInvocation(["status", "x"], {}, cwd, {})).toThrow(
      /positive whole number/,
    );
    expect(() => parseBoardInvocation(["watch", "reviewer"], { timeout: "0" }, cwd, {})).toThrow(
      /--timeout/,
    );
  });
});

describe("runBoardInvocation", () => {
  it("drives a review loop end to end", async () => {
    await runBoardInvocation({ type: "init" }, cwd);
    await runBoardInvocation(
      { type: "add", title: "Orders", assignee: "implementer", reviewer: "reviewer", by: null },
      cwd,
    );
    await runBoardInvocation(
      { type: "move", id: 1, state: "in-progress", by: "implementer", note: null },
      cwd,
    );
    await runBoardInvocation(
      { type: "move", id: 1, state: "ready-for-review", by: "implementer", note: null },
      cwd,
    );

    const sent = await runBoardInvocation(
      {
        type: "send",
        to: "implementer",
        from: "reviewer",
        subject: "Review",
        body: "",
        item: 1,
        verdict: "approved",
      },
      cwd,
    );
    const watched = await runBoardInvocation(
      { type: "watch", agent: "implementer", timeoutMs: 1_000, since: undefined },
      cwd,
    );
    const overview = await runBoardInvocation({ type: "overview" }, cwd);

    expect(sent.lines).toEqual([
      "Wrote .warlock/board/to-implementer/0001-review.md",
      "Moved #1 [approved] Orders  (implementer → reviewer)",
    ]);
    expect(watched.lines).toContain("VERDICT: APPROVED");
    expect(overview.json).toMatchObject({ ok: true, items: [{ id: 1, state: "approved" }] });
  });
});
