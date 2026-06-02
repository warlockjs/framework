import { describe, expect, it, vi } from "vitest";
import { measure } from "../../../src/benchmark";

/**
 * `measure()` is self-contained — it only reads the optional `benchmark`
 * config key (absent here, handled gracefully), so these tests run without
 * the framework bootstrap. Results are a discriminated union narrowed on the
 * `success` flag (there are no `isSuccessResult` / `isErrorResult` helpers).
 */
describe("Benchmark Module - measure()", () => {
  // ---------------------------------------------------------------------------
  // Core: value and timing
  // ---------------------------------------------------------------------------

  it("returns value from measured function", async () => {
    const result = await measure("test", async () => "test-value");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("test-value");
    }
    expect(result.latency).toBeTypeOf("number");
    expect(result.state).toBeTypeOf("string");
  });

  it("returns latency in milliseconds", async () => {
    const result = await measure("test", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "done";
    });

    expect(result.latency).toBeGreaterThanOrEqual(50);
  });

  it("works with async functions", async () => {
    const result = await measure("test", async () => {
      const value = await Promise.resolve(42);
      return value * 2;
    });

    if (result.success) {
      expect(result.value).toBe(84);
    }
  });

  it("works with sync functions", async () => {
    const result = await measure("test", () => 123);

    if (result.success) {
      expect(result.value).toBe(123);
    }
  });

  it("works standalone without use case", async () => {
    const result = await measure("standalone-operation", async () => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      return sum;
    });

    if (result.success) {
      expect(result.value).toBe(499500);
    }
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------------------------------
  // Latency classification (excellent / good / poor)
  // ---------------------------------------------------------------------------

  it("classifies as excellent when below excellent threshold", async () => {
    const result = await measure(
      "test",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "done";
      },
      { latencyRange: { excellent: 100, poor: 500 } },
    );

    expect(result.state).toBe("excellent");
  });

  it("classifies as poor when above poor threshold", async () => {
    const result = await measure(
      "test",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return "done";
      },
      { latencyRange: { excellent: 100, poor: 500 } },
    );

    expect(result.state).toBe("poor");
  });

  it("classifies as good when between thresholds", async () => {
    const result = await measure(
      "test",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "done";
      },
      { latencyRange: { excellent: 100, poor: 500 } },
    );

    expect(result.state).toBe("good");
  });

  // ---------------------------------------------------------------------------
  // enabled: false — zeroed passthrough, no hooks fire
  // ---------------------------------------------------------------------------

  it("returns zeroed SuccessResult when enabled is false", async () => {
    const onFinish = vi.fn();
    const result = await measure("test", () => "bypassed", {
      enabled: false,
      onFinish,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe("bypassed");
    }
    expect(result.latency).toBe(0);
    expect(result.state).toBe("excellent");
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("re-throws when enabled is false and fn() throws", async () => {
    await expect(
      measure(
        "test",
        () => {
          throw new Error("passthrough-error");
        },
        { enabled: false },
      ),
    ).rejects.toThrow("passthrough-error");
  });

  // ---------------------------------------------------------------------------
  // Discriminant: success field
  // ---------------------------------------------------------------------------

  it("success result has success: true", async () => {
    const result = await measure("test", () => 1);
    expect(result.success).toBe(true);
  });

  it("error result has success: false", async () => {
    const result = await measure("test", () => {
      throw new Error("boom");
    });

    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Error path: timing, state, and error coercion
  // ---------------------------------------------------------------------------

  it("error result captures latency", async () => {
    const result = await measure("test", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error("timed-out");
    });

    expect(result.latency).toBeGreaterThanOrEqual(50);
  });

  it("non-Error thrown values are coerced to Error", async () => {
    const result = await measure("test", () => {
      throw "plain string error";
    });

    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe("plain string error");
    }
  });

  it("re-throws when shouldBenchmarkError returns false", async () => {
    await expect(
      measure(
        "test",
        () => {
          throw new Error("business-logic");
        },
        { shouldBenchmarkError: () => false },
      ),
    ).rejects.toThrow("business-logic");
  });

  // ---------------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------------

  it("onComplete fires on success with correct result", async () => {
    const onComplete = vi.fn();

    const result = await measure("hook-test", () => "value", { onComplete });

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(result);
    if (result.success) {
      expect(result.value).toBe("value");
    }
  });

  it("onComplete does NOT fire on error", async () => {
    const onComplete = vi.fn();

    await measure(
      "hook-test",
      () => {
        throw new Error("fail");
      },
      { onComplete },
    );

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("onError fires on benchmarked error with correct result", async () => {
    const onError = vi.fn();

    const result = await measure(
      "hook-test",
      () => {
        throw new Error("crash");
      },
      { onError },
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(result);
    expect(result.success).toBe(false);
  });

  it("onError does NOT fire on success", async () => {
    const onError = vi.fn();

    await measure("hook-test", () => "ok", { onError });

    expect(onError).not.toHaveBeenCalled();
  });

  it("onFinish fires on success after onComplete", async () => {
    const callOrder: string[] = [];
    const onComplete = vi.fn(() => callOrder.push("onComplete"));
    const onFinish = vi.fn(() => callOrder.push("onFinish"));

    await measure("hook-test", () => "ok", { onComplete, onFinish });

    expect(onFinish).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(["onComplete", "onFinish"]);
  });

  it("onFinish fires on error after onError", async () => {
    const callOrder: string[] = [];
    const onError = vi.fn(() => callOrder.push("onError"));
    const onFinish = vi.fn(() => callOrder.push("onFinish"));

    await measure(
      "hook-test",
      () => {
        throw new Error("crash");
      },
      { onError, onFinish },
    );

    expect(onFinish).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(["onError", "onFinish"]);
  });

  // ---------------------------------------------------------------------------
  // Discriminant narrowing
  // ---------------------------------------------------------------------------

  it("narrows to the success branch when success is true", async () => {
    const result = await measure("guard-test", () => 42);

    if (result.success) {
      expect(result.value).toBe(42);
    } else {
      throw new Error("Expected success result");
    }
  });

  it("narrows to the error branch when success is false", async () => {
    const result = await measure("guard-test", () => {
      throw new Error("guard-error");
    });

    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
    } else {
      throw new Error("Expected error result");
    }
  });
});
