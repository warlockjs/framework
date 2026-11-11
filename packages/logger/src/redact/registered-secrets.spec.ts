import { describe, expect, it, vi } from "vitest";
import { LogChannel } from "../log-channel";
import { Logger } from "../logger";
import type { LoggingData } from "../types";
import { applyRedact } from "./redact";
import {
  maskRegisteredLogSecrets,
  redactRegisteredSecrets,
  registerLogSecret,
} from "./registered-secrets";

class Capture extends LogChannel {
  public name = "capture";
  public received: LoggingData[] = [];
  public log(data: LoggingData): void {
    this.received.push(data);
  }
}

function entry(message: unknown, context?: Record<string, unknown>): LoggingData {
  return { type: "info", module: "sample", action: "mask", message, context };
}

describe("registered credentials", () => {
  it("masks literal substrings with regex punctuation, longest matches first", () => {
    registerLogSecret("reg-secret.[x]+$");
    registerLogSecret("reg-secret.[x]+$-longer");
    expect(maskRegisteredLogSecrets("reg-secret.[x]+$-longer and reg-secret.[x]+$")).toBe(
      "[REDACTED] and [REDACTED]",
    );
    registerLogSecret("");
    expect(maskRegisteredLogSecrets("ordinary text")).toBe("ordinary text");
  });

  it("accepts large literal credentials without compiling them into an error-prone regex", () => {
    const credential = "large-credential-".repeat(8192);
    registerLogSecret(credential);
    expect(maskRegisteredLogSecrets(`using ${credential}`)).toBe("using [REDACTED]");
  });

  it("masks normalized keys and values even with defaults off and permissive censors", () => {
    registerLogSecret("registered-credential-one", ["vendorPrivateRef"]);
    const original = entry("using registered-credential-one", { "VENDOR-PRIVATE-REF": "unseen" });
    const masked = applyRedact(original, { defaultKeys: false, censor: (value: unknown) => value });
    expect(masked.message).toBe("using [REDACTED]");
    expect(masked.context).toEqual({ "VENDOR-PRIVATE-REF": "[REDACTED]" });
    expect(original.message).toBe("using registered-credential-one");
  });

  it("protects errors, causes, arrays, maps, sets, property names and circular objects", () => {
    registerLogSecret("registered-credential-two");
    const cause = new Error("cause registered-credential-two");
    const failure = new Error("message registered-credential-two", { cause });
    const context: Record<string, unknown> = {
      array: ["registered-credential-two"],
      map: new Map([["label", "registered-credential-two"]]),
      set: new Set(["registered-credential-two"]),
      "registered-credential-two": "label",
    };
    context.self = context;
    const masked = applyRedact(entry(failure, context), { defaultKeys: false });
    expect(masked.message).toBeInstanceOf(Error);
    expect(masked.message.message).toBe("message [REDACTED]");
    expect(masked.message.stack).not.toContain("registered-credential-two");
    expect(masked.message.cause.message).toBe("cause [REDACTED]");
    expect(masked.context?.array).toEqual(["[REDACTED]"]);
    expect(masked.context?.map).toEqual(new Map([["label", "[REDACTED]"]]));
    expect(masked.context?.set).toEqual(new Set(["[REDACTED]"]));
    expect(masked.context?.self).toBe(masked.context);
    expect(masked.context?.["[REDACTED]"]).toBe("label");
    expect(context.array).toEqual(["registered-credential-two"]);
  });

  it("does not invoke serializers/getters and masks opaque buffers", () => {
    registerLogSecret("registered-credential-three");
    const toJSON = vi.fn(() => "registered-credential-three");
    const getter = vi.fn(() => "registered-credential-three");
    const object = { toJSON };
    Object.defineProperty(object, "hidden", { get: getter, enumerable: true });
    const masked = applyRedact(
      entry(object, { bytes: Buffer.from("registered-credential-three") }),
      { defaultKeys: false },
    );
    expect(masked.message).toEqual({ toJSON: "[REDACTED]", hidden: "[REDACTED]" });
    expect(masked.context?.bytes).toBe("[REDACTED]");
    expect(toJSON).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it("protects every logger/channel, including channel censors and failure handlers", () => {
    registerLogSecret("registered-credential-four");
    const first = new Capture();
    const second = new Capture({
      redact: { paths: ["message"], censor: () => "registered-credential-four" },
    });
    const logger = new Logger().setChannels([first, second]).setRedact({ defaultKeys: false });
    logger.log(entry("registered-credential-four"));
    expect(first.received[0]?.message).toBe("[REDACTED]");
    expect(second.received[0]?.message).toBe("[REDACTED]");
    const handler = vi.fn();
    logger.onChannelError(handler);
    vi.spyOn(first, "log").mockImplementation(() => {
      throw new Error("registered-credential-four");
    });
    logger.log(entry("registered-credential-four"));
    const error: unknown = handler.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) expect(error.message).toBe("[REDACTED]");
  });

  it("masks the default stderr diagnostic too", () => {
    registerLogSecret("registered-credential-five");
    const channel = new Capture();
    channel.name = "registered-credential-five";
    vi.spyOn(channel, "log").mockImplementation(() => {
      throw new Error("registered-credential-five");
    });
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      new Logger().setChannels([channel]).log(entry("safe"));
      expect(write).toHaveBeenCalled();
      expect(write.mock.calls[0]?.[0]).not.toContain("registered-credential-five");
    } finally {
      write.mockRestore();
    }
  });
});

describe("registered credentials: entries without a secret are not copied", () => {
  it("returns an entry holding no registered value or key by identity", () => {
    registerLogSecret("cow-registered-value", ["cowHiddenKey"]);
    const original = entry("plain message", {
      user: { id: 7, tags: ["a", "b"], profile: Object.create(null) as object },
      note: "nothing to hide",
    });

    expect(redactRegisteredSecrets(original)).toBe(original);
  });

  it("still masks an entry holding a registered value or key, without mutating the input", () => {
    registerLogSecret("cow-registered-value", ["cowHiddenKey"]);
    const original = entry("plain", { nested: { text: "has cow-registered-value inside" } });
    const masked = redactRegisteredSecrets(original);

    expect(masked).not.toBe(original);
    expect(masked.context?.nested.text).toBe("has [REDACTED] inside");
    expect(original.context?.nested.text).toBe("has cow-registered-value inside");

    const keyed = entry("plain", { list: [{ cowHiddenKey: "x" }] });

    expect(redactRegisteredSecrets(keyed).context?.list[0].cowHiddenKey).toBe("[REDACTED]");
  });

  it("still rebuilds functions, accessors and class instances as before", () => {
    registerLogSecret("cow-registered-value");

    class Account {
      public id = 1;
    }

    const withFunction = entry("x", { callback: () => 1 });
    const withAccessor = entry("x", {
      get lazy() {
        return "computed";
      },
    });
    const withInstance = entry("x", { account: new Account() });

    expect(redactRegisteredSecrets(withFunction).context?.callback).toBe("[REDACTED]");
    expect(redactRegisteredSecrets(withAccessor).context?.lazy).toBe("[REDACTED]");
    expect(redactRegisteredSecrets(withInstance).context?.account).not.toBeInstanceOf(Account);
  });

  it("leaves strings without a secret as they are in one pass", () => {
    registerLogSecret("cow-registered-value");
    const text = "an ordinary line of text";

    expect(maskRegisteredLogSecrets(text)).toBe(text);
  });
});
