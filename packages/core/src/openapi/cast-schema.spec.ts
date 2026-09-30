import { describe, expect, it } from "vitest";
import { castToJsonSchema } from "./cast-schema";

describe("castToJsonSchema", () => {
  it.each([
    ["string", { type: "string" }],
    ["localized", { type: "string" }],
    ["number", { type: "number" }],
    ["float", { type: "number" }],
    ["int", { type: "integer" }],
    ["boolean", { type: "boolean" }],
    ["object", { type: "object" }],
    ["array", { type: "array" }],
    ["url", { type: "string", format: "uri" }],
    ["uploadsUrl", { type: "string", format: "uri" }],
    ["storageUrl", { type: "string", format: "uri" }],
    ["string?", { type: ["string", "null"] }],
    ["int?", { type: ["integer", "null"] }],
    ["string[]", { type: "array", items: { type: "string" } }],
    ["string[]?", { type: ["array", "null"], items: { type: "string" } }],
    ["url?", { type: ["string", "null"], format: "uri" }],
  ])("maps %s", (cast, expected) => {
    expect(castToJsonSchema(cast)).toEqual(expected);
  });

  it("maps date to the default date output object", () => {
    expect(castToJsonSchema("date")).toEqual({
      type: "object",
      properties: {
        iso: { type: "string", format: "date-time" },
        format: { type: "string" },
        timestamp: { type: "number" },
        humanTime: { type: "string" },
      },
      required: ["iso", "format", "timestamp", "humanTime"],
    });
  });

  it("makes a date array nullable on the array, not its items", () => {
    const schema = castToJsonSchema("date[]?");

    expect(schema?.type).toEqual(["array", "null"]);
    expect((schema?.items as { type: string }).type).toBe("object");
  });

  it("returns undefined for an unknown cast", () => {
    expect(castToJsonSchema("money")).toBeUndefined();
  });
});
