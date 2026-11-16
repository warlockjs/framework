import { describe, expect, it } from "vitest";
import { command } from "./cli-command";
import {
  explainersOf,
  explainRegisteredCode,
  withExplainCodes,
  type ExplainableCode,
} from "./explain-codes";

const answer = (code: string, title: string): ExplainableCode => ({
  code,
  title,
  area: "links",
  fix: "Fix it.",
  skill: "skill",
  docs: "https://example.com",
});

describe("withExplainCodes", () => {
  it("returns the same command and appends explainers", () => {
    const cmd = command({ name: "a", action: () => undefined });
    const first = () => undefined;
    const second = () => undefined;

    expect(withExplainCodes(cmd, first)).toBe(cmd);
    withExplainCodes(cmd, second);

    expect(explainersOf(cmd)).toEqual([first, second]);
    expect(Object.keys(cmd)).not.toContain(String(Symbol.for("warlock.explain.codes")));
  });

  it("returns no explainers for other values", () => {
    expect(explainersOf(null)).toEqual([]);
    expect(explainersOf(command({ name: "b", action: () => undefined }))).toEqual([]);
  });
});

describe("explainRegisteredCode", () => {
  const a = withExplainCodes(command({ name: "a", action: () => undefined }), (code) =>
    code === "GR2001" ? answer(code, "from a") : undefined,
  );
  const b = withExplainCodes(command({ name: "b", action: () => undefined }), (code) =>
    code === "GR2001" || code === "GR2002" ? answer(code, "from b") : undefined,
  );

  it("searches nested arrays and the first answer wins", () => {
    expect(explainRegisteredCode([[a, b]], "GR2001")?.title).toBe("from a");
    expect(explainRegisteredCode([a, [b]], "GR2002")?.title).toBe("from b");
  });

  it("returns undefined for an unknown code or no entries", () => {
    expect(explainRegisteredCode([[a, b]], "GR9999")).toBeUndefined();
    expect(explainRegisteredCode(undefined, "GR2001")).toBeUndefined();
  });
});
