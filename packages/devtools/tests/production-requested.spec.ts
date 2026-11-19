import { afterEach, describe, expect, it } from "vitest";
import { devtoolsConnector, DEVTOOLS_PRODUCTION_REQUESTED } from "../src/devtools-connector";

const slot = () => (globalThis as Record<symbol, unknown>)[DEVTOOLS_PRODUCTION_REQUESTED];

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[DEVTOOLS_PRODUCTION_REQUESTED];
});

describe("devtoolsConnector production flag for core", () => {
  it("leaves the slot unset without production options", () => {
    devtoolsConnector();
    devtoolsConnector({ production: { enabled: false } });

    expect(slot()).toBeUndefined();
  });

  it("sets the slot core reads when production is enabled in the options", () => {
    devtoolsConnector({ production: { enabled: true } });

    expect(slot()).toBe(true);
  });
});
