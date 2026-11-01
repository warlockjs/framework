import { describe, expect, it } from "vitest";
import { agent } from "../../agent/agent";
import { MockSDK } from "../../mock/mock-sdk";
import { dedupe } from "./dedupe";

function setup(delay = 20) {
  const sdk = MockSDK({
    responses: [
      { content: "shared answer", finishReason: "stop", usage: { input: 5, output: 5, total: 10 }, delay },
      { content: "second answer", finishReason: "stop", delay },
    ],
  });
  const model = sdk.model({ name: "gpt-test" });

  return { model, mock: sdk.models[sdk.models.length - 1] };
}

describe("dedupe", () => {
  it("shares one model call between identical simultaneous runs", async () => {
    const { model, mock } = setup();
    const ai = agent({ name: "qa", model, middleware: [dedupe()] });

    const [first, second, third] = await Promise.all([
      ai.execute("same question"),
      ai.execute("same question"),
      ai.execute("same question"),
    ]);

    expect(mock.callCount).toBe(1);
    expect([first.text, second.text, third.text]).toEqual([
      "shared answer",
      "shared answer",
      "shared answer",
    ]);
    expect(first.usage.total).toBe(10);
    expect(second.usage.total).toBe(0);
    expect(third.usage.total).toBe(0);
  });

  it("does not share calls whose messages differ", async () => {
    const { model, mock } = setup();
    const ai = agent({ name: "qa", model, middleware: [dedupe()] });

    await Promise.all([ai.execute("question one"), ai.execute("question two")]);

    expect(mock.callCount).toBe(2);
  });

  it("keeps nothing after the call finishes", async () => {
    const { model, mock } = setup(0);
    const ai = agent({ name: "qa", model, middleware: [dedupe()] });

    await ai.execute("same question");
    const again = await ai.execute("same question");

    expect(mock.callCount).toBe(2);
    expect(again.text).toBe("second answer");
  });

  it("lets waiting runs make their own call when the first one fails", async () => {
    const sdk = MockSDK({
      responses: [
        { error: new Error("provider down"), delay: 20 },
        { content: "recovered", finishReason: "stop", delay: 5 },
      ],
    });
    const model = sdk.model({ name: "gpt-test" });
    const mock = sdk.models[sdk.models.length - 1];
    const ai = agent({ name: "qa", model, middleware: [dedupe()] });

    const [first, second] = await Promise.all([ai.execute("same"), ai.execute("same")]);

    expect(first.error).toBeDefined();
    expect(second.text).toBe("recovered");
    expect(mock.callCount).toBe(2);
  });

  it("does not deduplicate streaming runs", async () => {
    const { model, mock } = setup(5);
    const ai = agent({ name: "qa", model, middleware: [dedupe()] });

    const streams = [ai.stream("same question"), ai.stream("same question")];
    await Promise.all(streams.map((stream) => stream.result));

    expect(mock.callCount).toBe(2);
  });

  it("honors a custom key and leaves calls it returns undefined for alone", async () => {
    const { model, mock } = setup();
    const ai = agent({
      name: "qa",
      model,
      middleware: [dedupe({ key: (context) => (context.input.startsWith("skip") ? undefined : "one") })],
    });

    await Promise.all([ai.execute("a"), ai.execute("b")]);
    expect(mock.callCount).toBe(1);

    await Promise.all([ai.execute("skip 1"), ai.execute("skip 1")]);
    expect(mock.callCount).toBe(3);
  });
});
