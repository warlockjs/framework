import { describe, expect, it } from "vitest";
import { humanizeAttribute } from "../../../src/index";

describe("humanizeAttribute", () => {
  it("humanises snake_case", () => {
    expect(humanizeAttribute("max_dumbbell_kg")).toBe("Max dumbbell kg");
  });

  it("humanises camelCase", () => {
    expect(humanizeAttribute("firstName")).toBe("First name");
  });

  it("humanises kebab-case and dotted keys", () => {
    expect(humanizeAttribute("first-name")).toBe("First name");
    expect(humanizeAttribute("address.postal_code")).toBe("Address postal code");
  });

  it("keeps acronyms together and lowercases them", () => {
    expect(humanizeAttribute("userID")).toBe("User id");
    expect(humanizeAttribute("HTMLBody")).toBe("Html body");
  });

  it("capitalises a single word", () => {
    expect(humanizeAttribute("name")).toBe("Name");
  });

  it("collapses repeated separators", () => {
    expect(humanizeAttribute("__first__name_")).toBe("First name");
  });

  it("leaves keys without letters unchanged", () => {
    expect(humanizeAttribute("0")).toBe("0");
    expect(humanizeAttribute("")).toBe("");
  });
});
