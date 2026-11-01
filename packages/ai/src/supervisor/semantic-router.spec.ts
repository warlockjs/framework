import { describe, expect, it } from "vitest";
import type {
  EmbedderContract,
  EmbeddingBatchResult,
  EmbeddingResult,
} from "../contracts/embedder.contract";
import { END } from "../contracts/end.type";
import { MockSDK } from "../mock/mock-sdk";
import { buildScriptedAgent, routerDecision } from "./_test-helpers";
import { router } from "./router-factory";
import {
  semanticRouter,
  type SemanticRouterOutput,
  type SemanticRouterStore,
} from "./semantic-router";
import { supervisor } from "./supervisor";

const KEYWORDS = ["invoice", "parcel", "refund", "hello"];

/** Embeds a text as keyword counts, so similarity is predictable and every call is counted. */
class KeywordEmbedder implements EmbedderContract {
  public readonly provider = "mock";
  public dimensions = KEYWORDS.length;
  public embedCalls: string[] = [];
  public embedManyCalls: string[][] = [];

  public constructor(public readonly name = "keyword-embedder") {}

  public async embed(input: string): Promise<EmbeddingResult> {
    this.embedCalls.push(input);

    return { vector: this.toVector(input), dimensions: this.dimensions, usage: usage() };
  }

  public async embedMany(inputs: string[]): Promise<EmbeddingBatchResult> {
    this.embedManyCalls.push(inputs);

    return {
      vectors: inputs.map((input) => this.toVector(input)),
      dimensions: this.dimensions,
      usage: usage(),
    };
  }

  private toVector(text: string): number[] {
    const lower = text.toLowerCase();

    return KEYWORDS.map((word) => lower.split(word).length - 1 + 0.001);
  }
}

function usage() {
  return { promptTokens: 0, totalTokens: 0 };
}

/** Map-backed store that records its writes. */
function recordingStore() {
  const data = new Map<string, unknown>();
  const store = {
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: unknown) {
      data.set(key, value);

      return value;
    },
    async remove(key: string) {
      data.delete(key);
    },
  } as unknown as SemanticRouterStore;

  return { data, store };
}

const intents = {
  billing: buildScriptedAgent({
    name: "billing",
    description: "Invoices and refunds",
    responses: [{ content: "billing done", finishReason: "stop" }],
  }),
  orders: buildScriptedAgent({
    name: "orders",
    description: "Parcels and delivery",
    responses: [{ content: "orders done", finishReason: "stop" }],
  }),
  smalltalk: buildScriptedAgent({
    name: "smalltalk",
    description: "Greetings",
    responses: [{ content: "hi", finishReason: "stop" }],
  }),
};

function makeFallback(...decisions: Array<[string, string]>) {
  const sdk = MockSDK({
    responses: decisions.map(([next, why]) => ({
      content: routerDecision(next, why),
      finishReason: "stop" as const,
    })),
  });
  const model = sdk.model({ name: "fallback-model" });

  return { sdk, fallback: router({ model, intents }) };
}

const examples = {
  billing: ["where is my invoice", "I want a refund invoice"],
  orders: ["where is my parcel", "track the parcel"],
};

describe("ai.semanticRouter — construction guards", () => {
  it("throws on an examples key that is not an intent", () => {
    const { fallback } = makeFallback();

    expect(() =>
      semanticRouter({
        name: "support",
        embedder: new KeywordEmbedder(),
        intents,
        examples: { shipping: ["x"] },
        confidence: { min: 0.8 },
        fallback,
      }),
    ).toThrow(/unknown intent "shipping"/);
  });

  it("requires a fallback and a confidence threshold", () => {
    const { fallback } = makeFallback();
    const base = { name: "support", embedder: new KeywordEmbedder(), intents, examples };

    expect(() =>
      semanticRouter({ ...base, confidence: { min: 0.8 }, fallback: undefined as never }),
    ).toThrow(/`fallback` is required/);
    expect(() => semanticRouter({ ...base, confidence: undefined as never, fallback })).toThrow(
      /confidence\.min/,
    );
  });
});

describe("ai.semanticRouter — routing", () => {
  it("routes a confident match without calling the fallback model", async () => {
    const { sdk, fallback } = makeFallback(["orders", "model pick"]);
    const embedder = new KeywordEmbedder();
    const semantic = semanticRouter({
      name: "support",
      embedder,
      intents,
      examples,
      confidence: { min: 0.8, margin: 0.1 },
      fallback,
    });

    const result = await semantic.execute("any news on my parcel?");

    expect(result.data).toMatchObject({ next: "orders", routedBy: "semantic" });
    expect(result.data?.score).toBeGreaterThan(0.8);
    expect(result.data?.runnerUp?.intent).toBe("billing");
    expect(result.usage.total).toBe(0);
    expect(sdk.models[0]?.callCount).toBe(0);
  });

  it("falls back when the best score is below confidence.min", async () => {
    const { sdk, fallback } = makeFallback(["smalltalk", "chatty"]);
    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback,
    });

    const result = await semantic.execute("hello there");

    expect(result.data).toMatchObject({ next: "smalltalk", routedBy: "fallback" });
    expect(sdk.models[0]?.callCount).toBe(1);
  });

  it("falls back when the top two intents are closer than the margin", async () => {
    const { sdk, fallback } = makeFallback(["billing", "tie broken by the model"]);
    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.5, margin: 0.2 },
      fallback,
    });

    const result = await semantic.execute("invoice and parcel");

    expect(result.data).toMatchObject({ routedBy: "fallback" });
    expect(result.data?.runnerUp).toBeDefined();
    expect(sdk.models[0]?.callCount).toBe(1);
  });

  it("only reaches an intent without examples through the fallback", async () => {
    const { fallback } = makeFallback(["smalltalk", "greeting"]);
    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.1 },
      fallback,
    });

    const result = await semantic.execute("hello hello");
    const data = result.data as SemanticRouterOutput;

    expect(data.routedBy).toBe("fallback");
    expect(data.runnerUp?.intent).not.toBe("smalltalk");
  });

  it("sends later supervisor iterations to the fallback", async () => {
    const { sdk, fallback } = makeFallback([END, "done"]);
    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback,
    });

    const result = await semantic.execute("Iteration: 2 / 5\n\nOriginal input: where is my parcel");

    expect(result.data).toMatchObject({ next: END, routedBy: "fallback" });
    expect(sdk.models[0]?.callCount).toBe(1);
  });

  it("reads the whole input on the first iteration, even when it repeats the input label", async () => {
    const { fallback } = makeFallback(["orders", "model pick"]);
    const embedder = new KeywordEmbedder();
    const semantic = semanticRouter({
      name: "support",
      embedder,
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback,
    });

    await semantic.execute(
      "Iteration: 1 / 5\n\nHistory:\n(none yet)\n\nOriginal input: my parcel\nOriginal input: copied text",
    );

    expect(embedder.embedCalls).toEqual(["my parcel\nOriginal input: copied text"]);
  });

  it("falls back instead of failing when the embedder throws", async () => {
    const { fallback } = makeFallback(["orders", "model pick"]);
    const embedder = new KeywordEmbedder();

    embedder.embedMany = async () => {
      throw new Error("embedder down");
    };

    const semantic = semanticRouter({
      name: "support",
      embedder,
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback,
    });

    const result = await semantic.execute("where is my parcel");

    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ next: "orders", routedBy: "fallback" });
  });
});

describe("ai.semanticRouter — vector store", () => {
  it("embeds examples once and recomputes only what changed", async () => {
    const { data, store } = recordingStore();
    const build = (embedder: KeywordEmbedder, orderExamples: string[]) =>
      semanticRouter({
        name: "support",
        embedder,
        intents,
        examples: { ...examples, orders: orderExamples },
        confidence: { min: 0.8 },
        fallback: makeFallback().fallback,
        store,
      });

    const first = new KeywordEmbedder();
    await build(first, examples.orders).warm();

    expect(first.embedManyCalls.flat()).toHaveLength(4);

    const second = new KeywordEmbedder();
    await build(second, examples.orders).warm();

    expect(second.embedManyCalls).toHaveLength(0);

    const third = new KeywordEmbedder();
    await build(third, ["where is my parcel", "a brand new parcel phrase"]).warm();

    expect(third.embedManyCalls.flat()).toEqual(["a brand new parcel phrase"]);

    const vectorKeys = [...data.keys()].filter((key) => !key.endsWith(".manifest"));

    expect(vectorKeys).toHaveLength(4);
  });

  it("recomputes every vector for a new embedder and prunes the old ones", async () => {
    const { data, store } = recordingStore();
    const build = (embedder: KeywordEmbedder) =>
      semanticRouter({
        name: "support",
        embedder,
        intents,
        examples,
        confidence: { min: 0.8 },
        fallback: makeFallback().fallback,
        store,
      });

    await build(new KeywordEmbedder("model-a")).warm();

    const next = new KeywordEmbedder("model-b");
    await build(next).warm();

    expect(next.embedManyCalls.flat()).toHaveLength(4);
    expect([...data.keys()].filter((key) => !key.endsWith(".manifest"))).toHaveLength(4);
  });

  it("scores against memory: no store reads while routing", async () => {
    const { store } = recordingStore();
    let reads = 0;
    const original = store.get.bind(store);

    store.get = (async (key: string) => {
      reads++;

      return original(key);
    }) as SemanticRouterStore["get"];

    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback: makeFallback().fallback,
      store,
    });

    await semantic.warm();
    const afterWarm = reads;

    await semantic.execute("my parcel");
    await semantic.execute("my invoice");

    expect(reads).toBe(afterWarm);
  });

  it("works when the store fails", async () => {
    const broken = {
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
      remove: async () => {
        throw new Error("redis down");
      },
    } as unknown as SemanticRouterStore;

    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback: makeFallback().fallback,
      store: broken,
    });

    const result = await semantic.execute("my parcel");

    expect(result.data).toMatchObject({ next: "orders", routedBy: "semantic" });
  });
});

describe("ai.semanticRouter — message embedding cache", () => {
  it("embeds identical text once and again after the ttl", async () => {
    const embedder = new KeywordEmbedder();
    const semantic = semanticRouter({
      name: "support",
      embedder,
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback: makeFallback().fallback,
      messageCache: { ttlMs: 30 },
    });

    await semantic.execute("my parcel");
    await semantic.execute("my parcel");

    expect(embedder.embedCalls).toEqual(["my parcel"]);

    await new Promise((done) => setTimeout(done, 50));
    await semantic.execute("my parcel");

    expect(embedder.embedCalls).toEqual(["my parcel", "my parcel"]);
  });

  it("keeps at most `max` texts", async () => {
    const embedder = new KeywordEmbedder();
    const semantic = semanticRouter({
      name: "support",
      embedder,
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback: makeFallback().fallback,
      messageCache: { max: 1 },
    });

    await semantic.execute("one parcel");
    await semantic.execute("two parcel");
    await semantic.execute("one parcel");

    expect(embedder.embedCalls).toEqual(["one parcel", "two parcel", "one parcel"]);
  });
});

describe("ai.semanticRouter — learn", () => {
  it("stores an agreeing fallback decision as a new example, capped per intent", async () => {
    const { data, store } = recordingStore();
    const { fallback } = makeFallback(["orders", "a"], ["orders", "b"], ["orders", "c"]);
    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.999 },
      fallback,
      store,
      learn: { maxPerIntent: 2, minScore: 0.5 },
    });

    await semantic.execute("parcel parcel invoice");
    await semantic.execute("parcel parcel parcel invoice");
    await semantic.execute("parcel parcel parcel parcel invoice");

    const learned = [...data.entries()].find(([key]) => key.endsWith(".learned"))?.[1] as {
      items: Array<{ phrase: string }>;
    };

    expect(learned.items.map((item) => item.phrase)).toEqual([
      "parcel parcel parcel invoice",
      "parcel parcel parcel parcel invoice",
    ]);
  });

  it("does not learn when the fallback disagrees with the nearest intent", async () => {
    const { data, store } = recordingStore();
    const { fallback } = makeFallback(["billing", "model pick"]);
    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.95 },
      fallback,
      store,
      learn: true,
    });

    await semantic.execute("parcel parcel invoice");

    expect([...data.keys()].some((key) => key.endsWith(".learned"))).toBe(false);
  });
});

describe("ai.semanticRouter — supervisor integration", () => {
  it("routes the first iteration semantically and records routedBy on the snapshot", async () => {
    const { sdk, fallback } = makeFallback([END, "all done"]);
    const semantic = semanticRouter({
      name: "support",
      embedder: new KeywordEmbedder(),
      intents,
      examples,
      confidence: { min: 0.8 },
      fallback,
    });

    const flow = supervisor({ name: "support", router: semantic, intents, maxIterations: 4 });
    const result = await flow.execute("where is my parcel");

    expect(result.error).toBeUndefined();

    const [first, second] = result.report.snapshots;

    expect(first?.decision).toMatchObject({
      source: "router",
      next: "orders",
      routedBy: "semantic",
    });
    expect(first?.decision.score).toBeGreaterThan(0.8);
    expect(first?.result.orders).toBeDefined();
    expect(second?.decision).toMatchObject({ next: END, routedBy: "fallback" });
    expect(sdk.models[0]?.callCount).toBe(1);
  });
});
