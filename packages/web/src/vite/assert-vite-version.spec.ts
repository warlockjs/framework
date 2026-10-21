import { describe, expect, it } from "vitest";
import { assertViteVersion, viteMajorOf } from "./assert-vite-version";

describe("assertViteVersion", () => {
  it("passes Vite 8", () => {
    expect(() => assertViteVersion("8.3.3")).not.toThrow();
  });

  it("passes a Vite 8 prerelease", () => {
    expect(() => assertViteVersion("8.0.0-beta.1")).not.toThrow();
  });

  it("throws on Vite 7, naming the found version and the upgrade command", () => {
    expect(() => assertViteVersion("7.3.7")).toThrow(
      '@warlock.js/web 5.36 requires Vite 8 (found 7.3.7). Run "npx warlock upgrade --from 5.35 --to 5.36.0" or install vite@^8 and @vitejs/plugin-react@^6.',
    );
  });

  it("passes a version it cannot parse", () => {
    expect(() => assertViteVersion("unknown")).not.toThrow();
    expect(() => assertViteVersion("")).not.toThrow();
  });
});

describe("viteMajorOf", () => {
  it("reads the major of a plain version", () => {
    expect(viteMajorOf("7.3.7")).toBe(7);
  });

  it("ignores leading whitespace", () => {
    expect(viteMajorOf("  8.3.3")).toBe(8);
  });

  it("returns undefined for a version without a major", () => {
    expect(viteMajorOf("latest")).toBeUndefined();
    expect(viteMajorOf("8")).toBeUndefined();
  });
});
