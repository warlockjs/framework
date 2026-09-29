import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureSeal, resetSealConfig } from "../../../src/config";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

const translateAttribute = ({ attribute }: { attribute: string }) =>
  attribute === "validation.attributes.name" ? "Localized name" : attribute;

describe("BaseValidator translated attributes", () => {
  beforeEach(() => configureSeal({ translateAttribute }));
  afterEach(resetSealConfig);

  it("preserves translated attributes through a clone-on-write chain", async () => {
    const schema = v.object({
      name: v.string().transAttributes({ input: "validation.attributes.name" }).min(2),
    });

    const result = await validate(schema, { name: "" });

    expect(result.errors[0]?.error).toBe("The Localized name is required");
  });

  it.each([
    ["required before translated attributes", () =>
      v.string().required().transAttributes({ input: "validation.attributes.name" })],
    ["translated attributes before required", () =>
      v.string().transAttributes({ input: "validation.attributes.name" }).required()],
  ])("resolves required labels lazily when %s", async (_name, makeValidator) => {
    const validator = makeValidator();
    const schema = v.object({ name: validator });

    const result = await validate(schema, {});

    expect(result.errors[0]?.error).toBe("The Localized name is required");
  });
});
