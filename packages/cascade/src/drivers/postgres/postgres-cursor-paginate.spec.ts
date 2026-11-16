import { describe, expect, it, vi } from "vitest";
import { PostgresQueryBuilder } from "./postgres-query-builder";

describe("PostgreSQL cursorPaginate()", () => {
  it("reads cursor values of a model column through get()", async () => {
    const rows = [1, 2, 3].map((n) => ({
      get: (column: string) => (column === "createdAt" ? `2026-01-0${n}` : undefined),
    }));
    const builder = new PostgresQueryBuilder<any>("posts", { driver: {} } as any);

    vi.spyOn(builder, "get").mockResolvedValue(rows as any);

    const result = await builder.cursorPaginate({ limit: 2, column: "createdAt", cursor: "2025" });

    expect(result.data).toHaveLength(2);
    expect(result.pagination.nextCursor).toBe("2026-01-02");
    expect(result.pagination.prevCursor).toBe("2026-01-01");
  });

  it("still reads lean rows as properties", async () => {
    const builder = new PostgresQueryBuilder<any>("posts", { driver: {} } as any);

    vi.spyOn(builder, "get").mockResolvedValue([{ createdAt: 1 }, { createdAt: 2 }] as any);

    const result = await builder.cursorPaginate({ limit: 1, column: "createdAt" });

    expect(result.pagination.nextCursor).toBe(1);
  });
});
