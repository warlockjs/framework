import { describe, expect, it } from "vitest";
import type { Message } from "../contracts/conversation-message.type";
import type { ToolConfig } from "../contracts/tool.contract";
import { DEFAULT_HASH_OPTIONS, hashRequest } from "./hash-request";

const messages: Message[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Where is my order?" },
];

describe("hashRequest", () => {
  it("is stable for identical inputs", () => {
    expect(hashRequest(messages, { temperature: 0.2 })).toBe(
      hashRequest(messages, { temperature: 0.2 }),
    );
  });

  it("differs when messages differ", () => {
    const other: Message[] = [{ role: "user", content: "different" }];

    expect(hashRequest(messages)).not.toBe(hashRequest(other));
  });

  it("differs when a hashed option differs", () => {
    expect(hashRequest(messages, { temperature: 0.2 })).not.toBe(
      hashRequest(messages, { temperature: 0.9 }),
    );
  });

  it("excludes signal from the hash", () => {
    const controller = new AbortController();

    expect(hashRequest(messages, { temperature: 0.2 })).toBe(
      hashRequest(messages, { temperature: 0.2, signal: controller.signal }),
    );
  });

  it("excludes unknown provider keys from the hash", () => {
    expect(hashRequest(messages, { temperature: 0.2 })).toBe(
      hashRequest(messages, { temperature: 0.2, customProviderFlag: true }),
    );
  });

  it("includes temperature by default", () => {
    expect(DEFAULT_HASH_OPTIONS).toContain("temperature");
  });

  it("is insensitive to option key insertion order", () => {
    expect(hashRequest(messages, { temperature: 0.2, maxTokens: 100 })).toBe(
      hashRequest(messages, { maxTokens: 100, temperature: 0.2 }),
    );
  });

  it("hashes tools by name + description + schema shape, not identity", () => {
    const toolA: ToolConfig<unknown, unknown> = {
      name: "search",
      description: "Search the web",
      input: { keyA: "string", keyB: "number" } as never,
      execute: async () => ({}),
    };
    const toolB: ToolConfig<unknown, unknown> = {
      name: "search",
      description: "Search the web",
      input: { keyA: "string", keyB: "number" } as never,
      execute: async () => ({}),
    };

    expect(hashRequest(messages, { tools: [toolA] })).toBe(
      hashRequest(messages, { tools: [toolB] }),
    );
  });

  it("changes when a tool's description changes", () => {
    const toolA: ToolConfig<unknown, unknown> = {
      name: "search",
      description: "Search the web",
      execute: async () => ({}),
    };
    const toolB: ToolConfig<unknown, unknown> = {
      name: "search",
      description: "Search the catalog",
      execute: async () => ({}),
    };

    expect(hashRequest(messages, { tools: [toolA] })).not.toBe(
      hashRequest(messages, { tools: [toolB] }),
    );
  });

  it("honors a custom hashOptions list", () => {
    // maxTokens excluded → the two calls collide.
    expect(hashRequest(messages, { maxTokens: 100 }, ["temperature"])).toBe(
      hashRequest(messages, { maxTokens: 500 }, ["temperature"]),
    );
  });

  describe("providerOptions and cacheControl", () => {
    const LEGACY_HASH_OPTIONS = [
      "temperature",
      "maxTokens",
      "responseSchema",
      "tools",
      "reasoning",
    ];
    const compaction = {
      anthropic: {
        betas: ["compact-2026-01-12"],
        body: { context_management: { edits: [{ type: "compact_20260112" }] } },
      },
    };

    it("hashes providerOptions, so calls differing only there no longer share a recording", () => {
      expect(DEFAULT_HASH_OPTIONS).toContain("providerOptions");
      expect(hashRequest(messages, { temperature: 0.2, providerOptions: compaction })).not.toBe(
        hashRequest(messages, { temperature: 0.2 }),
      );
      expect(
        hashRequest(messages, {
          providerOptions: { anthropic: { betas: ["compact-2026-01-12"] } },
        }),
      ).not.toBe(
        hashRequest(messages, { providerOptions: { anthropic: { betas: ["other-beta"] } } }),
      );
    });

    it("keeps the pre-5.30 hash when providerOptions is absent, empty or all-undefined", () => {
      const legacy = hashRequest(
        messages,
        { temperature: 0.2, reasoning: { effort: "low" } },
        LEGACY_HASH_OPTIONS,
      );

      for (const providerOptions of [
        undefined,
        {},
        { anthropic: undefined },
        { anthropic: {} },
        { anthropic: { betas: undefined } },
        { anthropic: { body: { context_management: undefined } } },
      ]) {
        expect(
          hashRequest(messages, {
            temperature: 0.2,
            reasoning: { effort: "low" },
            providerOptions,
          }),
        ).toBe(legacy);
      }
    });

    it("still hashes a provider whose options keep one real value", () => {
      expect(
        hashRequest(messages, {
          providerOptions: { anthropic: { betas: undefined, thinkingDisplay: "summarized" } },
        }),
      ).toBe(
        hashRequest(messages, {
          providerOptions: { anthropic: { thinkingDisplay: "summarized" } },
        }),
      );
      expect(
        hashRequest(messages, {
          providerOptions: { anthropic: { thinkingDisplay: "summarized" } },
        }),
      ).not.toBe(hashRequest(messages, {}));
    });

    it("is insensitive to provider and body key order", () => {
      expect(
        hashRequest(messages, {
          providerOptions: { openai: { a: 1 }, anthropic: { body: { x: 1, y: 2 }, betas: ["b"] } },
        }),
      ).toBe(
        hashRequest(messages, {
          providerOptions: { anthropic: { betas: ["b"], body: { y: 2, x: 1 } }, openai: { a: 1 } },
        }),
      );
    });

    it("leaves cacheControl, including ttl, out of the hash", () => {
      const base = hashRequest(messages, { temperature: 0.2 });

      expect(hashRequest(messages, { temperature: 0.2, cacheControl: { ttl: "1h" } })).toBe(base);
      expect(
        hashRequest(messages, { temperature: 0.2, cacheControl: { breakpoints: 2, ttl: "5m" } }),
      ).toBe(base);
    });
  });
});
