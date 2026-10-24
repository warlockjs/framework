import { describe, expect, it, vi } from "vitest";
import { load } from "./load-hook";

describe("load hook stylesheet imports", () => {
  it.each(["a.css", "a.module.css", "a.scss", "a.css?v=3"])(
    "answers %s with an empty module instead of reaching Node's loader",
    async (file) => {
      const nextLoad = vi.fn();

      const result = await load(`file:///app/src/${file}`, {}, nextLoad);

      expect(nextLoad).not.toHaveBeenCalled();
      expect(result).toMatchObject({ format: "module", shortCircuit: true });
      expect(String(result.source)).toContain("export default");
    },
  );

  it("still hands non-stylesheet, non-TypeScript files to the next loader", async () => {
    const next = { format: "json", source: "{}" };
    const nextLoad = vi.fn(async () => next);

    expect(await load("file:///app/data.json", {}, nextLoad)).toBe(next);
  });
});
