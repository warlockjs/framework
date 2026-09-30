import type { Model } from "@warlock.js/cascade";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Response } from "./response";
import type { Serialized } from "./serialized";

/**
 * Type-level coverage for `Serialized<T, W>`. The `expectTypeOf` assertions are
 * enforced by `tsc -p tsconfig.typecheck.json`; at plain runtime they are
 * inert. The one runtime `it` feeds a fixture through the real
 * `Response.parse` + `JSON.stringify` and checks the result against a literal
 * declared `satisfies Serialized<typeof fixture>`, so the type and the runtime
 * cannot drift apart silently.
 *
 * Out of scope here (they need `defineResource` output typing): the
 * `ResourceOutput` assertions from the design note. Resources below are plain
 * classes with a typed `toJSON()`.
 */

interface SpecUserData {
  id: number;
  password: string;
  createdAt: Date;
  nickname?: string;
}

interface SpecUserOutput {
  id: number;
  joinedAt: Date;
  tags: string[];
}

declare class SpecUserResource {
  toJSON(): SpecUserOutput;
}

declare class SpecUser extends Model<SpecUserData> {}

/** Adds a member, so it is a strict subtype of `SpecUser` and not mutually assignable with it. */
declare class SpecAdmin extends SpecUser {
  role: string;
}

declare class SpecTag extends Model<{ id: number; createdAt: Date; note?: string }> {}

/** A class with a private member and no `toJSON`: detectable as a class instance. */
declare class SpecCounter {
  private count: number;
  label: string;
  increment(): void;
}

declare module "./serialized" {
  interface ModelResourceRegistry {
    __SerializedSpecUser: { model: SpecUser; resource: typeof SpecUserResource };
  }
}

type SerializedUserOutput = { id: number; joinedAt: string; tags: string[] };

interface SpecCategory {
  id: number;
  children: SpecCategory[];
}

describe("Serialized, json wire", () => {
  it("turns Date into string through toJSON", () => {
    expectTypeOf<Serialized<Date>>().toEqualTypeOf<string>();
    expectTypeOf<Serialized<Date | null>>().toEqualTypeOf<string | null>();
  });

  it("turns Map into a record and Set into an array", () => {
    expectTypeOf<Serialized<Map<"a", Date>>>().toEqualTypeOf<Record<"a", string>>();
    expectTypeOf<Serialized<Set<number>>>().toEqualTypeOf<number[]>();
    expectTypeOf<Serialized<Set<Date>>>().toEqualTypeOf<string[]>();
  });

  it("drops function keys and keeps data keys", () => {
    expectTypeOf<Serialized<{ a: Date; f: () => void }>>().toEqualTypeOf<{ a: string }>();
    expectTypeOf<Serialized<{ a: number; f?: () => void }>>().toEqualTypeOf<{ a: number }>();
  });

  it("uses the toJSON result, awaited", () => {
    expectTypeOf<Serialized<{ toJSON(): { id: number } }>>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<Serialized<{ toJSON(): Promise<{ d: Date }> }>>().toEqualTypeOf<{ d: string }>();
  });

  it("passes binary through", () => {
    expectTypeOf<Serialized<Buffer>>().toEqualTypeOf<Buffer>();
    expectTypeOf<Serialized<Uint8Array>>().toEqualTypeOf<Uint8Array>();
  });

  it("makes undefined-valued keys optional", () => {
    expectTypeOf<Serialized<{ a?: number | undefined }>>().toEqualTypeOf<{ a?: number }>();
    expectTypeOf<Serialized<{ a: number | undefined }>>().toEqualTypeOf<{ a?: number }>();
    expectTypeOf<Serialized<{ a?: Date }>>().toEqualTypeOf<{ a?: string }>();
  });

  it("keeps any and unknown", () => {
    expectTypeOf<Serialized<any>>().toBeAny();
    expectTypeOf<Serialized<unknown>>().toBeUnknown();
    expectTypeOf<Serialized<{ a: any }>>().toEqualTypeOf<{ a: any }>();
  });

  it("maps arrays, tuples and nested objects", () => {
    expectTypeOf<Serialized<Date[]>>().toEqualTypeOf<string[]>();
    expectTypeOf<Serialized<readonly [Date, number]>>().toEqualTypeOf<[string, number]>();
    expectTypeOf<Serialized<{ a: { b: { c: Date } } }>>().toEqualTypeOf<{
      a: { b: { c: string } };
    }>();
  });

  it("maps a class with private members to its public data properties", () => {
    expectTypeOf<Serialized<SpecCounter>>().toEqualTypeOf<{ label: string }>();
  });

  it("maps Error to an empty object", () => {
    expectTypeOf<Serialized<Error>>().toEqualTypeOf<{}>();
  });

  it("stops at the depth cap instead of recursing forever", () => {
    expectTypeOf<Serialized<SpecCategory>["id"]>().toEqualTypeOf<number>();
    expectTypeOf<Serialized<SpecCategory>["children"]>().toBeArray();
  });

  it("exposes the function type itself as never", () => {
    expectTypeOf<Serialized<() => void>>().toBeNever();
  });
});

describe("Serialized, devalue wire", () => {
  it("keeps Date, Map, Set, RegExp and URL native", () => {
    expectTypeOf<Serialized<Date, "devalue">>().toEqualTypeOf<Date>();
    expectTypeOf<Serialized<Map<string, number>, "devalue">>().toEqualTypeOf<Map<string, number>>();
    expectTypeOf<Serialized<Set<number>, "devalue">>().toEqualTypeOf<Set<number>>();
    expectTypeOf<Serialized<RegExp, "devalue">>().toEqualTypeOf<RegExp>();
    expectTypeOf<Serialized<URL, "devalue">>().toEqualTypeOf<URL>();
  });

  it("keeps Date inside objects and arrays", () => {
    expectTypeOf<Serialized<{ a: Date; f: () => void }, "devalue">>().toEqualTypeOf<{ a: Date }>();
    expectTypeOf<Serialized<Date[], "devalue">>().toEqualTypeOf<Date[]>();
  });

  it("keeps undefined-valued keys as declared", () => {
    expectTypeOf<Serialized<{ a: number | undefined }, "devalue">>().toEqualTypeOf<{
      a: number | undefined;
    }>();
    expectTypeOf<Serialized<{ a?: Date }, "devalue">>().toEqualTypeOf<{ a?: Date }>();
  });

  it("still uses toJSON for other objects, without converting Date in the result", () => {
    expectTypeOf<Serialized<{ toJSON(): { d: Date } }, "devalue">>().toEqualTypeOf<{ d: Date }>();
  });

  it("passes binary through", () => {
    expectTypeOf<Serialized<Buffer, "devalue">>().toEqualTypeOf<Buffer>();
  });

  it("is never for a class without toJSON, because devalue throws on it", () => {
    expectTypeOf<Serialized<SpecCounter, "devalue">>().toBeNever();
    expectTypeOf<Serialized<Error, "devalue">>().toBeNever();
    expectTypeOf<Serialized<{ counter: SpecCounter }, "devalue">>().toEqualTypeOf<{
      counter: never;
    }>();
  });
});

describe("Serialized, models", () => {
  it("resolves a registered model to its resource output", () => {
    expectTypeOf<Serialized<SpecUser>>().toEqualTypeOf<SerializedUserOutput>();
    expectTypeOf<Serialized<SpecUser, "devalue">>().toEqualTypeOf<{
      id: number;
      joinedAt: Date;
      tags: string[];
    }>();
    expectTypeOf<Serialized<SpecUser[]>>().toEqualTypeOf<SerializedUserOutput[]>();
  });

  it("resolves an unregistered model to its serialized data type", () => {
    expectTypeOf<Serialized<SpecTag>>().toEqualTypeOf<{
      id: number;
      createdAt: string;
      note?: string;
    }>();
    expectTypeOf<Serialized<SpecTag, "devalue">>().toEqualTypeOf<{
      id: number;
      createdAt: Date;
      note?: string;
    }>();
  });

  it("does not hand a subclass its parent's resource", () => {
    expectTypeOf<Serialized<SpecAdmin>>().toEqualTypeOf<{
      id: number;
      password: string;
      createdAt: string;
      nickname?: string;
    }>();
  });

  it("walks a pagination-like result", () => {
    expectTypeOf<
      Serialized<{ data: SpecUser[]; paginationInfo: { total: number } }>
    >().toEqualTypeOf<{
      data: SerializedUserOutput[];
      paginationInfo: { total: number };
    }>();
  });
});

describe("Serialized, runtime parity with Response.parse", () => {
  it("matches the real json round trip", async () => {
    const fixture = {
      map: new Map([["a", new Date(0)]]),
      set: new Set([1, 2]),
      date: new Date(0),
      custom: {
        toJSON() {
          return { id: 1, at: new Date(0) };
        },
      },
      nested: { deep: { when: new Date(0), skipped: undefined as string | undefined } },
      list: [new Date(0), { n: 1 }],
      fn() {
        return 1;
      },
    };

    const expected = {
      map: { a: "1970-01-01T00:00:00.000Z" },
      set: [1, 2],
      date: "1970-01-01T00:00:00.000Z",
      custom: { id: 1, at: "1970-01-01T00:00:00.000Z" },
      nested: { deep: { when: "1970-01-01T00:00:00.000Z" } },
      list: ["1970-01-01T00:00:00.000Z", { n: 1 }],
    } satisfies Serialized<typeof fixture>;

    const parsed = await new Response().parse(fixture);
    const wire = JSON.parse(JSON.stringify(parsed));

    expect(wire).toEqual(expected);
  });
});
