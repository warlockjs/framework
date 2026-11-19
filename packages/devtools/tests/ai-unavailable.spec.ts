import { describe, expect, it, vi } from "vitest";
vi.mock("../src/current-request-id", () => ({ currentRequestId: () => undefined }));
import { attachAiSource } from "../src/sources/ai-source";

const missing = (name: string) => Promise.reject(new Error(`Cannot find package '${name}'`));
const versions = (table: Record<string, string>) => (name: string) => table[name] ?? null;

describe("optional Panoptic integration", () => {
  it("ai-missing: neither package is installed", async () => {
    const source = await attachAiSource(200, { load: missing, version: versions({}) });
    expect(source).toMatchObject({
      available: false,
      reason: "ai-missing",
      title: "AI isn't installed",
      command: "warlock add ai",
    });
    expect(() => source.dispose()).not.toThrow();
  });

  it("panoptic-missing: ai is installed, Panoptic is not", async () => {
    const source = await attachAiSource(200, {
      load: missing,
      version: versions({ "@warlock.js/ai": "5.58.0" }),
    });
    expect(source).toMatchObject({
      available: false,
      reason: "panoptic-missing",
      message: "Your app uses @warlock.js/ai. Add Panoptic to see its runs.",
      command: "warlock add ai-panoptic",
    });
  });

  it("panoptic-failed: replaces absolute paths in the load error", async () => {
    const source = await attachAiSource(200, {
      load: () =>
        Promise.reject(
          new Error(
            "Cannot find module '/srv/app/node_modules/@warlock.js/ai-panoptic/dist/index.mjs' imported from /srv/app/src/x.ts",
          ),
        ),
      version: versions({ "@warlock.js/ai": "5.58.0", "@warlock.js/ai-panoptic": "5.58.0" }),
    });
    const detail = (source as { detail?: string }).detail ?? "";

    expect(detail).toContain("@warlock.js/ai-panoptic/dist/index.mjs");
    expect(detail).toContain("<path>");
    expect(detail).not.toContain("/srv/app");
  });

  it("panoptic-failed: shows the error message (no stack) and both versions", async () => {
    const source = await attachAiSource(200, {
      load: () => Promise.reject(new Error("boom\n    at stack line")),
      version: versions({ "@warlock.js/ai": "5.58.0", "@warlock.js/ai-panoptic": "5.57.0" }),
    });
    expect(source).toMatchObject({
      available: false,
      reason: "panoptic-failed",
      detail: "boom (@warlock.js/ai 5.58.0, @warlock.js/ai-panoptic 5.57.0)",
    });
    expect(JSON.stringify(source)).not.toContain("stack line");
  });

  it("observation-off: loaded, no observeAll and no observer", async () => {
    const panoptic = await import("@warlock.js/ai-panoptic");
    let all = false;
    const observers: unknown[] = [];
    const source = await attachAiSource(200, {
      load: async (name) =>
        name === "@warlock.js/ai-panoptic"
          ? panoptic
          : { isObserveAll: () => all, getObservers: () => observers },
    });
    if (!source.available) throw new Error("expected an available source");
    expect(source.observationOff?.()).toBe(true);
    all = true;
    expect(source.observationOff?.()).toBe(false);
    all = false;
    observers.push({});
    expect(source.observationOff?.()).toBe(false);
    source.dispose();
  });
});
