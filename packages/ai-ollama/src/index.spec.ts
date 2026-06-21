import { describe, expect, it } from "vitest";
import * as pkg from "./index";
import { OllamaSDK } from "./sdk";

describe("package barrel", () => {
  it("re-exports OllamaSDK as the public entry point", () => {
    expect(pkg.OllamaSDK).toBe(OllamaSDK);
    expect(new pkg.OllamaSDK()).toBeInstanceOf(OllamaSDK);
  });

  it("exposes exactly the documented runtime surface", () => {
    // Types are erased at runtime; only the SDK class is a value export.
    expect(Object.keys(pkg)).toEqual(["OllamaSDK"]);
  });
});
