import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const poolQuery = vi.fn();

class MockPool {
  public connect = connect;
  public query = poolQuery;

  public on(): void {}

  public end(): void {}
}

vi.mock("pg", () => ({
  default: { Pool: MockPool, types: { getTypeParser: () => (value: string) => value } },
  Pool: MockPool,
  types: { getTypeParser: () => (value: string) => value },
}));

const { PostgresDriver, resolveStatement } = await import("./postgres-driver");
const { PostgresQueryBuilder } = await import("./postgres-query-builder");

async function connectedDriver() {
  const driver = new PostgresDriver({ database: "test" });
  connect.mockResolvedValue({ query: vi.fn(), release: vi.fn() });
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

  await driver.connect();
  poolQuery.mockReset();
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0, fields: [] });

  return driver;
}

describe("named prepared statements", () => {
  beforeEach(() => {
    connect.mockReset();
    poolQuery.mockReset();
  });

  it("derives a stable name from the given name and the SQL text", () => {
    const first = resolveStatement("SELECT 1", [], "hot");
    const again = resolveStatement("SELECT 1", [], "hot");
    const other = resolveStatement("SELECT 2", [], "hot");

    expect(first.name).toBe(again.name);
    expect(first.name).not.toBe(other.name);
    expect(first.name?.startsWith("hot:")).toBe(true);
    expect(resolveStatement("SELECT 1", [1]).name).toBeUndefined();
  });

  it("keeps long names within the PostgreSQL identifier limit", () => {
    const { name } = resolveStatement("SELECT 1", [], "x".repeat(200));

    expect(name!.length).toBeLessThanOrEqual(63);
  });

  it("sends an unnamed query exactly as before", async () => {
    const driver = await connectedDriver();

    await driver.query("SELECT $1", [1]);

    expect(poolQuery).toHaveBeenCalledWith("SELECT $1", [1]);
  });

  it("sends the statement name when one is given", async () => {
    const driver = await connectedDriver();

    await driver.query("SELECT $1", [1], { statementName: "by-id" });

    expect(poolQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "SELECT $1",
        values: [1],
        name: expect.stringMatching(/^by-id:/),
      }),
    );
  });

  it("runs a prepared builder read as a named statement", async () => {
    const driver = await connectedDriver();
    const builder = new PostgresQueryBuilder("posts", { driver } as any);

    await builder.where("tenant", 1).prepare("tenant-posts").get();

    const call = poolQuery.mock.calls[0]![0];

    expect(call.name).toMatch(/^tenant-posts:/);
    expect(call.text).toContain("tenant");
  });

  it("keeps the prepared name on a clone", async () => {
    const driver = await connectedDriver();
    const builder = new PostgresQueryBuilder("posts", { driver } as any);

    await builder.prepare("copy").clone().get();

    expect(poolQuery.mock.calls[0]![0].name).toMatch(/^copy:/);
  });
});

describe("builder atomic writes", () => {
  beforeEach(() => {
    connect.mockReset();
    poolQuery.mockReset();
  });

  it("updates the matching rows in one statement, filter first and SET values after", async () => {
    const driver = await connectedDriver();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 3, fields: [] });
    const builder = new PostgresQueryBuilder("posts", { driver } as any);

    const modified = await builder
      .where("tenant", 7)
      .atomic({ $set: { status: "done" }, $inc: { views: 2 } });

    expect(modified).toBe(3);
    expect(poolQuery).toHaveBeenCalledTimes(1);

    const [sql, params] = poolQuery.mock.calls[0]!;

    expect(sql).toContain('UPDATE "posts" SET');
    expect(sql).toContain("WHERE");
    expect(sql).toMatch(/"status" = \$2/);
    expect(sql).toMatch(/"views" = COALESCE\("views", 0\) \+ \$3/);
    expect(params).toEqual([7, "done", 2]);
  });

  it("refuses an upsert through the builder", async () => {
    const driver = await connectedDriver();

    await expect(
      driver.atomicWhere("posts", { sql: "", params: [] }, { $set: { a: 1 } }, { upsert: true }),
    ).rejects.toThrow(/upsert/);
  });
});
