/**
 * The parser reads each written file once, and never reads Warlock's files
 * (the book, `index.json`, book maps). It keeps few files open at once.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseGrimoire } from "../../src/written";
import { shopRoot } from "../fixtures/shop-facts";

const reads = vi.hoisted(() => [] as string[]);
const open = vi.hoisted(() => ({ now: 0, most: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...original,
    readFile: (async (file: Parameters<typeof original.readFile>[0], ...rest: unknown[]) => {
      reads.push(String(file));
      open.now++;
      open.most = Math.max(open.most, open.now);

      try {
        return await (original.readFile as unknown as (...args: unknown[]) => Promise<unknown>)(
          file,
          ...rest,
        );
      } finally {
        open.now--;
      }
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

  it("a few at a time, so a large grimoire does not run out of file handles", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grimoire-many-"));
    const dir = path.join(root, "grimoire/tasks/done/2026-01");

    try {
      mkdirSync(dir, { recursive: true });

      for (let index = 1; index <= 300; index++) {
        writeFileSync(
          path.join(dir, `T-${index}-x.md`),
          `---\nid: T-${index}\ntype: chore\nstatus: done\nshipped: x 1.0\n---\n\n# Task ${index}\n`,
        );
      }

      open.most = 0;

      const { written, findings } = await parseGrimoire(root);

      expect(written.tasks).toHaveLength(300);
      expect(findings).toEqual([]);
      expect(open.most).toBeLessThanOrEqual(32);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
