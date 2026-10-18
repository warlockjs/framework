import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import { ai } from "../ai";
import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";
import type { ToolConfig } from "../contracts/tool.contract";
import { InvalidRequestError } from "../errors/invalid-request-error";
import { MockModel } from "../mock/mock-model";
import { measureTools } from "../tool/tool-schemas";
import { estimateInputTokens } from "../utils/estimate-input-tokens";
import { measure } from "./measure";

const input: StandardSchemaV1<unknown> = {
  "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) },
};
const execute = vi.fn(async () => "unused");
const tools: ToolConfig<unknown, unknown>[] = [
  { name: "search", description: "Search documents", input, execute },
];
const messages: Message[] = [{ role: "user", content: "help" }];

function nativeModel(pricing = true) {
  const model = new MockModel(
    "counted",
    [],
    undefined,
    pricing ? { input: 2, output: 5 } : undefined,
  );
  const countTokens = vi.fn(async function (
    this: MockModel,
    sent: Message[],
    options?: ModelCallOptions,
  ) {
    expect(this.name).toBe("counted");
    const chars = sent.reduce(
      (sum, message) => sum + (typeof message.content === "string" ? message.content.length : 100),
      0,
    );
    return chars + sent.length * 3 + (options?.tools?.length ?? 0) * 50;
  });
  return Object.assign(model, { countTokens });
}

describe("measure", () => {
  it("exposes the API on the facade and attributes a priced native call without executing tools or generating", async () => {
    expect(ai.measure).toBe(measure);
    const model = nativeModel();
    const skills = { catalogPrompt: vi.fn(async () => "catalogue") };
    const report = await measure({ model, messages, system: "system", skills, tools });
    expect(report.probe).toBe(false);
    expect(report.parts.messages).toMatchObject({ tokens: 7, source: "native" });
    expect(report.parts.messages.costUSD).toBeCloseTo(0.000014, 12);
    expect(report.parts.system.tokens).toBe(9);
    expect(report.parts.skills.tokens).toBe(11);
    expect(report.parts.tools.tokens).toBe(50);
    expect(report.total.tokens).toBe(77);
    expect(report.total.costUSD).toBeCloseTo(0.000154, 12);
    expect(Object.values(report.parts).reduce((sum, part) => sum + part.tokens, 0)).toBe(
      report.total.tokens,
    );
    expect(model.countTokens).toHaveBeenLastCalledWith(
      [{ role: "system", content: "catalogue\n\nsystem" }, ...messages],
      { tools },
    );
    expect(skills.catalogPrompt).toHaveBeenCalledOnce();
    expect(model.callCount).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("labels estimates and reuses tool schema measurement with tuning", async () => {
    const model = new MockModel("offline", []);
    const report = await measure({
      model,
      messages,
      system: "text",
      skills: "catalogue",
      tools,
      estimate: { charsPerToken: 2 },
    });
    expect(report.total.source).toBe("estimate");
    expect(report.parts.tools.tokens).toBe(
      (await measureTools(tools, { estimate: { charsPerToken: 2 } })).tokens,
    );
    expect(report.parts.messages.tokens).toBe(estimateInputTokens(messages, { charsPerToken: 2 }));
    expect(Object.values(report.parts).every((part) => part.source === "estimate")).toBe(true);
    expect(report.total).not.toHaveProperty("costUSD");
    expect(JSON.stringify(report)).not.toContain("costUSD");
  });

  it("recalculates every part as an estimate if native counting declines tools", async () => {
    const model = nativeModel();
    model.countTokens.mockImplementation(async (_messages, options) => {
      if (options?.tools?.length)
        throw new InvalidRequestError("unsupported", { reason: "count-unsupported" });
      return 9000;
    });
    const report = await measure({ model, tools, messages, system: "text" });
    const offline = await measure({
      model: new MockModel("offline", [], undefined, model.pricing),
      tools,
      messages,
      system: "text",
    });
    expect(report.parts).toEqual(offline.parts);
    expect(report.total).toEqual(offline.total);
    expect(report.parts.system.tokens).toBeLessThan(9000);
  });

  it("propagates real count failures", async () => {
    const model = nativeModel();
    const error = new Error("authentication failed");
    model.countTokens.mockRejectedValue(error);
    await expect(measure({ model })).rejects.toBe(error);
  });

  it.each([NaN, Infinity, -1])("rejects invalid native counts (%s)", async (tokens) => {
    const model = nativeModel();
    model.countTokens.mockResolvedValue(tokens);
    await expect(measure({ model })).rejects.toThrow("finite non-negative");
  });

  it("marks an explicit probe for omitted or empty messages and retains unknown pricing", async () => {
    const model = nativeModel(false);
    const report = await measure({ model, messages: [] });
    expect(report.probe).toBe(true);
    expect(report.parts.messages.tokens).toBe(4);
    expect(report.parts.system.tokens).toBe(0);
    expect(report.parts.skills.tokens).toBe(0);
    expect(report.parts.tools.tokens).toBe(0);
    expect(report.total).not.toHaveProperty("costUSD");
    expect(model.countTokens).toHaveBeenCalledWith([{ role: "user", content: "." }], {});
  });

  it("forwards count options, compacts copies, and leaves caller messages untouched", async () => {
    const model = nativeModel();
    const signal = new AbortController().signal;
    const original = structuredClone(messages);
    await measure({
      model,
      messages,
      tools,
      toolSchemas: "compact",
      callOptions: { signal, providerOptions: { custom: { enabled: true } } },
    });
    expect(messages).toEqual(original);
    const options = model.countTokens.mock.calls.at(-1)?.[1];
    expect(options?.signal).toBe(signal);
    expect(options?.providerOptions).toEqual({ custom: { enabled: true } });
    expect(options?.tools?.[0]).not.toBe(tools[0]);
    expect(options?.tools?.[0]?.input).not.toBe(input);
  });

  it("retains explicitly free pricing and estimates multipart inputs", async () => {
    const model = new MockModel("free", [], undefined, { input: 0, output: 0 });
    const report = await measure({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", source: { url: "https://example.com/image.png" } },
          ],
        },
      ],
      estimate: { attachmentTokens: 200 },
    });
    expect(report.total).toEqual({ tokens: 205, source: "estimate", costUSD: 0 });
  });

  it("computes signed before/after deltas and preserves provenance", async () => {
    const model = nativeModel();
    const before = await measure({ model, messages, system: "long system", tools });
    const after = await measure({ model, messages, system: "short" });
    const diff = measure.diff(before, after);
    expect(diff.before).toBe(before);
    expect(diff.after).toBe(after);
    expect(diff.parts.tools.tokens).toBe(-50);
    expect(diff.total.tokens).toBe(after.total.tokens - before.total.tokens);
    expect(diff.total.costUSD).toBeCloseTo(
      (after.total.costUSD ?? 0) - (before.total.costUSD ?? 0),
      12,
    );
    const unknown = await measure({ model: nativeModel(false), messages });
    expect(measure.diff(before, unknown).total).not.toHaveProperty("costUSD");
    expect(measure.diff(before, before).total).toEqual({ tokens: 0, costUSD: 0 });
  });
});
