import { describe, expect, it, vi } from "vitest";

const poolConfigs: Array<{ types?: unknown }> = [];

vi.mock("pg", () => {
  class Pool {
    public constructor(config: (typeof poolConfigs)[number]) {
      poolConfigs.push(config);
    }

    public on(): void {}

    public async connect(): Promise<{ release(): void }> {
      return { release() {} };
    }

    public async query(): Promise<{ rows: never[] }> {
      return { rows: [] };
    }
  }

  return {
    Pool,
    types: {
      getTypeParser(oid: number): (value: string) => unknown {
        if (oid === 1082) {
          // pg's own date parser: server-local midnight, Infinity for infinity.
          return (value) => (value.includes("infinity") ? Infinity : new Date(`${value}T00:00:00`));
        }

        return (value) => value;
      },
    },
  };
});

import { createPostgresTypes } from "./postgres-pool-types";
import { PostgresDriver } from "./postgres-driver";

const base = {
  getTypeParser(): (value: string) => unknown {
    return (value) => `pg:${value}`;
  },
};

describe("Postgres date parsers", () => {
  const types = createPostgresTypes({
    getTypeParser: ((oid: number) =>
      oid === 1082
        ? (value: string) => (value.includes("infinity") ? Infinity : `pg:${value}`)
        : base.getTypeParser()) as never,
  });

  it("reads a date as UTC midnight of its calendar day", () => {
    const value = types.getTypeParser(1082 as never)("2026-08-24") as Date;

    expect(value.toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect(value.getUTCDate()).toBe(24);
  });

  it("leaves infinity and BC dates to pg's parser", () => {
    const parse = types.getTypeParser(1082 as never);

    expect(parse("infinity")).toBe(Infinity);
    expect(parse("-infinity")).toBe(Infinity);
    expect(parse("0044-03-15 BC")).toBe("pg:0044-03-15 BC");
  });

  it("reads date arrays element by element", () => {
    const parse = types.getTypeParser(1182 as never);
    const result = parse('{2026-08-24,NULL,infinity,"0044-03-15 BC"}') as unknown[];

    expect((result[0] as Date).toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect(result[1]).toBeNull();
    expect(result[2]).toBe(Infinity);
    expect(result[3]).toBe("pg:0044-03-15 BC");
    expect(parse("{}")).toEqual([]);
  });

  it("uses the built-in parsers on the pool, and the app's own types when given", async () => {
    await new PostgresDriver({ database: "test" }).connect();
    const builtIn = poolConfigs[0]!.types as {
      getTypeParser: (oid: number) => (v: string) => Date;
    };
    expect(builtIn.getTypeParser(1082)("2026-08-24").toISOString()).toBe(
      "2026-08-24T00:00:00.000Z",
    );

    const custom = { getTypeParser: () => (value: string) => value };
    await new PostgresDriver({ database: "test", types: custom } as never).connect();
    expect(poolConfigs[1]!.types).toBe(custom);
  });
});
