import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { environment, setEnvironment } from "../../../src/utils/environment";

let originalNodeEnv: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("environment", () => {
  it("reads the current NODE_ENV", () => {
    process.env.NODE_ENV = "production";

    expect(environment()).toBe("production");
  });

  it("falls back to development when NODE_ENV is unset", () => {
    delete process.env.NODE_ENV;

    expect(environment()).toBe("development");
  });
});

describe("setEnvironment", () => {
  it("updates NODE_ENV and is observed by environment()", () => {
    setEnvironment("test");

    expect(process.env.NODE_ENV).toBe("test");
    expect(environment()).toBe("test");
  });
});
