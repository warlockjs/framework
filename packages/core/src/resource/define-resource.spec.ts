import { describe, expect, it } from "vitest";
import { defineResource } from "./define-resource";

describe("defineResource Mongo id mapping", () => {
  const MongoResource = defineResource({
    schema: {
      id: "string",
      name: "string",
      externalId: "string",
    },
  });

  it("falls back to _id when id is absent", () => {
    expect(
      new MongoResource({
        _id: { toHexString: () => "abc" },
        name: "Mongo record",
      }).toJSON(),
    ).toMatchObject({ id: "abc", name: "Mongo record" });
  });

  it("keeps an explicit id over _id", () => {
    const NumericIdResource = defineResource({ schema: { id: "number" } });

    expect(
      new NumericIdResource({ id: 5, _id: { toHexString: () => "abc" } }).toJSON(),
    ).toMatchObject({ id: 5 });
  });

  it("does not apply the fallback to non-id output keys", () => {
    expect(new MongoResource({ _id: "abc" }).toJSON()).not.toHaveProperty("externalId");
  });
});

describe("defineResource arrayOf item schema casts", () => {
  const OrderResource = defineResource({
    schema: {
      id: "number",
      lines: {
        __type: "arrayOf",
        schema: {
          qty: "number",
          note: "string?",
          shippedAt: "date",
          labels: "string[]",
          sku: ["product_sku", "string"],
          // nested arrayOf is normalised too
          options: { __type: "arrayOf", schema: { value: "number", hint: "string?" } },
        },
      },
    },
  });

  it("normalises cast strings in item schemas instead of dropping the keys", () => {
    const output = new OrderResource({
      id: 1,
      lines: [
        {
          qty: "3",
          note: "fragile",
          shippedAt: "2024-05-06T07:08:09.000Z",
          labels: [1, 2],
          product_sku: "A-1",
          options: [{ value: "9", hint: null }],
        },
        { qty: 4, note: null, shippedAt: "2024-05-06T07:08:09.000Z", labels: ["x"], options: [] },
      ],
    }).toJSON() as { lines: Record<string, any>[] };

    expect(output.lines).toHaveLength(2);

    const first = output.lines[0]!;
    const second = output.lines[1]!;

    expect(first.qty).toBe(3);
    expect(first.note).toBe("fragile");
    expect(first.shippedAt).toMatchObject({ iso: "2024-05-06T07:08:09.000Z" });
    expect(first.labels).toEqual(["1", "2"]);
    expect(first.sku).toBe("A-1");
    expect(first.options).toEqual([{ value: 9, hint: null }]);

    // the optional cast keeps the key with null instead of dropping it
    expect(second).toHaveProperty("note", null);
    expect(second.qty).toBe(4);
    expect(second.labels).toEqual(["x"]);
    expect(second.options).toEqual([]);
  });
});
