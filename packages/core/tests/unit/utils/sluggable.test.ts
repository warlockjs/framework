import { describe, expect, it } from "vitest";
import { sluggable } from "../../../src/utils/sluggable";

// sluggable() returns a model casting: a function that pulls a field off the
// model and slugifies it. Only `model.get(key)` is used at runtime, so a thin
// structural stub stands in for a real Cascade Model.
const modelWith = (data: Record<string, unknown>) => {
  return {
    get(key: string) {
      return data[key];
    },
  } as never;
};

describe("sluggable", () => {
  it("slugifies a plain string field", () => {
    const cast = sluggable("title");

    expect(cast(modelWith({ title: "Hello World" }))).toBe("hello-world");
  });

  it("returns an empty string when the source field is missing", () => {
    const cast = sluggable("title");

    expect(cast(modelWith({}))).toBe("");
  });

  it("picks the matching locale value from a localized array", () => {
    const cast = sluggable("name");

    const model = modelWith({
      name: [
        { localeCode: "ar", value: "اهلا" },
        { localeCode: "en", value: "Welcome Aboard" },
      ],
    });

    expect(cast(model)).toBe("welcome-aboard");
  });

  it("honors a custom slug locale code", () => {
    const cast = sluggable("name", "fr");

    const model = modelWith({
      name: [
        { localeCode: "en", value: "Hello" },
        { localeCode: "fr", value: "Bonjour Le Monde" },
      ],
    });

    expect(cast(model)).toBe("bonjour-le-monde");
  });

  it("coerces a non-string scalar to a string before slugifying", () => {
    const cast = sluggable("id");

    expect(cast(modelWith({ id: 12345 }))).toBe("12345");
  });
});
