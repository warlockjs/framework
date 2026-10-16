import { beforeEach, describe, expect, it, vi } from "vitest";
import { features, getFeatureGroups } from "../src/features/features-map";
import { askFeatures } from "../src/prompts/ask-features";
import { summarizeFeatures } from "../src/summary";

const { select, multiselect } = vi.hoisted(() => ({
  select: vi.fn(),
  multiselect: vi.fn(),
}));
const CANCEL = Symbol("cancel");
vi.mock("@clack/prompts", () => ({
  select,
  multiselect,
  isCancel: (value: unknown) => value === CANCEL,
}));

beforeEach(() => {
  select.mockReset();
  multiselect.mockReset();
});

describe("grouped feature selection", () => {
  it("offers every feature exactly once in its section", () => {
    const groups = getFeatureGroups();
    expect(
      groups.flatMap(group => group.options.map(option => option.value)),
    ).toEqual(features.map(feature => feature.key));
    expect(groups.every(group => group.options.length > 0)).toBe(true);
  });

  it("selects every member of a group without leaking action values", async () => {
    select
      .mockResolvedValueOnce("Auth & Access")
      .mockResolvedValueOnce("@continue");
    multiselect.mockResolvedValueOnce(["@all"]);
    const result = await askFeatures(["test"]);
    expect(result).toEqual(["test", "access", "auth-google", "auth-passkeys"]);
    expect(select.mock.calls[1][0].options[0].label).toBe(
      "Auth & Access (3/3)",
    );
  });

  it("honors explicit unticks while selecting the remaining group members", async () => {
    select.mockResolvedValueOnce("Auth & Access").mockResolvedValueOnce("@continue");
    multiselect.mockResolvedValueOnce(["@all"]);
    expect(await askFeatures(["access", "test"])).toEqual([
      "test", "auth-google", "auth-passkeys",
    ]);
    expect(select.mock.calls[1][0].initialValue).toBe("Auth & Access");
  });

  it("keeps seeds, supports revisiting a group, and permits clearing it", async () => {
    select
      .mockResolvedValueOnce("Storage & Cache")
      .mockResolvedValueOnce("Storage & Cache")
      .mockResolvedValueOnce("@continue");
    multiselect
      .mockResolvedValueOnce(["s3", "redis"])
      .mockResolvedValueOnce([]);
    expect(await askFeatures(["web", "redis", "ai-openai"])).toEqual([
      "web",
      "ai-openai",
    ]);
    expect(multiselect.mock.calls[0][0].initialValues).toEqual(["redis"]);
    expect(multiselect.mock.calls[1][0].initialValues).toEqual(["s3", "redis"]);
    expect(
      select.mock.calls[2][0].options.find(
        option => option.value === "Storage & Cache",
      ).label,
    ).toBe("Storage & Cache (0/2)");
  });

  it("continues with defaults without forcing every group open", async () => {
    select.mockResolvedValueOnce("@continue");
    expect(await askFeatures(["react", "web"])).toEqual(["react", "web"]);
    expect(multiselect).not.toHaveBeenCalled();
  });

  it.each(["menu", "checklist"])(
    "propagates cancellation from the %s",
    async stage => {
      select.mockResolvedValueOnce(stage === "menu" ? CANCEL : "Tooling");
      multiselect.mockResolvedValueOnce(CANCEL);
      expect(await askFeatures([])).toBe(CANCEL);
    },
  );

  it("pages both levels and fits their feature hints", async () => {
    select
      .mockResolvedValueOnce("Rendering & Mail")
      .mockResolvedValueOnce("@continue");
    multiselect.mockResolvedValueOnce([]);
    await askFeatures([]);
    for (const prompt of [
      select.mock.calls[0][0],
      multiselect.mock.calls[0][0],
    ]) {
      expect(prompt.maxItems).toBeGreaterThan(0);
      for (const option of prompt.options) {
        expect(
          5 + option.label.length + (option.hint ? option.hint.length + 3 : 0),
        ).toBeLessThan(80);
      }
    }
  });
});

describe("compact feature summary", () => {
  it("shows none and deduplicates feature/AI keys", () => {
    expect(summarizeFeatures([])).toBe("Features: none");
    expect(summarizeFeatures(["test", "test", "ai-openai"])).toBe(
      "Features (2): test, ai-openai",
    );
  });
  it("bounds a long preview while showing the full count", () => {
    expect(
      summarizeFeatures(
        Array.from({ length: 9 }, (_, index) => `feature-${index}`),
      ),
    ).toBe(
      "Features (9): feature-0, feature-1, feature-2, feature-3, feature-4, feature-5, +3 more",
    );
  });
});
