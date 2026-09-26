import { describe, expect, it, vi } from "vitest";

const poolConfigs: Array<{ types?: { getTypeParser: (oid: number) => (value: string | null) => unknown } }> = [];
const globalInt8Parser = (value: string | null) => (value === null ? null : `global:${value}`);

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
      getTypeParser(oid: number): (value: string | null) => unknown {
        if (oid === 20) {
          return globalInt8Parser;
        }

        if (oid === 1016) {
          return (value) => (value === null ? null : value.slice(1, -1).split(","));
        }

        return (value) => value;
      },
    },
  };
});

import { types as globalTypes } from "pg";
import { PostgresDriver } from "./postgres-driver";

describe("Postgres int8 parsers", () => {
  it("uses safe-number int8 parsers only for its own pool", async () => {
    const globalParserBefore = globalTypes.getTypeParser(20);
    const driver = new PostgresDriver({ database: "test" });

    await driver.connect();

    const poolTypes = poolConfigs[0]?.types;
    expect(poolTypes).toBeDefined();

    const int8 = poolTypes!.getTypeParser(20);
    expect(int8("42")).toBe(42);
    expect(int8("9007199254740993")).toBe("9007199254740993");
    expect(int8(null)).toBeNull();

    const int8Array = poolTypes!.getTypeParser(1016);
    expect(int8Array("{42,9007199254740993}")).toEqual([42, "9007199254740993"]);
    expect(globalTypes.getTypeParser(20)).toBe(globalParserBefore);
    expect(globalTypes.getTypeParser(20)("42")).toBe("global:42");
  });
});
