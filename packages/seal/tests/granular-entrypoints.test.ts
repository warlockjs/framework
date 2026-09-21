import { describe, expect, it } from "vitest";
import { object } from "../src/object";
import { string } from "../src/string";

// Intentionally do not import the package root: these entry points must
// install their own chain methods in a fresh module graph.
describe("granular schema entry points", () => {
  it("validates a browser form through Standard Schema without the full factory", async () => {
    const schema = object({ comment: string().trim().required().minLength(3) });

    expect(await schema["~standard"].validate({ comment: "  Hello  " })).toEqual({
      value: { comment: "Hello" },
    });
    expect(await schema["~standard"].validate({ comment: "x" })).toMatchObject({
      issues: [{ path: [{ key: "comment" }] }],
    });
    expect(await schema["~standard"].validate({})).toHaveProperty("issues");
  });

  it("retains conditional chain methods and JSON Schema support", async () => {
    const schema = object({
      password: string().required(),
      confirmation: string().sameAs("password"),
      nickname: string().optional(),
    });

    expect(await schema["~standard"].validate({ password: "abc", confirmation: "abc" })).toEqual({
      value: { password: "abc", confirmation: "abc" },
    });
    expect(
      await schema["~standard"].validate({ password: "abc", confirmation: "xyz" }),
    ).toHaveProperty("issues");
    expect(schema.toJsonSchema()).toMatchObject({
      type: "object",
      properties: { nickname: { type: "string" } },
    });
  });
});
