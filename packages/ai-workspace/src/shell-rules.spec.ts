import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { WorkspacePolicyError } from "./errors";
import { workspace } from "./workspace";
import { classifyShellCommand, checkShellCommand } from "./policy/shell-check";
import type { WorkspaceShellOnAsk, WorkspaceShellPolicy } from "./contracts";

let cwd = "";

beforeAll(() => {
  cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-rules-")));
});

function build(shell: WorkspaceShellPolicy) {
  return workspace({
    cwd,
    backend: "mock",
    shell: { interpreter: "sh", ...shell },
  });
}

const rules: WorkspaceShellPolicy["rules"] = [
  { match: "git status", effect: "allow" },
  { match: "git push", effect: "ask", reason: "Pushing publishes work." },
  { match: "rm -rf", effect: "deny", reason: "Recursive deletes are not allowed." },
];

describe("shell rules (allow / ask / deny)", () => {
  it("runs an allowed command without asking", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true }));
    const ws = build({ rules, onAsk });

    await expect(ws.exec("git status -s")).resolves.toMatchObject({ exitCode: 0 });
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("asks once for an ask rule", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true }));
    const ws = build({ rules, onAsk });

    await ws.exec("git push origin main");

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk.mock.calls[0]?.[0].asks).toHaveLength(1);
    expect(onAsk.mock.calls[0]?.[0].asks[0]).toMatchObject({
      argv: ["git", "push", "origin", "main"],
      reason: "rule",
      rule: { effect: "ask", reason: "Pushing publishes work." },
    });
  });

  it("refuses a denied command without calling onAsk", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true }));
    const ws = build({ rules, onAsk });
    const error = await ws.exec("rm -rf dist").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspacePolicyError);
    expect((error as WorkspacePolicyError).reason).toBe("denied-pattern");
    expect((error as WorkspacePolicyError).message).toContain("Recursive deletes");
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("asks once for a chain with exactly one ask entry", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true }));
    const ws = build({ rules, onAsk });

    await ws.exec("git status && git push");

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk.mock.calls[0]?.[0].asks).toHaveLength(1);
  });

  it("denies a line when any command in it is denied", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true }));
    const ws = build({ rules, onAsk });

    await expect(ws.exec("git push; rm -rf x")).rejects.toMatchObject({ reason: "denied-pattern" });
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("lets the last matching rule win", () => {
    const verdict = checkShellCommand(
      {
        cwd,
        shell: {
          interpreter: "sh",
          rules: [
            { match: "git", effect: "deny" },
            { match: "git log", effect: "allow" },
          ],
        },
      },
      "git log",
    );

    expect(verdict.allowed).toBe(true);
  });

  it("remembers an approval for later commands, but never over a deny", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true, remember: "git push" }));
    const ws = build({ rules, onAsk });

    await ws.exec("git push origin main");
    await ws.exec("git push origin dev");

    expect(onAsk).toHaveBeenCalledTimes(1);

    const denied = build({
      rules: [{ match: "git push", effect: "ask" }],
      denyPatterns: ["git push --force"],
      onAsk,
    });

    await denied.exec("git push origin a");
    await expect(denied.exec("git push --force")).rejects.toMatchObject({
      reason: "denied-pattern",
    });
  });

  it("shares remembered approvals with the workspace's views", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true, remember: "git push" }));
    const ws = build({ rules, onAsk });

    await ws.exec("git push");
    await ws.scope(".").exec("git push origin x");

    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it("refuses with approval-denied when the host says no or throws", async () => {
    const no = build({ rules, onAsk: async () => ({ allow: false }) });
    const boom = build({
      rules,
      onAsk: async () => {
        throw new Error("no UI");
      },
    });

    await expect(no.exec("git push")).rejects.toMatchObject({ reason: "approval-denied" });
    await expect(boom.exec("git push")).rejects.toMatchObject({ reason: "approval-denied" });
  });

  it("refuses an ask rule with approval-required when there is no onAsk", async () => {
    const ws = build({ rules });

    await expect(ws.exec("git push")).rejects.toMatchObject({ reason: "approval-required" });
    await expect(ws.exec("ls")).resolves.toMatchObject({ exitCode: 0 });
  });

  it("asks about commands no rule matches when onAsk is set", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true }));
    const ws = build({ rules, onAsk });

    await ws.exec("ls -la");

    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it("turns unreadable syntax into an unparsed ask, never an allow", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: false }));
    const ws = build({ rules, onAsk });

    await expect(ws.exec("if true; then ls; fi")).rejects.toMatchObject({
      reason: "approval-denied",
    });
    expect(onAsk.mock.calls[0]?.[0].asks[0]?.reason).toBe("unparsed");

    const unreadable = checkShellCommand(
      { cwd, shell: { interpreter: "sh", rules, onAsk } },
      "echo {a,b}",
    );

    expect(unreadable.allowed).toBe(false);
    expect(unreadable.asks[0]?.reason).toBe("unparsed");
  });

  it("asks about a runner it cannot see into as nested", () => {
    const verdict = checkShellCommand(
      { cwd, shell: { interpreter: "sh", rules, onAsk: async () => ({ allow: true }) } },
      "bash -c 'git push'",
    );

    expect(verdict.asks[0]?.reason).toBe("nested");
  });

  it("asks through the command a wrapper runs, not the wrapper", () => {
    const verdict = checkShellCommand(
      { cwd, shell: { interpreter: "sh", rules, onAsk: async () => ({ allow: true }) } },
      "time git push",
    );

    expect(verdict.asks.map((ask) => ask.argv.join(" "))).toEqual(["git push"]);
  });

  it("passes the invocation's signal to onAsk", async () => {
    const onAsk = vi.fn<WorkspaceShellOnAsk>(async () => ({ allow: true }));
    const ws = build({ rules, onAsk });
    const controller = new AbortController();

    await ws.exec("git push", { signal: controller.signal });

    expect(onAsk.mock.calls[0]?.[0].signal).toBe(controller.signal);
  });

  it("classifies a line into its simple commands", () => {
    expect(classifyShellCommand("a | b")).toEqual({ commands: [["a"], ["b"]] });
    expect(classifyShellCommand("a && b; c $(d e)").commands).toEqual([
      ["a"],
      ["b"],
      ["d", "e"],
      ["c", "$(d e)"],
    ]);
    expect(classifyShellCommand("if x; then y; fi").opaque).toBeTypeOf("string");
    expect(build({}).shell.classify("a | b")).toEqual({ commands: [["a"], ["b"]] });
  });
});
