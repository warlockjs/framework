import { afterEach, describe, expect, it } from "vitest";
import { Application } from "@warlock.js/core";
import { discloseErrorDetails } from "./error-disclosure";
import {
  GENERIC_PRODUCTION_ERROR_MESSAGE,
  hydrationErrorPageProps,
  serializePageError,
} from "./error-page";

const originalEnvironment = process.env.NODE_ENV;
const originalStrategy = Application.runtimeStrategy;

afterEach(() => {
  process.env.NODE_ENV = originalEnvironment;
  (Application as { runtimeStrategy: unknown }).runtimeStrategy = originalStrategy;
});

const debug = { phase: "loader", routePath: "/orders" } as never;

describe("error detail disclosure", () => {
  it("withholds details from a production bundle whatever NODE_ENV says", () => {
    Application.setRuntimeStrategy("production");
    process.env.NODE_ENV = "staging";

    const serialized = serializePageError(new Error("db down at mongo-1:27017"), "req-1");

    expect(discloseErrorDetails()).toBe(false);
    expect(serialized).toEqual({
      name: "Error",
      message: GENERIC_PRODUCTION_ERROR_MESSAGE,
      errorCode: "req-1",
    });
    expect(
      hydrationErrorPageProps(
        { error: new Error("x"), status: 500 } as never,
        undefined,
        "r",
        debug,
      ),
    ).not.toHaveProperty("debug");
  });

  it("treats an unknown NODE_ENV as production", () => {
    process.env.NODE_ENV = "staging";

    const serialized = serializePageError(new Error("db down"));

    expect(discloseErrorDetails()).toBe(false);
    expect(serialized.message).toBe(GENERIC_PRODUCTION_ERROR_MESSAGE);
    expect(serialized).not.toHaveProperty("stack");
  });

  it("keeps full details in development and test", () => {
    process.env.NODE_ENV = "development";
    expect(discloseErrorDetails()).toBe(true);
    expect(serializePageError(new Error("db down")).message).toBe("db down");

    process.env.NODE_ENV = "test";
    expect(discloseErrorDetails()).toBe(true);
    expect(
      hydrationErrorPageProps(
        { error: new Error("x"), status: 500 } as never,
        undefined,
        "r",
        debug,
      ),
    ).toHaveProperty("debug");
  });
});
