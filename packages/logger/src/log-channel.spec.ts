import { describe, expect, it } from "vitest";
import { LogChannel } from "./log-channel";
import type { BasicLogConfigurations, LoggingData } from "./types";

type TestConfig = BasicLogConfigurations & { extra?: string };

class TestChannel extends LogChannel<TestConfig> {
  public name = "test";
  public defaultsUsed: TestConfig;

  public constructor(config?: TestConfig, defaults: TestConfig = {}) {
    super(config);
    this.defaultsUsed = defaults;
    (this as unknown as { defaultConfigurations: TestConfig }).defaultConfigurations = defaults;
  }

  public log(_data: LoggingData) {}

  public exposeConfig<K extends keyof TestConfig>(key: K): TestConfig[K] {
    return (this as unknown as { config: (key: K) => TestConfig[K] }).config(key);
  }

  public exposeShouldBeLogged(data: LoggingData): boolean {
    return (this as unknown as { shouldBeLogged: (data: LoggingData) => boolean }).shouldBeLogged(data);
  }

  public exposeSetConfigurations(config: TestConfig) {
    return (this as unknown as { setConfigurations: (config: TestConfig) => TestChannel }).setConfigurations(config);
  }

  public exposeGetDateAndTimeFormat() {
    return (this as unknown as {
      getDateAndTimeFormat: () => { date: string; time: string };
    }).getDateAndTimeFormat();
  }

  public exposeIsInitialized() {
    return (this as unknown as { isInitialized: boolean }).isInitialized;
  }
}

class InitChannel extends LogChannel {
  public name = "init-channel";
  public initCalled = 0;

  protected async init() {
    this.initCalled += 1;
  }

  public log(_data: LoggingData) {}

  public exposeIsInitialized() {
    return (this as unknown as { isInitialized: boolean }).isInitialized;
  }
}

const sampleData: LoggingData = {
  type: "info",
  module: "m",
  action: "a",
  message: "msg",
};

describe("LogChannel", () => {
  describe("config resolution", () => {
    it("returns channel config value when set", () => {
      const channel = new TestChannel({ levels: ["error"] });

      expect(channel.exposeConfig("levels")).toEqual(["error"]);
    });

    it("falls back to default configurations when channel config is missing", () => {
      const channel = new TestChannel(undefined, { levels: ["warn"] });

      expect(channel.exposeConfig("levels")).toEqual(["warn"]);
    });

    it("returns undefined when neither channel config nor defaults define the key", () => {
      const channel = new TestChannel();

      expect(channel.exposeConfig("levels")).toBeUndefined();
    });

    it("setConfigurations merges with existing channel config", () => {
      const channel = new TestChannel({ levels: ["info"] });

      channel.exposeSetConfigurations({ extra: "value" });

      expect(channel.exposeConfig("levels")).toEqual(["info"]);
      expect(channel.exposeConfig("extra")).toBe("value");
    });
  });

  describe("shouldBeLogged", () => {
    it("returns true when no levels restriction is set", () => {
      const channel = new TestChannel();

      expect(channel.exposeShouldBeLogged(sampleData)).toBe(true);
    });

    it("filters by levels array when set", () => {
      const channel = new TestChannel({ levels: ["error"] });

      expect(channel.exposeShouldBeLogged({ ...sampleData, type: "info" })).toBe(false);
      expect(channel.exposeShouldBeLogged({ ...sampleData, type: "error" })).toBe(true);
    });

    it("returns false when custom filter returns false", () => {
      const channel = new TestChannel({ filter: () => false });

      expect(channel.exposeShouldBeLogged(sampleData)).toBe(false);
    });

    it("returns true when both levels and custom filter allow the message", () => {
      const channel = new TestChannel({
        levels: ["info"],
        filter: () => true,
      });

      expect(channel.exposeShouldBeLogged(sampleData)).toBe(true);
    });

    it("passes the full logging data to the filter", () => {
      let captured: LoggingData | undefined;

      const channel = new TestChannel({
        filter: (data) => {
          captured = data;
          return true;
        },
      });

      channel.exposeShouldBeLogged(sampleData);

      expect(captured).toEqual(sampleData);
    });
  });

  describe("getDateAndTimeFormat", () => {
    it("returns default formats when not configured", () => {
      const channel = new TestChannel();

      expect(channel.exposeGetDateAndTimeFormat()).toEqual({
        date: "DD-MM-YYYY",
        time: "HH:mm:ss",
      });
    });

    it("honors custom dateFormat overrides", () => {
      const channel = new TestChannel({
        dateFormat: { date: "YYYY/MM/DD", time: "HH:mm" },
      });

      expect(channel.exposeGetDateAndTimeFormat()).toEqual({
        date: "YYYY/MM/DD",
        time: "HH:mm",
      });
    });

    it("falls back to default for missing format keys", () => {
      const channel = new TestChannel({
        dateFormat: { date: "YYYY/MM/DD" },
      });

      expect(channel.exposeGetDateAndTimeFormat()).toEqual({
        date: "YYYY/MM/DD",
        time: "HH:mm:ss",
      });
    });
  });

  describe("async initialization", () => {
    it("sets isInitialized to true after the async init hook", async () => {
      const channel = new InitChannel();

      expect(channel.exposeIsInitialized()).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(channel.exposeIsInitialized()).toBe(true);
      expect(channel.initCalled).toBe(1);
    });

    it("sets isInitialized even when no init method is defined", async () => {
      const channel = new TestChannel();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(channel.exposeIsInitialized()).toBe(true);
    });
  });
});
