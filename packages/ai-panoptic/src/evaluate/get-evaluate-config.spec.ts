import { setAIConfig } from "@warlock.js/ai";
import { afterEach, describe, expect, it } from "vitest";
import "../config/panoptic-config.type";
import type { EvaluateConfig } from "./evaluate.type";
import { getEvaluateConfig } from "./get-evaluate-config";

const judge = { judge: {} } as unknown as EvaluateConfig;
const other = { judge: { other: true } } as unknown as EvaluateConfig;

afterEach(() => {
  setAIConfig({ panoptic: undefined });
});

describe("getEvaluateConfig", () => {
  it("is undefined without a panoptic config", () => {
    expect(getEvaluateConfig()).toBeUndefined();
  });

  it("reads panoptic.evaluate", () => {
    setAIConfig({ panoptic: { evaluate: judge } });

    expect(getEvaluateConfig()).toBe(judge);
  });

  it("falls back to panoptic.dashboard.evaluate", () => {
    setAIConfig({ panoptic: { dashboard: { evaluate: other } } });

    expect(getEvaluateConfig()).toBe(other);
  });

  it("prefers panoptic.evaluate over the dashboard's", () => {
    setAIConfig({ panoptic: { evaluate: judge, dashboard: { evaluate: other } } });

    expect(getEvaluateConfig()).toBe(judge);
  });

  it("is undefined when dashboard is just true", () => {
    setAIConfig({ panoptic: { dashboard: true } });

    expect(getEvaluateConfig()).toBeUndefined();
  });
});
