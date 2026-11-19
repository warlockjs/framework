import { describe, expect, it } from "vitest";
import { DEVTOOLS_MOUNTED_KEY, devtoolsPathHint, isInsideWarlockApp } from "./warlock-app";

const none = { global: {}, env: {}, cwd: () => "/app", exists: () => false };

describe("isInsideWarlockApp", () => {
  it("is false when no signal is present", () => {
    expect(isInsideWarlockApp(none)).toBe(false);
  });

  it("is true when devtools published its marker", () => {
    const global = { [DEVTOOLS_MOUNTED_KEY]: { path: "/__warlock", mode: "development" } };

    expect(isInsideWarlockApp({ ...none, global })).toBe(true);
  });

  it("is true when warlock start set the boot signal", () => {
    expect(isInsideWarlockApp({ ...none, env: { WARLOCK_BOOT_SIGNAL: "1" } })).toBe(true);
  });

  it.each(["ts", "js", "mjs", "cjs"])("is true when warlock.config.%s exists", (extension) => {
    const exists = (path: string) => path === `/app/warlock.config.${extension}`;

    expect(isInsideWarlockApp({ ...none, exists })).toBe(true);
  });

  it("is false when the probe throws", () => {
    const exists = () => {
      throw new Error("boom");
    };

    expect(isInsideWarlockApp({ ...none, exists })).toBe(false);
  });
});

describe("devtoolsPathHint", () => {
  it("uses the mounted path", () => {
    const global = { [DEVTOOLS_MOUNTED_KEY]: { path: "/tools", mode: "development" } };

    expect(devtoolsPathHint({ global })).toBe("/tools");
  });

  it("falls back to /__warlock", () => {
    expect(devtoolsPathHint({ global: {} })).toBe("/__warlock");
  });
});
