import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggingData } from "../types";
import { SentryLog, type SentryForwarder, type SentryLogConfig } from "./sentry-log";

type FakeScope = {
  setLevel: ReturnType<typeof vi.fn>;
  setTags: ReturnType<typeof vi.fn>;
  setContext: ReturnType<typeof vi.fn>;
};

function createFakeSentry() {
  const scope: FakeScope = {
    setLevel: vi.fn(),
    setTags: vi.fn(),
    setContext: vi.fn(),
  };

  const forwarder = {
    captureException: vi.fn((): string => "event-id"),
    captureMessage: vi.fn((): string => "event-id"),
    addBreadcrumb: vi.fn(),
    withScope: vi.fn((callback: (scope: FakeScope) => void) => callback(scope)),
    flush: vi.fn(async (): Promise<boolean> => true),
  };

  return { forwarder, scope };
}

function createChannel(
  fake: ReturnType<typeof createFakeSentry>,
  config: Partial<SentryLogConfig> = {},
): SentryLog {
  return new SentryLog({
    client: fake.forwarder as unknown as SentryForwarder,
    ...config,
  });
}

async function waitForInit(channel: SentryLog) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((channel as unknown as { isInitialized: boolean }).isInitialized) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function dataFor(overrides: Partial<LoggingData> = {}): LoggingData {
  return {
    type: "info",
    module: "mod",
    action: "act",
    message: "hello",
    ...overrides,
  };
}

describe("SentryLog", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("identity", () => {
    it("is named 'sentry' and non-terminal", () => {
      const channel = createChannel(createFakeSentry());

      expect(channel.name).toBe("sentry");
      expect(channel.terminal).toBe(false);
    });
  });

  describe("event vs breadcrumb mapping", () => {
    it("sends an Error at error level via captureException with module/action tags", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      const error = new Error("boom");
      await channel.log(
        dataFor({ type: "error", module: "billing", action: "charge", message: error }),
      );

      expect(fake.forwarder.captureException).toHaveBeenCalledWith(error);
      expect(fake.forwarder.captureMessage).not.toHaveBeenCalled();
      expect(fake.scope.setLevel).toHaveBeenCalledWith("error");
      expect(fake.scope.setTags).toHaveBeenCalledWith({ module: "billing", action: "charge" });
    });

    it("sends a string error via captureMessage at error level", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.log(dataFor({ type: "error", message: "string failure" }));

      expect(fake.forwarder.captureMessage).toHaveBeenCalledWith("string failure", "error");
      expect(fake.forwarder.captureException).not.toHaveBeenCalled();
    });

    it("maps warn to a 'warning' event", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.log(dataFor({ type: "warn", message: "watch out" }));

      expect(fake.forwarder.captureMessage).toHaveBeenCalledWith("watch out", "warning");
    });

    it("records info as a breadcrumb, not an event", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.log(dataFor({ type: "info", module: "auth", message: "logged in" }));

      expect(fake.forwarder.addBreadcrumb).toHaveBeenCalledWith({
        category: "auth",
        message: "logged in",
        level: "info",
        data: undefined,
      });
      expect(fake.forwarder.captureMessage).not.toHaveBeenCalled();
      expect(fake.forwarder.captureException).not.toHaveBeenCalled();
    });

    it("records debug as a breadcrumb at debug level", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.log(dataFor({ type: "debug", message: "trace" }));

      expect(fake.forwarder.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ level: "debug" }),
      );
    });

    it("maps success to an info-level breadcrumb", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.log(dataFor({ type: "success", message: "done" }));

      expect(fake.forwarder.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ level: "info" }),
      );
    });

    it("attaches context as a structured Sentry context on events", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.log(dataFor({ type: "error", message: "x", context: { userId: 7 } }));

      expect(fake.scope.setContext).toHaveBeenCalledWith("context", { userId: 7 });
    });

    it("passes context as breadcrumb data", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.log(dataFor({ type: "info", message: "x", context: { traceId: "abc" } }));

      expect(fake.forwarder.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ data: { traceId: "abc" } }),
      );
    });

    it("serializes a non-string, non-Error message before sending", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.log(dataFor({ type: "error", message: { code: 42 } as unknown as string }));

      expect(fake.forwarder.captureMessage).toHaveBeenCalledWith('{"code":42}', "error");
    });
  });

  describe("eventLevels config", () => {
    it("respects a custom eventLevels list (warn becomes a breadcrumb)", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake, { eventLevels: ["error"] });

      await waitForInit(channel);

      await channel.log(dataFor({ type: "warn", message: "demoted" }));

      expect(fake.forwarder.addBreadcrumb).toHaveBeenCalled();
      expect(fake.forwarder.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe("filtering", () => {
    it("honors the levels filter", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake, { levels: ["error"] });

      await waitForInit(channel);

      await channel.log(dataFor({ type: "info", message: "skipped" }));

      expect(fake.forwarder.addBreadcrumb).not.toHaveBeenCalled();
      expect(fake.forwarder.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe("flush", () => {
    it("drains Sentry with the configured timeout", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake, { flushTimeout: 1234 });

      await waitForInit(channel);

      await channel.flush();

      expect(fake.forwarder.flush).toHaveBeenCalledWith(1234);
    });

    it("defaults the flush timeout to 2000ms", async () => {
      const fake = createFakeSentry();
      const channel = createChannel(fake);

      await waitForInit(channel);

      await channel.flush();

      expect(fake.forwarder.flush).toHaveBeenCalledWith(2000);
    });
  });
});
