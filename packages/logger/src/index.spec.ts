import { describe, expect, it } from "vitest";
import * as loggerPackage from "./index";

describe("package exports", () => {
  it("exposes the Logger class", () => {
    expect(typeof loggerPackage.Logger).toBe("function");
  });

  it("exposes the LogChannel abstract class", () => {
    expect(typeof loggerPackage.LogChannel).toBe("function");
  });

  it("exposes the built-in channel classes", () => {
    expect(typeof loggerPackage.ConsoleLog).toBe("function");
    expect(typeof loggerPackage.FileLog).toBe("function");
    expect(typeof loggerPackage.JSONFileLog).toBe("function");
  });

  it("exposes the singleton log instance", () => {
    expect(loggerPackage.log).toBeInstanceOf(loggerPackage.Logger);
  });

  it("exposes every level shortcut and configuration method on the singleton", () => {
    expect(typeof loggerPackage.log.info).toBe("function");
    expect(typeof loggerPackage.log.debug).toBe("function");
    expect(typeof loggerPackage.log.warn).toBe("function");
    expect(typeof loggerPackage.log.error).toBe("function");
    expect(typeof loggerPackage.log.success).toBe("function");
    expect(typeof loggerPackage.log.channel).toBe("function");
    expect(typeof loggerPackage.log.flushSync).toBe("function");
    expect(typeof loggerPackage.log.enableAutoFlush).toBe("function");
    expect(typeof loggerPackage.log.disableAutoFlush).toBe("function");
    expect(typeof loggerPackage.log.setMinLevel).toBe("function");
    expect(typeof loggerPackage.log.setRedact).toBe("function");
    expect(typeof loggerPackage.log.assert).toBe("function");
    expect(typeof loggerPackage.log.timer).toBe("function");
  });

  it("does not export a `logger` alias (collapsed to `log`)", () => {
    expect((loggerPackage as any).logger).toBeUndefined();
  });

  it("exposes clearMessage utility", () => {
    expect(typeof loggerPackage.clearMessage).toBe("function");
  });

  it("exposes captureAnyUnhandledRejection utility", () => {
    expect(typeof loggerPackage.captureAnyUnhandledRejection).toBe("function");
  });
});
