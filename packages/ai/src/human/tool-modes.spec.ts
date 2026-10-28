import { describe, expect, it, vi } from "vitest";
import type { MiddlewareToolContext } from "../contracts/middleware/middleware-context.type";
import type { ToolInvokeResult } from "../tool/tool";
import { approvalMemory } from "./approval-memory";
import type { ApprovalDecision } from "./contracts";
import { ApprovalRejectedError } from "./errors";
import { humanApproval } from "./human-approval";

function context(
  toolName: string,
  input: unknown = {},
  sessionId: string | undefined = "s1",
): MiddlewareToolContext {
  return {
    agent: { name: "support", isAnonymous: false },
    model: { name: "mock-model" },
    input: "go",
    options: sessionId ? { sessionId } : undefined,
    state: new Map<string, unknown>(),
    tripIndex: 0,
    messages: [],
    tool: { name: toolName, description: toolName },
    callId: "call_1",
    request: { id: "call_1", name: toolName, input },
  };
}

async function run(
  mw: ReturnType<typeof humanApproval>,
  ctx: MiddlewareToolContext,
): Promise<ToolInvokeResult<unknown> | void> {
  return mw.tool!.before!(ctx);
}

describe("humanApproval — per-tool modes", () => {
  it("allow skips the handler, deny refuses, ask routes to the handler", async () => {
    const handler = vi.fn((): ApprovalDecision => ({ type: "approve" }));
    const mw = humanApproval({
      tools: { read_file: "allow", delete_file: "deny", run_shell: "ask" },
      denyReason: "never delete",
      handler,
    });

    expect(await run(mw, context("read_file"))).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();

    const denied = await run(mw, context("delete_file"));

    expect(denied?.error).toBeInstanceOf(ApprovalRejectedError);
    expect(denied?.error?.message).toContain("never delete");
    expect(handler).not.toHaveBeenCalled();

    await run(mw, context("run_shell"));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("unlisted tools follow defaultMode, which defaults to ask", async () => {
    const handler = vi.fn((): ApprovalDecision => ({ type: "approve" }));

    await run(humanApproval({ tools: { a: "allow" }, handler }), context("other"));
    expect(handler).toHaveBeenCalledOnce();

    const allow = humanApproval({ tools: {}, defaultMode: "allow", handler });
    await run(allow, context("other"));
    expect(handler).toHaveBeenCalledOnce();

    const deny = humanApproval({ defaultMode: "deny", handler });
    expect((await run(deny, context("other")))?.error).toBeInstanceOf(ApprovalRejectedError);
  });

  it("a tools entry beats the policy; the policy decides for other tools", async () => {
    const handler = vi.fn((): ApprovalDecision => ({ type: "approve" }));
    const mw = humanApproval({
      policy: { type: "allowlist", tools: ["pay", "read"] },
      tools: { read: "allow" },
      handler,
    });

    await run(mw, context("read"));
    expect(handler).not.toHaveBeenCalled();

    await run(mw, context("pay"));
    expect(handler).toHaveBeenCalledOnce();

    await run(mw, context("unrelated"));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("needs something to decide with", () => {
    expect(() => humanApproval({ handler: () => ({ type: "approve" }) })).toThrow(TypeError);
  });
});

describe("humanApproval — remember for the session", () => {
  it("remember: 'tool' approves the tool for the rest of the session only", async () => {
    const handler = vi.fn((): ApprovalDecision => ({ type: "approve", remember: "tool" }));
    const mw = humanApproval({ tools: { run_shell: "ask" }, remember: true, handler });

    await run(mw, context("run_shell", { cmd: "ls" }));
    await run(mw, context("run_shell", { cmd: "pwd" }));
    expect(handler).toHaveBeenCalledOnce();

    await run(mw, context("run_shell", { cmd: "ls" }, "s2"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("remember: 'args' only covers identical arguments, whatever the key order", async () => {
    const handler = vi.fn((): ApprovalDecision => ({ type: "approve", remember: "args" }));
    const mw = humanApproval({ tools: { run_shell: "ask" }, remember: true, handler });

    await run(mw, context("run_shell", { cmd: "ls", cwd: "/" }));
    await run(mw, context("run_shell", { cwd: "/", cmd: "ls" }));
    expect(handler).toHaveBeenCalledOnce();

    await run(mw, context("run_shell", { cmd: "rm" }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("ignores remember without the option, without a session, and for reject or edit", async () => {
    const approve = vi.fn((): ApprovalDecision => ({ type: "approve", remember: "tool" }));

    const plain = humanApproval({ tools: { t: "ask" }, handler: approve });
    await run(plain, context("t"));
    await run(plain, context("t"));
    expect(approve).toHaveBeenCalledTimes(2);

    const noSession = humanApproval({ tools: { t: "ask" }, remember: true, handler: approve });
    await run(noSession, context("t", {}, undefined));
    await run(noSession, context("t", {}, undefined));
    expect(approve).toHaveBeenCalledTimes(4);

    const reject = vi.fn((): ApprovalDecision => ({ type: "reject", reason: "no" }));
    const rejecting = humanApproval({ tools: { t: "ask" }, remember: true, handler: reject });
    await run(rejecting, context("t"));
    await run(rejecting, context("t"));
    expect(reject).toHaveBeenCalledTimes(2);
  });

  it("uses a caller-owned memory that can be cleared", async () => {
    const memory = approvalMemory();
    const handler = vi.fn((): ApprovalDecision => ({ type: "approve", remember: "tool" }));
    const mw = humanApproval({ tools: { t: "ask" }, remember: { memory }, handler });

    await run(mw, context("t"));
    await run(mw, context("t"));
    expect(handler).toHaveBeenCalledOnce();

    memory.clear("s1");
    await run(mw, context("t"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest session beyond maxSessions", async () => {
    const memory = approvalMemory({ maxSessions: 1 });
    const entry = { type: "tool", toolName: "t" } as const;

    memory.add("a", entry);
    memory.add("b", entry);

    expect(memory.has("a", entry)).toBe(false);
    expect(memory.has("b", entry)).toBe(true);
  });
});
