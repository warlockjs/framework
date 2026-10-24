import { log as loggerLog } from "@warlock.js/logger";
import { describe, expect, it } from "vitest";
import { log } from "./index";

describe("logger barrel", () => {
  it("re-exports the shared log instance, so framework packages write to the app's channels", () => {
    expect(log).toBe(loggerLog);
  });
});
