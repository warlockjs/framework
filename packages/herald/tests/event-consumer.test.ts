import { describe, expect, it } from "vitest";
import { EventConsumer } from "../src/message-managers/event-consumer";

describe("EventConsumer.isAcceptedVersion", () => {
  it("accepts any version when no bounds are set", () => {
    class Open extends EventConsumer {
      public static eventName = "open";
      public async handle() {}
    }

    expect(Open.isAcceptedVersion(1)).toBe(true);
    expect(Open.isAcceptedVersion(99)).toBe(true);
  });

  it("rejects versions below minVersion", () => {
    class MinBound extends EventConsumer {
      public static eventName = "min";
      public static minVersion = 2;
      public async handle() {}
    }

    expect(MinBound.isAcceptedVersion(1)).toBe(false);
    expect(MinBound.isAcceptedVersion(2)).toBe(true);
    expect(MinBound.isAcceptedVersion(3)).toBe(true);
  });

  it("rejects versions above maxVersion", () => {
    class MaxBound extends EventConsumer {
      public static eventName = "max";
      public static maxVersion = 3;
      public async handle() {}
    }

    expect(MaxBound.isAcceptedVersion(3)).toBe(true);
    expect(MaxBound.isAcceptedVersion(4)).toBe(false);
  });

  it("enforces a closed range when both bounds are set", () => {
    class RangeBound extends EventConsumer {
      public static eventName = "range";
      public static minVersion = 2;
      public static maxVersion = 4;
      public async handle() {}
    }

    expect(RangeBound.isAcceptedVersion(1)).toBe(false);
    expect(RangeBound.isAcceptedVersion(2)).toBe(true);
    expect(RangeBound.isAcceptedVersion(4)).toBe(true);
    expect(RangeBound.isAcceptedVersion(5)).toBe(false);
  });

  it("derives a stable consumerId per class", () => {
    class StableId extends EventConsumer {
      public static eventName = "stable";
      public async handle() {}
    }

    const first = StableId.consumerId;
    const second = StableId.consumerId;

    expect(first).toBe(second);
    expect(typeof first).toBe("string");
  });
});
