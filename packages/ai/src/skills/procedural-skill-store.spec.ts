import { MemoryCacheDriver } from "@warlock.js/cache";
import { describe, expect, it } from "vitest";
import { memory } from "../memory";
import { runReviewGate } from "./review-gate";
import { proceduralSkillStore } from "./store/procedural-skill-store";
import { FakeEmbedder } from "./test-support/make-skill";

/** A vector-capable cache driver wired like the memory specs do. */
function makeStore(): MemoryCacheDriver {
  const driver = new MemoryCacheDriver();
  driver.setOptions({});
  driver.setLoggingState(false);

  return driver;
}

describe("proceduralSkillStore — skills ⇄ procedural-memory unification (Phase 2)", () => {
  it("saves an inert candidate that is not listed or loaded", async () => {
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: makeStore() });

    const candidate = await store.saveCandidate({
      name: "deploy",
      description: "Deploy the app",
      body: "run the deploy script",
    });

    expect(candidate).toMatchObject({ name: "deploy", version: 0, type: "candidate" });
    expect(await store.list()).toEqual([]);
    expect(await store.load("deploy")).toBeUndefined();
  });

  it("promote bumps the version, flips to promoted, and reinforces (uses increments)", async () => {
    const driver = makeStore();
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: driver });

    await store.saveCandidate({
      name: "deploy",
      description: "Deploy the app",
      body: "deploy steps",
    });

    const promoted = await store.promote("deploy");

    expect(promoted).toMatchObject({ name: "deploy", version: 1, type: "promoted" });

    // Now catalogued + loadable.
    const list = await store.list();
    expect(list.map((entry) => entry.name)).toEqual(["deploy"]);

    const record = await store.load("deploy");
    expect(record).toMatchObject({
      name: "deploy",
      version: 1,
      type: "promoted",
      body: "deploy steps",
    });

    // Reinforcement: re-remembering the same id again (a second promote)
    // bumps the version monotonically and keeps the entry.
    const again = await store.promote("deploy");
    expect(again.version).toBe(2);
  });

  it("throws when promoting an unknown skill", async () => {
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: makeStore() });

    await expect(store.promote("ghost")).rejects.toThrow(/no skill named "ghost"/);
  });

  it("filters listed promoted skills by intersecting scope tags", async () => {
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: makeStore() });

    await store.saveCandidate({
      name: "fe",
      description: "Frontend",
      body: "fe",
      tags: ["frontend"],
    });
    await store.promote("fe");
    await store.saveCandidate({
      name: "be",
      description: "Backend",
      body: "be",
      tags: ["backend"],
    });
    await store.promote("be");

    const filtered = await store.list({ tags: ["frontend"] });
    expect(filtered.map((entry) => entry.name)).toEqual(["fe"]);
  });
});

describe("proceduralSkillStore — candidates stay apart from live skills", () => {
  it("keeps a promoted skill when a candidate is saved under its name", async () => {
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: makeStore() });

    await store.saveCandidate({ name: "refund", description: "Refunds", body: "real policy" });
    await store.promote("refund");
    await store.saveCandidate({ name: "refund", description: "Refunds", body: "evil" });

    expect((await store.load("refund"))?.body).toBe("real policy");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["refund"]);
  });

  it("promotes only the reviewed content, never a candidate written after review", async () => {
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: makeStore() });
    const reviewed = await store.saveCandidate({
      name: "refund",
      description: "Refunds",
      body: "reviewed body",
    });

    const outcome = await runReviewGate(reviewed, {
      store,
      approve: async () => {
        // Written while the reviewer was deciding.
        await store.saveCandidate({ name: "refund", description: "Refunds", body: "evil" });

        return { approve: true };
      },
    });

    expect(outcome.promoted).toBe(true);
    expect((await store.load("refund"))?.body).toBe("reviewed body");
  });

  it("refuses to promote reviewed content that is no longer stored", async () => {
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: makeStore() });

    await store.saveCandidate({ name: "refund", description: "Refunds", body: "stored" });

    await expect(
      store.promote("refund", { description: "Refunds", body: "something else" }),
    ).rejects.toThrow(/matches the reviewed content/);
    expect(await store.load("refund")).toBeUndefined();
  });

  it("bumps the version from the live skill when a candidate updates it", async () => {
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: makeStore() });

    await store.saveCandidate({ name: "deploy", description: "Deploy", body: "v1" });
    await store.promote("deploy");
    await store.promote("deploy");
    await store.saveCandidate({ name: "deploy", description: "Deploy", body: "v3" });

    const promoted = await store.promote("deploy", { description: "Deploy", body: "v3" });

    expect(promoted).toMatchObject({ version: 3, body: "v3", type: "promoted" });
  });
});

describe("proceduralSkillStore — listing cost", () => {
  it("lists and loads without an embedding call once the index exists", async () => {
    const embedder = new FakeEmbedder();
    const store = proceduralSkillStore({ embedder, store: makeStore() });

    await store.saveCandidate({ name: "deploy", description: "Deploy", body: "steps" });
    await store.promote("deploy");

    const before = embedder.embedCalls;

    await store.list();
    await store.list();
    await store.load("deploy");

    expect(embedder.embedCalls).toBe(before);
  });

  it("serves more than 1,000 skills", async () => {
    const store = proceduralSkillStore({ embedder: new FakeEmbedder(), store: makeStore() });

    for (let index = 0; index < 1005; index++) {
      await store.saveCandidate({ name: `s${index}`, description: "d", body: `b${index}` });
      await store.promote(`s${index}`);
    }

    expect(await store.list()).toHaveLength(1005);
    // 2,010 sequential writes; the default 5 s limit is too tight when the
    // whole suite runs in parallel.
  }, 30_000);
});

describe("proceduralSkillStore — skills stored by the earlier layout", () => {
  /** Write skills the way the earlier release did: one procedural memory per name. */
  async function seedLegacy(driver: MemoryCacheDriver, embedder: FakeEmbedder): Promise<void> {
    const legacy = memory({
      name: "skills.procedural",
      working: false,
      defaultTier: "procedural",
      procedural: { embedder, store: driver },
    });

    await legacy.remember({
      id: "deploy",
      text: "legacy deploy steps",
      tier: "procedural",
      metadata: {
        skill: true,
        name: "deploy",
        type: "promoted",
        description: "Deploy",
        version: 2,
        tags: ["ops"],
      },
    });
    await legacy.remember({
      id: "draft",
      text: "legacy draft",
      tier: "procedural",
      metadata: {
        skill: true,
        name: "draft",
        type: "candidate",
        description: "Draft",
        version: 0,
      },
    });
  }

  it("lists and loads earlier-layout skills and keeps their candidates promotable", async () => {
    const driver = makeStore();
    const embedder = new FakeEmbedder();
    await seedLegacy(driver, embedder);

    const store = proceduralSkillStore({ embedder, store: driver });

    expect(await store.list()).toEqual([
      { name: "deploy", description: "Deploy", version: 2, tags: ["ops"], type: "promoted" },
    ]);
    expect(await store.load("deploy")).toMatchObject({ body: "legacy deploy steps", version: 2 });
    expect(await store.load("draft")).toBeUndefined();

    const promoted = await store.promote("draft", { description: "Draft", body: "legacy draft" });

    expect(promoted).toMatchObject({ name: "draft", version: 1, type: "promoted" });
    expect((await store.list()).map((entry) => entry.name).sort()).toEqual(["deploy", "draft"]);
  });

  it("loads an earlier-layout skill by name before any listing", async () => {
    const driver = makeStore();
    const embedder = new FakeEmbedder();
    await seedLegacy(driver, embedder);

    const store = proceduralSkillStore({ embedder, store: driver });

    expect((await store.load("deploy"))?.body).toBe("legacy deploy steps");
  });
});
