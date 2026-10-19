import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import { ai } from "../ai";
import { agent } from "../agent/agent";
import { computeAgentSignature } from "../agent/signature";
import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";
import type { AgentMiddleware } from "../contracts/middleware";
import type { ToolCall } from "../contracts/result/tool-call.type";
import { SchemaValidationError } from "../errors";
import type { ApprovalRequest } from "../human/contracts";
import { ApprovalRejectedError, InterruptSuspendedError } from "../human/errors";
import { humanApproval } from "../human/human-approval";
import { budget } from "../middleware/builtins/budget";
import { measure } from "../measure/measure";
import { MockSDK } from "../mock/mock-sdk";
import { extractJsonSchema } from "../utils/json-schema";
import { catalogue, type CatalogueTool } from "./catalogue";
import { providerTool } from "./provider-tool";
import { compositeAsTool, tool, type ToolContract } from "./tool";

const inputSchema: StandardSchemaV1<{ text: string }> & { jsonSchema: Record<string, unknown> } = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("text" in value) ||
        typeof value.text !== "string"
      ) {
        return { issues: [{ message: "text must be a string" }] };
      }
      return { value: { text: value.text } };
    },
  },
  jsonSchema: {
    type: "object",
    properties: { text: { type: "string", description: "Exact text to store" } },
    required: ["text"],
    additionalProperties: false,
  },
};

function target(name: string, description = "Store a note", tags: string[] = []) {
  const execute = vi.fn(async ({ text }: { text: string }) => ({ stored: text }));
  return tool({ name, description, input: inputSchema, meta: { tags }, execute });
}

function scriptedCall(name: string, input: unknown) {
  const sdk = MockSDK({
    responses: [
      {
        content: "",
        toolCalls: [{ id: "call-1", name, input }],
        usage: { input: 10, output: 2, total: 12 },
      },
      { content: "done", usage: { input: 5, output: 1, total: 6 } },
    ],
  });
  return sdk.model({ name: "mock" });
}

async function runCall(hidden: ToolContract, input: unknown, middleware: AgentMiddleware[] = []) {
  const surface = catalogue({ searchable: [hidden] });
  const model = scriptedCall(surface.call.name, { name: hidden.name, input });
  const result = await agent({ model, tools: surface.tools, middleware }).execute("store");
  return { result, model, surface };
}

describe("tool catalogue", () => {
  it("ships on the core facade with stable advertisement after search", async () => {
    expect(ai.tools.catalogue).toBe(catalogue);
    const core = target("read_note");
    const hidden = target("store_note");
    const surface = catalogue({ core: [core], searchable: [hidden] });
    const before = surface.tools;
    expect(before.map((item) => item.name)).toEqual(["read_note", "tool_search", "tool_call"]);
    expect((await surface.search.invoke({ query: "store" })).data?.tools).toEqual([
      { name: hidden.name, description: hidden.description, inputSchema: inputSchema.jsonSchema },
    ]);
    expect(surface.tools).toEqual(before);
    surface.tools.pop();
    expect(surface.tools).toHaveLength(3);
  });

  it("limits to eight by default, supports a smaller cap and sorts ties by name", async () => {
    const searchable = Array.from({ length: 12 }, (_, index) =>
      target(`note_${String(index).padStart(2, "0")}`),
    ).reverse();
    const surface = catalogue({ searchable });
    const result = await surface.search.invoke({ query: "*" });
    expect(result.data?.tools.map((item) => item.name)).toEqual(
      Array.from({ length: 8 }, (_, index) => `note_0${index}`),
    );
    const smaller = catalogue({ searchable, limit: 2, searchName: "find", callName: "invoke" });
    expect((await smaller.search.invoke({ query: "NOTE" })).data?.tools).toHaveLength(2);
    expect(smaller.tools.map((item) => item.name)).toEqual(["find", "invoke"]);
  });

  it("ranks exact names, name substrings, tags, then descriptions and requires every term", async () => {
    const surface = catalogue({
      searchable: [
        target("description", "Find an invoice"),
        target("tagged", "Other", ["invoice", "finance"]),
        target("invoice_search", "Other"),
        target("invoice", "Other"),
      ],
    });
    expect(
      (await surface.search.invoke({ query: "INVOICE" })).data?.tools.map((item) => item.name),
    ).toEqual(["invoice", "invoice_search", "tagged", "description"]);
    expect(
      (await surface.search.invoke({ query: "invoice finance" })).data?.tools.map(
        (item) => item.name,
      ),
    ).toEqual(["tagged"]);
    expect((await surface.search.invoke({ query: "   " })).data?.tools).toEqual([]);
    expect((await surface.search.invoke({ query: "absent" })).data?.tools).toEqual([]);
  });

  it("loads only selected matches and shares successful loads across concurrent searches and calls", async () => {
    const hidden = target("store_note");
    const load = vi.fn(async () => hidden);
    const unused = vi.fn(async () => target("other"));
    const surface = catalogue({
      searchable: [
        { name: hidden.name, description: "Store", tags: ["notes"], load },
        { name: "other", description: "Store other", load: unused },
      ],
      limit: 1,
    });
    const model = scriptedCall(surface.call.name, { name: hidden.name, input: { text: "saved" } });
    expect(load).not.toHaveBeenCalled();
    const [found, , result] = await Promise.all([
      surface.search.invoke({ query: "notes" }),
      surface.search.invoke({ query: "store" }),
      agent({ model, tools: surface.tools }).execute("save"),
    ]);
    expect(found.data?.tools[0]?.inputSchema).toEqual(inputSchema.jsonSchema);
    expect(result.report.children[0]?.name).toBe(hidden.name);
    expect(load).toHaveBeenCalledOnce();
    expect(unused).not.toHaveBeenCalled();
    expect(hidden.execute).toHaveBeenCalledOnce();
  });

  it("retries failed loaders and rejects identity mismatches and lazy provider tools", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(target("store"));
    const surface = catalogue({ searchable: [{ name: "store", description: "Store", load }] });
    expect((await surface.search.invoke({ query: "*" })).error?.message).toContain("offline");
    expect((await surface.search.invoke({ query: "*" })).data?.tools[0]?.name).toBe("store");
    for (const resolved of [
      target("wrong"),
      providerTool({ name: "store", provider: "test", definition: { type: "hosted" } }),
    ]) {
      const invalid = catalogue({
        searchable: [{ name: "store", description: "Store", load: async () => resolved }],
      });
      expect((await invalid.search.invoke({ query: "*" })).error?.message).toContain(
        "ordinary tool named",
      );
    }
  });

  it("rejects invalid caps and duplicate names, including core and meta-tools", () => {
    for (const limit of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => catalogue({ searchable: [], limit })).toThrow("positive safe integer");
    }
    expect(() => catalogue({ core: [target("same")], searchable: [target("same")] })).toThrow(
      "Duplicate",
    );
    expect(() => catalogue({ searchable: [target("tool_call")] })).toThrow("Duplicate");
    expect(() => catalogue({ searchable: [], searchName: "same", callName: "same" })).toThrow(
      "distinct",
    );
  });

  it("returns no guessed schema when a tool cannot expose its real schema", async () => {
    const opaque = tool({
      name: "opaque",
      description: "Opaque",
      input: { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } },
      execute: async () => "ok",
    });
    expect(
      (await catalogue({ searchable: [opaque] }).search.invoke({ query: "*" })).error?.message,
    ).toContain("JSON input schema");
    const noArgs = tool({
      name: "no_args",
      description: "No arguments",
      execute: async () => "ok",
    });
    expect(
      (await catalogue({ searchable: [noArgs] }).search.invoke({ query: "*" })).data?.tools[0]
        ?.inputSchema,
    ).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });

  it("validates meta input and prevents standalone calls from bypassing governance", async () => {
    const hidden = target("store");
    const surface = catalogue({ searchable: [hidden] });
    expect((await surface.search.invoke({ query: 5 })).error).toBeInstanceOf(SchemaValidationError);
    expect((await surface.search.invoke({ query: "a".repeat(501) })).error).toBeInstanceOf(
      SchemaValidationError,
    );
    expect((await surface.call.invoke({ name: hidden.name })).error).toBeInstanceOf(
      SchemaValidationError,
    );
    expect(
      (await surface.call.invoke({ name: hidden.name, input: { text: "saved" } })).error?.message,
    ).toContain("require agent dispatch");
    expect(hidden.execute).not.toHaveBeenCalled();
    expect(extractJsonSchema(surface.search.input)).toHaveProperty(
      "properties.query.type",
      "string",
    );
    expect(extractJsonSchema(surface.call.input)).toHaveProperty("required", ["name", "input"]);
  });

  it("keeps provider tools unchanged and outside search and call", async () => {
    const native = providerTool({
      provider: "test",
      definition: { type: "hosted", options: { limit: 3 } },
    });
    const surface = catalogue({ searchable: [native] });
    expect(surface.tools[0]).toBe(native);
    expect((await surface.search.invoke({ query: "*" })).data?.tools).toEqual([]);
    const model = scriptedCall(surface.call.name, { name: native.name, input: {} });
    const result = await agent({ model, tools: surface.tools }).execute("go");
    expect(result.report.children[0]?.status).toBe("failed");
    expect(model.callHistory[0]?.options?.providerTools).toEqual([
      { provider: native.provider, definition: native.definition },
    ]);
    expect(model.callHistory[0]?.options?.tools?.map((item) => item.name)).toEqual([
      "tool_search",
      "tool_call",
    ]);
  });

  it("measures a smaller tools part without loading hidden schemas or executing tools", async () => {
    const full = Array.from({ length: 30 }, (_, index) =>
      target(`tool_${index}`, "Detailed guidance. ".repeat(50)),
    );
    const loaders = full.map((item) => vi.fn(async () => item));
    const searchable: CatalogueTool[] = full.map((item, index) => ({
      name: item.name,
      description: item.description,
      load: loaders[index] ?? (() => item),
    }));
    const surface = catalogue({ core: [target("core")], searchable });
    const model = MockSDK().model({ name: "mock" });
    const before = await measure({ model, tools: full });
    const after = await measure({ model, tools: surface.tools });
    expect(after.parts.tools.tokens).toBeLessThan(before.parts.tools.tokens);
    expect(measure.diff(before, after).parts.tools.tokens).toBeLessThan(0);
    for (const load of loaders) expect(load).not.toHaveBeenCalled();
    for (const item of full) expect(item.execute).not.toHaveBeenCalled();
    expect(model.callCount).toBe(0);
  });

  it("supports native measurement of only advertised definitions without loading hidden tools", async () => {
    const load = vi.fn(async () => target("hidden"));
    const surface = catalogue({ searchable: [{ name: "hidden", description: "Hidden", load }] });
    const countTokens = vi.fn(
      async (_messages: Message[], options?: ModelCallOptions) =>
        10 + (options?.tools?.length ?? 0) * 100,
    );
    const model = Object.assign(MockSDK().model({ name: "native" }), { countTokens });
    const measured = await measure({ model, tools: surface.tools });
    expect(measured.parts.tools).toMatchObject({ tokens: 200, source: "native" });
    expect(load).not.toHaveBeenCalled();
    expect(model.callCount).toBe(0);
  });

  it("detects hidden inventory drift without resolving lazy entries", () => {
    const load = vi.fn(async () => target("first"));
    const first = catalogue({ searchable: [{ name: "first", description: "First", load }] });
    const second = catalogue({ searchable: [target("second")] });
    expect(computeAgentSignature({ model: { name: "mock" }, tools: first.tools })).not.toBe(
      computeAgentSignature({ model: { name: "mock" }, tools: second.tools }),
    );
    expect(load).not.toHaveBeenCalled();
  });
});

describe("catalogue governed dispatch", () => {
  it("uses target hooks, approval edits, schema validation, trace and original call id", async () => {
    const hidden = target("store");
    const before = vi.fn();
    const after = vi.fn();
    const handler = vi.fn(async (_request: ApprovalRequest) => ({
      type: "edit" as const,
      args: { text: "approved" },
    }));
    const { result, model } = await runCall(hidden, { text: "original" }, [
      { name: "trace", tool: { before, after } },
      humanApproval({ policy: { type: "allowlist", tools: [hidden.name] }, handler }),
    ]);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      toolName: hidden.name,
      args: { text: "original" },
    });
    expect(before.mock.calls[0]?.[0]).toMatchObject({
      tool: { name: hidden.name },
      request: { name: hidden.name, input: { text: "approved" } },
      callId: "call-1",
    });
    expect(hidden.execute).toHaveBeenCalledWith(
      { text: "approved" },
      expect.objectContaining({ artifacts: {} }),
    );
    expect(after).toHaveBeenCalledOnce();
    expect(result.report.children[0]).toMatchObject({
      name: hidden.name,
      callId: "call-1",
      input: { text: "approved" },
      output: { stored: "approved" },
      status: "completed",
    });
    expect(model.callHistory[1]?.messages).toContainEqual({
      role: "tool",
      toolCallId: "call-1",
      content: JSON.stringify({ stored: "approved" }),
    });
  });

  it("keeps compact advertisement fixed across search and call trips", async () => {
    const hidden = target("store");
    const load = vi.fn(async () => hidden);
    const surface = catalogue({ searchable: [{ name: hidden.name, description: "Store", load }] });
    const model = MockSDK({
      responses: [
        {
          content: "",
          toolCalls: [{ id: "search-1", name: surface.search.name, input: { query: "store" } }],
        },
        {
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: surface.call.name,
              input: { name: hidden.name, input: { text: "saved" } },
            },
          ],
        },
        { content: "done" },
      ],
    }).model({ name: "mock" });
    const result = await agent({ model, tools: surface.tools, toolSchemas: "compact" }).execute(
      "save",
    );
    expect(result.report.children.map((child) => child.name)).toEqual([
      surface.search.name,
      hidden.name,
    ]);
    for (const history of model.callHistory) {
      expect(history.options?.tools?.map((item) => item.name)).toEqual([
        surface.search.name,
        surface.call.name,
      ]);
    }
    expect(model.callHistory[1]?.messages).toContainEqual({
      role: "tool",
      toolCallId: "search-1",
      content: JSON.stringify({
        tools: [
          {
            name: hidden.name,
            description: hidden.description,
            inputSchema: inputSchema.jsonSchema,
          },
        ],
      }),
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("resolves lazy calls without search and preserves HITL suspension", async () => {
    const hidden = target("store");
    const load = vi.fn(async () => hidden);
    const surface = catalogue({ searchable: [{ name: hidden.name, description: "Store", load }] });
    const handler = vi.fn(async (request: ApprovalRequest) => {
      expect(request.toolName).toBe(hidden.name);
      throw new InterruptSuspendedError("review pending", { interruptId: "review-1" });
    });
    const model = scriptedCall(surface.call.name, { name: hidden.name, input: { text: "saved" } });
    const result = await agent({
      model,
      tools: surface.tools,
      middleware: [humanApproval({ policy: { type: "allowlist", tools: [hidden.name] }, handler })],
    }).execute("save");
    expect(load).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
    expect((result.report.children[0] as ToolCall).error).toBeInstanceOf(InterruptSuspendedError);
    expect(hidden.execute).not.toHaveBeenCalled();
  });

  it("does not execute a target when cancellation arrives during its lazy load", async () => {
    const hidden = target("store");
    const controller = new AbortController();
    const surface = catalogue({
      searchable: [
        {
          name: hidden.name,
          description: "Store",
          load: async () => {
            controller.abort();
            return hidden;
          },
        },
      ],
    });
    const model = scriptedCall(surface.call.name, { name: hidden.name, input: { text: "saved" } });
    await agent({ model, tools: surface.tools }).execute("save", { signal: controller.signal });
    expect(hidden.execute).not.toHaveBeenCalled();
  });

  it("denies hidden calls on the same target policy as direct calls", async () => {
    const hidden = target("store");
    for (const discover of [false, true]) {
      const surface = catalogue({ searchable: [hidden] });
      const model = scriptedCall(
        discover ? surface.call.name : hidden.name,
        discover ? { name: hidden.name, input: { text: "saved" } } : { text: "saved" },
      );
      const result = await agent({
        model,
        tools: discover ? surface.tools : [hidden],
        middleware: [
          humanApproval({
            policy: { type: "allowlist", tools: [hidden.name] },
            handler: async () => ({ type: "reject", reason: "denied" }),
          }),
        ],
      }).execute("store");
      expect((result.report.children[0] as ToolCall).error).toBeInstanceOf(ApprovalRejectedError);
      expect(result.report.children[0]?.name).toBe(hidden.name);
    }
    expect(hidden.execute).not.toHaveBeenCalled();
  });

  it("validates the target schema after approval and reports unknown tools and loader failures", async () => {
    const hidden = target("store");
    const invalid = await runCall(hidden, { text: 42 });
    expect((invalid.result.report.children[0] as ToolCall).error).toBeInstanceOf(
      SchemaValidationError,
    );
    const edited = await runCall(hidden, { text: "valid" }, [
      humanApproval({
        policy: { type: "allowlist", tools: [hidden.name] },
        handler: async () => ({ type: "edit", args: { text: false } }),
      }),
    ]);
    expect((edited.result.report.children[0] as ToolCall).error).toBeInstanceOf(
      SchemaValidationError,
    );
    for (const input of [{ name: "absent", input: {} }, { name: "store" }]) {
      const surface = catalogue({ searchable: [hidden] });
      const model = scriptedCall(surface.call.name, input);
      const result = await agent({ model, tools: surface.tools }).execute("store");
      expect(result.report.children[0]?.status).toBe("failed");
    }
    const broken = catalogue({
      searchable: [
        {
          name: "broken",
          description: "Broken",
          load: async () => {
            throw new Error("offline");
          },
        },
      ],
    });
    const model = scriptedCall(broken.call.name, { name: "broken", input: {} });
    const failed = await agent({ model, tools: broken.tools }).execute("store");
    expect((failed.report.children[0] as ToolCall).error?.message).toContain("offline");
    expect(hidden.execute).not.toHaveBeenCalled();
  });

  it("does not expose hidden tools for direct dispatch and cannot recurse into meta-tools or core", async () => {
    const hidden = target("store");
    const core = target("core");
    const surface = catalogue({ core: [core], searchable: [hidden] });
    for (const name of [surface.call.name, surface.search.name, core.name]) {
      const model = scriptedCall(surface.call.name, { name, input: { text: "saved" } });
      const result = await agent({ model, tools: surface.tools }).execute("store");
      expect(result.report.children[0]?.status).toBe("failed");
    }
    const model = scriptedCall(hidden.name, { text: "saved" });
    const result = await agent({ model, tools: surface.tools }).execute("store");
    expect((result.report.children[0] as ToolCall).error?.message).toContain("not registered");
    expect(hidden.execute).not.toHaveBeenCalled();
    expect(core.execute).not.toHaveBeenCalled();
  });

  it("preserves silent targets, cancellation and system-only context", async () => {
    const hidden = target("store");
    const surface = catalogue({ searchable: [{ ...hidden, mode: "silent" }] });
    const model = scriptedCall(surface.call.name, { name: hidden.name, input: { text: "saved" } });
    const controller = new AbortController();
    const toolCtx = { artifacts: { secret: "system-only" }, principal: { user: "one" } };
    const result = await agent({ model, tools: surface.tools }).execute("store", {
      signal: controller.signal,
      toolCtx,
    });
    expect(result.report.trips).toHaveLength(1);
    expect(hidden.execute).toHaveBeenCalledWith(
      { text: "saved" },
      expect.objectContaining({ ...toolCtx, signal: controller.signal }),
    );
    expect(JSON.stringify(model.callHistory)).not.toContain("system-only");
    controller.abort();
    const cancelled = await surface.search.invoke(
      { query: "*" },
      { artifacts: {}, signal: controller.signal },
    );
    expect(cancelled.error).toBeDefined();
  });

  it("blocks hidden effects when the ordinary trip budget is exceeded", async () => {
    const hidden = target("store");
    const { result, model } = await runCall(hidden, { text: "saved" }, [budget({ maxTokens: 11 })]);
    expect(result.error?.code).toBe("BUDGET_EXCEEDED");
    expect(hidden.execute).not.toHaveBeenCalled();
    expect(model.callCount).toBe(1);
  });

  it("accounts composite usage once through the normal budget path", async () => {
    const usage = { input: 20, output: 5, total: 25 };
    const hidden = compositeAsTool({
      name: "nested",
      input: inputSchema,
      execute: async () => ({
        data: "ok",
        usage,
        report: {
          runId: "inner",
          rootRunId: "inner",
          name: "nested-agent",
          type: "agent",
          status: "completed",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          duration: 1,
          usage,
          children: [],
        },
      }),
    });
    const { result, model } = await runCall(hidden, { text: "saved" }, [
      budget({ maxTokens: 100 }),
    ]);
    expect(result.report.children[0]?.usage).toEqual(usage);
    expect(result.report.children[0]?.children[0]?.name).toBe("nested-agent");
    expect(result.usage.total).toBe(43);
    expect(result.error).toBeUndefined();
    expect(model.callCount).toBe(2);
  });
});
