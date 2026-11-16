/**
 * The parser reads each written file once, and never reads Warlock's files
 * (the book, `index.json`, book maps).
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseGrimoire } from "../../src/written";
import { shopRoot } from "../fixtures/shop-facts";

const reads = vi.hoisted(() => [] as string[]);

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...original,
    readFile: (async (file: Parameters<typeof original.readFile>[0], ...rest: unknown[]) => {
      reads.push(String(file));

      return (original.readFile as unknown as (...args: unknown[]) => Promise<unknown>)(
        file,
        ...rest,
      );
    }) as unknown as typeof original.readFile,
  };
});

describe("parseGrimoire reads", () => {
  it("each written file once and nothing else", async () => {
    const messyRoot = path.join(path.dirname(shopRoot), "written-messy");

    reads.length = 0;
    await parseGrimoire(messyRoot);

    const relative = reads
      .map((file) => path.relative(messyRoot, file).split(path.sep).join("/"))
      .sort();

    expect(relative).toEqual([
      "grimoire/apps/site/README.md",
      "grimoire/apps/site/pages/results/README.md",
      "grimoire/apps/site/pages/results/blocks/result-list.md",
      "grimoire/features/search/CHANGELOG.md",
      "grimoire/features/search/README.md",
      "grimoire/features/search/flows/find.md",
      "grimoire/tasks/open/T-2-tune-ranking.md",
    ]);
  });
});
