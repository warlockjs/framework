import { describe, expect, it, vi } from "vitest";
import { readRowKey, streamRows, type ChunkPage } from "./keyset-chunk";

function pagesOf(rows: Array<{ id: number }>) {
  return vi.fn(async (page: ChunkPage, size: number) => {
    const start =
      page.offset ??
      (page.after === undefined ? 0 : rows.findIndex((row) => row.id === page.after) + 1);

    return rows.slice(start, start + size);
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) items.push(item);

  return items;
}

describe("streamRows", () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }));

  it("yields every row, reading one batch at a time by key", async () => {
    const fetchPage = pagesOf(rows);

    const result = await collect(
      streamRows(3, { key: "id", direction: "asc", sorted: false }, fetchPage),
    );

    expect(result.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([
      { after: undefined },
      { after: 3 },
      { after: 6 },
    ]);
  });

  it("pages by offset without a plan", async () => {
    const fetchPage = pagesOf(rows);

    await collect(streamRows(5, undefined, fetchPage));

    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([{ offset: 0 }, { offset: 5 }]);
  });

  it("stops reading when the consumer leaves the loop", async () => {
    const fetchPage = pagesOf(rows);

    for await (const row of streamRows(
      2,
      { key: "id", direction: "asc", sorted: false },
      fetchPage,
    )) {
      if (row.id === 2) break;
    }

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("falls back to offset paging when a row has no key", async () => {
    const keyless = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const fetchPage = vi.fn(async (page: ChunkPage, size: number) =>
      keyless.slice(page.offset ?? 0, (page.offset ?? 0) + size),
    );

    const result = await collect(
      streamRows(2, { key: "id", direction: "asc", sorted: false }, fetchPage),
    );

    expect(result).toHaveLength(3);
    expect(fetchPage.mock.calls[1]![0]).toEqual({ offset: 2 });
  });

  it("rejects an invalid batch size", async () => {
    await expect(collect(streamRows(0, undefined, async () => []))).rejects.toThrow();
  });
});

describe("readRowKey", () => {
  it("reads a model column through get()", () => {
    const model = { get: (column: string) => (column === "createdAt" ? "2026-01-01" : undefined) };

    expect(readRowKey(model, "createdAt")).toBe("2026-01-01");
  });

  it("reads a lean row as a property", () => {
    expect(readRowKey({ createdAt: 5 }, "createdAt")).toBe(5);
  });
});
