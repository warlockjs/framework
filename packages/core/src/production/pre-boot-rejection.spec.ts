import { describe, expect, it } from "vitest";
import { isPreBootRejectionFatal } from "./pre-boot-rejection";

describe("isPreBootRejectionFatal", () => {
  it("is fatal under the production runtime before boot finished", () => {
    expect(isPreBootRejectionFatal({ runtimeStrategy: "production", isBooted: false })).toBe(true);
  });

  it("keeps a booted production process alive", () => {
    expect(isPreBootRejectionFatal({ runtimeStrategy: "production", isBooted: true })).toBe(false);
  });

  it("never ends the dev server or a test run", () => {
    expect(isPreBootRejectionFatal({ runtimeStrategy: "development", isBooted: false })).toBe(
      false,
    );
    expect(isPreBootRejectionFatal({ runtimeStrategy: undefined, isBooted: false })).toBe(false);
  });
});
