import { validate, v } from "../index";

describe("optional fields with mutators", () => {
  it("skips mutators for omitted optional string fields", async () => {
    const mutator = vi.fn((value) => value);
    const trimmed = await validate(v.object({ photo: v.string().trim().optional() }), {});
    const lowercased = await validate(v.object({ photo: v.string().lowercase().optional() }), {});
    const custom = await validate(v.object({ photo: v.string().addMutator(mutator).optional() }), {});

    expect(trimmed).toMatchObject({ isValid: true, data: {} });
    expect(lowercased).toMatchObject({ isValid: true, data: {} });
    expect(custom).toMatchObject({ isValid: true, data: {} });
    expect(mutator).not.toHaveBeenCalled();
  });

  it("accepts null for a nullable optional field with mutators", async () => {
    const result = await validate(
      v.object({ photo: v.string().trim().nullable().optional() }),
      { photo: null },
    );

    expect(result).toMatchObject({ isValid: true, data: { photo: null } });
  });

  it("still mutates present values", async () => {
    const result = await validate(v.object({ photo: v.string().trim().optional() }), {
      photo: "  portrait.jpg  ",
    });

    expect(result).toMatchObject({ isValid: true, data: { photo: "portrait.jpg" } });
  });
});
