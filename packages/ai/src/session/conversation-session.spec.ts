import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agent } from "../agent/agent";
import type {
  AgentSnapshot,
  Message,
  ModelContract,
  ModelResponse,
  ProviderContentBlock,
} from "../contracts";
import type { SnapshotStore } from "../contracts/orchestrator/snapshot-store.contract";
import { AgentExecutionError } from "../errors";
import { file } from "../snapshot/file";
import { memory } from "../snapshot/memory";
import { sqlite } from "../snapshot/sqlite";
import { tool } from "../tool/tool";
import { session } from "./conversation-session";
import type { ConversationSessionRecord } from "./conversation-session.type";

const signed = (signature: string): ProviderContentBlock[] => [
  { provider: "anthropic", type: "thinking", data: { type: "thinking", thinking: "", signature } },
  { provider: "anthropic", type: "text", data: { type: "text", text: `reply ${signature}` } },
];

/** A model that answers from a script, then echoes the last user message. */
function scriptedModel(script: Partial<ModelResponse>[] = [], delay = 0) {
  const calls: Message[][] = [];
  function respond(messages: Message[]): ModelResponse {
    const index = calls.length;
    calls.push(structuredClone(messages));
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    return {
      content: `reply to ${typeof lastUser?.content === "string" ? lastUser.content : "parts"}`,
      finishReason: "stop",
      usage: { input: 1, output: 1, total: 2 },
      ...script[index],
    };
  }
  const model: ModelContract = {
    name: "mock",
    provider: "mock",
    capabilities: { vision: true },
    complete: async (messages) => {
      const response = respond(messages);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return response;
    },
    async *stream(messages) {
      const response = respond(messages);
      if (response.content) yield { type: "delta", content: response.content };
      for (const call of response.toolCalls ?? []) yield { type: "tool-call", ...call };
      yield {
        type: "done",
        finishReason: response.finishReason,
        usage: response.usage,
        blocks: response.blocks,
      };
    },
  };
  return { model, calls };
}

const lookup = tool({ name: "lookup", description: "lookup", execute: async () => "42" });

describe("ai.session", () => {
  let dir: string;
  let store: SnapshotStore<ConversationSessionRecord>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-session-"));
    store = file({ dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists each turn, tool rounds and provider blocks included, and replays it next send", async () => {
    const { model, calls } = scriptedModel([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{ id: "call_1", name: "lookup", input: {} }],
      },
      { content: "It is 42.", blocks: signed("s1") },
    ]);
    const assistant = agent({ model, systemPrompt: "Be brief.", tools: [lookup] });
    const chat = session({ id: "user-1", store, agent: assistant });

    const first = await chat.send("What is the answer?");
    expect(first.text).toBe("It is 42.");

    const stored = await chat.history();
    expect(stored.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(stored[3]).toEqual({ role: "assistant", content: "It is 42.", blocks: signed("s1") });

    await chat.send("Thanks");

    // The second request: system prompt once, then the stored turn verbatim, then the input.
    expect(calls[2]?.[0]).toEqual({ role: "system", content: "Be brief." });
    expect(calls[2]?.slice(1, 5)).toEqual(stored);
    expect(calls[2]?.at(-1)).toEqual({ role: "user", content: "Thanks" });

    const record = await chat.load();
    expect(record).toMatchObject({ id: "user-1", runId: "session:user-1", turns: 2 });
    expect(record?.pending).toBeUndefined();
    expect(record?.messages).toHaveLength(6);
    // A second session object over the same store sees the same conversation.
    expect(await session({ id: "user-1", store, agent: assistant }).history()).toHaveLength(6);
  });

  it("serializes concurrent sends on one session id so history never interleaves", async () => {
    const { model, calls } = scriptedModel([], 20);
    const assistant = agent({ model });
    const one = session({ id: "shared", store, agent: assistant });
    const two = session({ id: "shared", store, agent: assistant });

    await Promise.all([one.send("first"), two.send("second"), one.send("third")]);

    expect(calls.map((messages) => messages.length)).toEqual([1, 3, 5]);
    expect((await one.history()).map((message) => message.content)).toEqual([
      "first",
      "reply to first",
      "second",
      "reply to second",
      "third",
      "reply to third",
    ]);
  });

  it("leaves the history unchanged when a run fails", async () => {
    const assistant = agent({
      model: {
        ...scriptedModel().model,
        complete: async () => {
          throw new Error("provider down");
        },
      },
    });
    const chat = session({ id: "failing", store, agent: assistant });
    const result = await chat.send("hello");

    expect(result.error).toBeDefined();
    expect(await chat.history()).toEqual([]);
    expect((await chat.load())?.pending).toBeUndefined();
  });

  it("streams events and saves the turn before the result settles", async () => {
    const assistant = agent({ model: scriptedModel().model });
    const chat = session({ id: "streamed", store, agent: assistant });
    const stream = chat.stream("hi");
    const deltas: string[] = [];

    for await (const event of stream) {
      if (event.type === "agent.trip.streaming") deltas.push(event.delta);
    }

    expect(deltas.join("")).toBe("reply to hi");
    expect((await stream.result).text).toBe("reply to hi");
    expect(await chat.history()).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "reply to hi" },
    ]);
  });

  it("keeps multipart user turns (attachments) intact across sends", async () => {
    const { model, calls } = scriptedModel();
    const chat = session({ id: "vision", store, agent: agent({ model }) });

    await chat.send("describe", {
      attachments: [{ type: "image", source: { url: "https://example.com/cat.png" } }],
    });
    await chat.send("and again");

    const parts = [
      { type: "text", text: "describe" },
      { type: "image", source: { url: "https://example.com/cat.png" } },
    ];
    expect((await chat.history())[0]?.content).toEqual(parts);
    expect(calls[1]?.[0]?.content).toEqual(parts);
  });

  it("forks a prefix into a new id and truncates without splitting a tool round", async () => {
    const { model } = scriptedModel([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{ id: "call_1", name: "lookup", input: {} }],
      },
    ]);
    const chat = session({ id: "main", store, agent: agent({ model, tools: [lookup] }) });

    await chat.send("one");
    await chat.send("two");
    expect(await chat.history()).toHaveLength(6);

    const branch = await chat.fork("branch", { messageCount: 4 });
    expect(branch.id).toBe("branch");
    expect(await branch.history()).toEqual((await chat.history()).slice(0, 4));
    expect((await branch.load())?.forkedFrom).toEqual({ id: "main", messageCount: 4 });
    await expect(chat.fork("branch")).rejects.toThrow(/already exists/);
    await expect(chat.fork("main")).rejects.toThrow(AgentExecutionError);

    await expect(chat.truncate(2)).rejects.toThrow(/separate tool call "call_1"/);
    await expect(chat.truncate(7)).rejects.toThrow(/between 0 and 6/);
    await chat.truncate(4);
    expect(await chat.history()).toHaveLength(4);

    await chat.clear();
    expect(await chat.load()).toBeUndefined();
    expect(await branch.history()).toHaveLength(4);
  });

  it("stores the compacted conversation when the agent compacts long history", async () => {
    const { model, calls } = scriptedModel();
    const assistant = agent({
      model,
      compaction: {
        afterTokens: 450,
        keep: 1,
        countTokens: (messages) => messages.length * 100,
        summarize: (slice) => ({
          summary: { role: "assistant", content: "earlier turns" },
          replacesFromIndex: 0,
          replacesToIndex: slice.length - 1,
        }),
      },
    });
    const chat = session({ id: "long", store, agent: assistant });

    await chat.send("one");
    await chat.send("two");
    await chat.send("three");

    // The third request crossed the threshold and was compacted before generation.
    expect(calls[2]?.[0]).toMatchObject({ role: "user", compaction: "summary" });
    const stored = await chat.history();
    expect(stored[0]).toEqual({
      role: "user",
      content: "Summary of earlier conversation:\nearlier turns",
      compaction: "summary",
    });
    expect(stored.slice(-2)).toEqual([
      { role: "user", content: "three" },
      { role: "assistant", content: "reply to three" },
    ]);
  });

  it("resumes a send left pending by a crash through the durable agent", async () => {
    const snapshots = memory<AgentSnapshot>();
    const assistant = agent({ model: scriptedModel().model, durable: { store: snapshots } });

    // The run itself finished and checkpointed, but the process stopped
    // before the session saved the turn.
    await assistant.execute("lost turn", { runId: "run-crashed", history: [] });
    const now = new Date().toISOString();
    await store.save({
      runId: "session:crashed",
      type: "conversation-session",
      id: "crashed",
      messages: [],
      turns: 0,
      createdAt: now,
      updatedAt: now,
      pending: { runId: "run-crashed", input: "lost turn", startedAt: now },
    });

    const chat = session({ id: "crashed", store, agent: assistant });
    const result = await chat.resume();

    expect(result?.text).toBe("reply to lost turn");
    expect(await chat.history()).toEqual([
      { role: "user", content: "lost turn" },
      { role: "assistant", content: "reply to lost turn" },
    ]);
    expect((await chat.load())?.pending).toBeUndefined();
    expect(await chat.resume()).toBeUndefined();
  });

  it("works on the SQLite store", async () => {
    let sqliteStore: ReturnType<typeof sqlite<ConversationSessionRecord>>;
    try {
      await import(/* @vite-ignore */ "node:sqlite");
      sqliteStore = sqlite<ConversationSessionRecord>({ path: join(dir, "sessions.db") });
    } catch {
      return;
    }
    const chat = session({
      id: "sql",
      store: sqliteStore,
      agent: agent({ model: scriptedModel().model }),
    });

    try {
      await chat.send("hello");
      expect(await chat.history()).toHaveLength(2);
    } finally {
      await sqliteStore.close();
    }
  });

  it("validates its configuration", () => {
    const assistant = agent({ model: scriptedModel().model });
    expect(() => session({ id: "", store, agent: assistant })).toThrow(/non-empty/);
    expect(() =>
      session({ id: "x", store: {} as SnapshotStore<ConversationSessionRecord>, agent: assistant }),
    ).toThrow(/snapshot store/);
  });
});
