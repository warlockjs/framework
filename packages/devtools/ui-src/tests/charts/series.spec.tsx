import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assignSeriesSlots,
  EMPTY_SLOTS,
  OTHER_COLOR,
  SERIES_STORAGE_KEY,
  seriesStorageKey,
  useSeriesColors,
} from "@/components/charts";

beforeEach(() => sessionStorage.clear());

describe("assignSeriesSlots", () => {
  it("gives new keys the next free slot and keeps known ones", () => {
    const first = assignSeriesSlots(EMPTY_SLOTS, ["a", "b", "c"]);

    expect(first.slots).toEqual({ a: 1, b: 2, c: 3 });

    // A filter drops "a" and adds "d": survivors keep their colour.
    const second = assignSeriesSlots(first, ["b", "c", "d"]);

    expect(second.slots).toMatchObject({ b: 2, c: 3, d: 4 });
    expect(second.slots.a).toBe(1);
  });

  it("evicts the least recently shown key when all six slots are taken", () => {
    let state = assignSeriesSlots(EMPTY_SLOTS, ["a", "b", "c", "d", "e", "f"]);

    state = assignSeriesSlots(state, ["b", "c", "d", "e", "f"]);
    state = assignSeriesSlots(state, ["g"]);

    // "a" was the least recently shown, so "g" takes its slot.
    expect(state.slots.g).toBe(1);
    expect(state.slots.a).toBeUndefined();
    expect(state.slots.b).toBe(2);
  });
});

describe("useSeriesColors", () => {
  it("keeps a key's colour across key changes and remembers it in sessionStorage", () => {
    const { result, rerender } = renderHook(({ keys }) => useSeriesColors(keys), {
      initialProps: { keys: ["x", "y"] },
    });

    expect(result.current("x")).toBe("var(--series-1)");
    expect(result.current("y")).toBe("var(--series-2)");

    rerender({ keys: ["y", "z"] });

    expect(result.current("y")).toBe("var(--series-2)");
    expect(result.current("z")).toBe("var(--series-3)");
    expect(JSON.parse(sessionStorage.getItem(SERIES_STORAGE_KEY) ?? "{}").slots.y).toBe(2);
  });

  it("keeps error categories in their own pool, so they never repaint the models", () => {
    const models = renderHook(() => useSeriesColors(["openai/a", "openai/b"]));

    expect(models.result.current("openai/b")).toBe("var(--series-2)");

    // Six categories would fill every slot of a shared pool and evict the models.
    renderHook(() =>
      useSeriesColors(["rate-limit", "timeout", "refusal", "provider", "tool", "schema"], "errors"),
    );

    const again = renderHook(() => useSeriesColors(["openai/b", "openai/c"]));

    expect(again.result.current("openai/b")).toBe("var(--series-2)");
    expect(again.result.current("openai/c")).toBe("var(--series-3)");
    expect(
      JSON.parse(sessionStorage.getItem(seriesStorageKey("errors")) ?? "{}").slots.timeout,
    ).toBe(2);
    expect(seriesStorageKey("models")).toBe(SERIES_STORAGE_KEY);
  });

  it("still works when storage throws", () => {
    const original = Storage.prototype.getItem;

    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };

    try {
      const { result } = renderHook(() => useSeriesColors(["x"]));

      expect(result.current("x")).toBe("var(--series-1)");
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it("the Other gray is its own token", () => {
    expect(OTHER_COLOR).toBe("var(--series-other)");
  });
});
