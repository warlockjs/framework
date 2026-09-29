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
