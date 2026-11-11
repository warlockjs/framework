import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheDriver } from "./drivers/memory-cache-driver";
import { NullCacheDriver } from "./drivers/null-cache-driver";

/**
 * cache drivers log every key they touch, and an app key such as
 * `user.<email>` would put the address in the log. Logged keys are masked.
 */
function loggedText(): string {
  return [
    ...vi.mocked(log.info).mock.calls,
    ...vi.mocked(log.success).mock.calls,
    ...vi.mocked(log.warn).mock.calls,
  ]
    .map((call) => call.map(String).join(" "))
    .join("\n");
}

describe("cache key log privacy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function spyOnLog() {
    vi.spyOn(log, "info").mockImplementation(() => log);
    vi.spyOn(log, "success").mockImplementation(() => log);
    vi.spyOn(log, "warn").mockImplementation(() => log);
  }

  it("masks an email inside a key the memory driver logs", async () => {
    spyOnLog();
    const driver = new MemoryCacheDriver();
    driver.setOptions({});
    driver.setLoggingState(true);

    await driver.set("email.member@example.com", 1);
    await driver.get("email.member@example.com");
    await driver.get("missing.member@example.com");

    const text = loggedText();

    expect(text).toContain("***@example.com");
    expect(text).not.toContain("member@example.com");

    await driver.disconnect();
  });

  it("masks an email inside a key the null driver logs", async () => {
    spyOnLog();
    const driver = new NullCacheDriver();
    driver.setOptions({});
    driver.setLoggingState(true);

    await driver.set("email.member@example.com", 1);
    await driver.get("email.member@example.com");
    await driver.remove("email.member@example.com");

    expect(loggedText()).not.toContain("member@example.com");
  });

  it("masks addresses in error lines, which are written even with logging off", () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => log);

    class ExposedDriver extends MemoryCacheDriver {
      public fail(message: string, cause?: unknown) {
        this.logError(message, cause);
      }
    }

    const driver = new ExposedDriver();
    driver.setOptions({});
    driver.setLoggingState(false);

    driver.fail(
      "SWR background refresh failed for user.alice@example.com",
      new Error("refresh for user.alice@example.com timed out"),
    );

    const text = error.mock.calls.map((call) => JSON.stringify(call)).join("\n");

    expect(text).toContain("***@example.com");
    expect(text).not.toContain("alice@example.com");
  });

  it("masks the key in the non-numeric increment error", async () => {
    const driver = new MemoryCacheDriver();
    driver.setOptions({});
    driver.setLoggingState(false);

    await driver.set("user.alice@example.com", "not a number");

    const failure = await driver
      .increment("user.alice@example.com")
      .catch((caught: Error) => caught);

    expect(String((failure as Error).message)).not.toContain("alice@example.com");

    await driver.disconnect();
  });

  it("masks a namespace the null driver logs when clearing it", async () => {
    spyOnLog();
    const driver = new NullCacheDriver();
    driver.setOptions({});
    driver.setLoggingState(true);

    await driver.removeNamespace("user.alice@example.com");

    expect(loggedText()).not.toContain("alice@example.com");
  });

  it("still logs keys without an address unchanged", async () => {
    spyOnLog();
    const driver = new MemoryCacheDriver();
    driver.setOptions({});
    driver.setLoggingState(true);

    await driver.get("user.42.profile");

    expect(loggedText()).toContain("user.42.profile");

    await driver.disconnect();
  });
});

describe("cache operation logging default", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs no operation lines unless logging is turned on", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => log);
    const success = vi.spyOn(log, "success").mockImplementation(() => log);
    const memory = new MemoryCacheDriver();
    const nullDriver = new NullCacheDriver();

    memory.setOptions({});

    await memory.set("user.1", { id: 1 });
    await memory.get("user.1");
    await memory.get("missing");
    await memory.remove("user.1");
    await nullDriver.set("user.1", 1);
    await nullDriver.get("user.1");

    expect(info).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();

    await memory.disconnect();
  });

  it("logs the same operation lines as before once logging is on", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => log);
    const success = vi.spyOn(log, "success").mockImplementation(() => log);
    const driver = new MemoryCacheDriver();

    driver.setOptions({});
    driver.setLoggingState(true);

    await driver.set("user.1", 1);
    await driver.get("user.1");

    expect(info).toHaveBeenCalledWith("cache.memory", "caching", "user.1 Caching key");
    expect(success).toHaveBeenCalledWith("cache.memory", "fetched", "user.1 Key fetched");

    await driver.disconnect();
  });

  it("always logs a connection failure", () => {
    const fatal = vi.spyOn(log, "fatal").mockImplementation(() => log);
    const success = vi.spyOn(log, "success").mockImplementation(() => log);

    class FailingDriver extends MemoryCacheDriver {
      public fail() {
        this.log("connectionFailed", "redis://cache");
      }
    }

    const driver = new FailingDriver();

    driver.setOptions({});
    driver.fail();

    expect(fatal).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });
});
