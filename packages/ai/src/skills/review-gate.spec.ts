import { describe, expect, it } from "vitest";
import type { ToolContract } from "../tool/tool";
import type { SaveSkillResult } from "./save-skill-tool";
import type { SkillReviewGate } from "./contracts/skills-config.type";
import { runReviewGate } from "./review-gate";
import { skills } from "./skills";
import { MockSkillsStore } from "./store/mock-skills-store";
import { makeSkill, recordingAnalytics } from "./test-support/make-skill";

/** A candidate fixture to feed the gate. */
function candidate() {
  return makeSkill({
    name: "draft",
    description: "A draft",
    body: "body",
    type: "candidate",
    version: 0,
  });
}

describe("review gate — default DENY (Phase 2)", () => {
  it("does not expose saveSkill when no review gate is configured", () => {
    const lib = skills({
      name: "no-gate",
      sources: [{ type: "store", store: new MockSkillsStore([]) }],
    });

    const toolNames = lib.tools().map((tool) => tool.name);
    expect(toolNames).toContain("loadSkill");
    expect(toolNames).not.toContain("saveSkill");
  });

  it("exposes saveSkill only when a review gate is configured", () => {
    const store = new MockSkillsStore([]);
    const gate: SkillReviewGate = { approve: async () => ({ approve: false }), store };

    const lib = skills({
      name: "gated",
      sources: [{ type: "store", store }],
      review: gate,
    });

    expect(lib.tools().map((tool) => tool.name)).toContain("saveSkill");
  });

  it("leaves the candidate inert when approve resolves false", async () => {
    const store = new MockSkillsStore([]);
    await store.saveCandidate({ name: "draft", description: "A draft", body: "body" });

    const gate: SkillReviewGate = { approve: async () => ({ approve: false }), store };
    const outcome = await runReviewGate(candidate(), gate);

    expect(outcome.promoted).toBe(false);
    expect(await store.load("draft")).toBeUndefined();
  });

  it("treats a throwing gate as a denial (fail-closed)", async () => {
    const store = new MockSkillsStore([]);
    await store.saveCandidate({ name: "draft", description: "A draft", body: "body" });

    const gate: SkillReviewGate = {
      approve: async () => {
        throw new Error("validator exploded");
      },
      store,
    };

    const outcome = await runReviewGate(candidate(), gate);

    expect(outcome.promoted).toBe(false);
    expect(await store.load("draft")).toBeUndefined();
  });

  it("promotes with a version bump + analytics when approve resolves true", async () => {
    const analytics = recordingAnalytics();
    const store = new MockSkillsStore([]);
    await store.saveCandidate({ name: "draft", description: "A draft", body: "body" });

    const gate: SkillReviewGate = { approve: async () => ({ approve: true }), store };

    const outcome = await runReviewGate(candidate(), gate, analytics.record);

    expect(outcome.promoted).toBe(true);
    if (outcome.promoted) {
      expect(outcome.record).toMatchObject({ name: "draft", version: 1, type: "promoted" });
    }

    // Now catalogued + loadable.
    expect(await store.load("draft")).toMatchObject({ type: "promoted", version: 1 });
    expect(analytics.events.find((event) => event.type === "promoted")).toMatchObject({
      skill: "draft",
      version: 1,
    });
  });

  it("emits a denied analytics event when not approved", async () => {
    const analytics = recordingAnalytics();
    const store = new MockSkillsStore([]);
    const gate: SkillReviewGate = { approve: async () => ({ approve: false }), store };

    await runReviewGate(candidate(), gate, analytics.record);

    expect(analytics.events.find((event) => event.type === "denied")).toMatchObject({
      skill: "draft",
    });
  });
});

describe("review gate — candidates bound to the reviewed content", () => {
  it("never promotes a candidate that replaced the approved one", async () => {
    const store = new MockSkillsStore([]);
    const reviewed = await store.saveCandidate({
      name: "draft",
      description: "A draft",
      body: "body",
    });

    const gate: SkillReviewGate = {
      store,
      approve: async () => {
        await store.saveCandidate({ name: "draft", description: "A draft", body: "evil" });

        return { approve: true };
      },
    };

    await runReviewGate(reviewed, gate);

    expect((await store.load("draft"))?.body).toBe("body");
  });

  it("keeps a live skill loadable while a same-name candidate waits", async () => {
    const store = new MockSkillsStore([makeSkill({ name: "refund", body: "real" })]);

    await store.saveCandidate({ name: "refund", description: "x", body: "evil" });

    expect((await store.load("refund"))?.body).toBe("real");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["refund"]);
  });
});

describe("saveSkill tool — input limits and existing names", () => {
  function saveTool(store: MockSkillsStore, allowUpdates?: boolean): ToolContract<any, any> {
    const lib = skills({
      name: "gated",
      sources: [{ type: "store", store }],
      review: {
        approve: async () => ({ approve: false }),
        store,
        ...(allowUpdates !== undefined ? { allowUpdates } : {}),
      },
    });
    const tool = lib.tools("run-1").find((entry) => entry.name === "saveSkill");

    if (!tool) {
      throw new Error("saveSkill tool not found");
    }

    return tool as ToolContract<any, any>;
  }

  it("refuses an oversized body or an unsafe name", async () => {
    const tool = saveTool(new MockSkillsStore([]));

    const big = await tool.invoke({ name: "big", description: "d", body: "x".repeat(16_385) });
    const badName = await tool.invoke({ name: "../etc passwd", description: "d", body: "b" });
    const tooManyTags = await tool.invoke({
      name: "tags",
      description: "d",
      body: "b",
      tags: Array.from({ length: 11 }, (_, index) => `t${index}`),
    });

    expect(big.error).toBeDefined();
    expect(badName.error).toBeDefined();
    expect(tooManyTags.error).toBeDefined();
  });

  it("refuses the name of an existing skill unless updates are allowed", async () => {
    const store = new MockSkillsStore([makeSkill({ name: "refund", body: "real" })]);

    const refused = (
      await saveTool(store).invoke({
        name: "refund",
        description: "d",
        body: "evil",
      })
    ).data as SaveSkillResult;

    expect(refused).toEqual({
      error: 'A skill named "refund" already exists; propose the skill under a new name.',
    });

    const allowed = (
      await saveTool(store, true).invoke({
        name: "refund",
        description: "d",
        body: "update",
      })
    ).data as SaveSkillResult;

    expect(allowed).toEqual({ saved: true, name: "refund", status: "candidate" });
    expect((await store.load("refund"))?.body).toBe("real");
  });
});
