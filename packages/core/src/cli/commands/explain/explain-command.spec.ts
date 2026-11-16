import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootForInspect = vi.fn();
const config = { isLoaded: true, load: vi.fn(), get: vi.fn() };

vi.mock("../../../tooling/inspect/boot-for-inspect", () => ({
  bootForInspect,
  inspectOptionsFromBoot: vi.fn(),
}));
vi.mock("../../../warlock-config/warlock-config.manager", () => ({ warlockConfigManager: config }));

const { command } = await import("../../../commands/cli-command");
const { withExplainCodes } = await import("../../../commands/explain-codes");
const { explainCommand } = await import("../explain.command");
const { explainCommandAction, formatRegisteredExplanation } =
  await import("./explain-command.action");

const fix = {
  code: "GR2001",
  title: "Broken link",
  area: "links",
  fix: "Repair the link.",
  skill: "grimoire-links",
  docs: "https://example.com/GR2001",
};
const registered = withExplainCodes(command({ name: "g", action: () => undefined }), (code) =>
  code === "GR2001" ? fix : undefined,
);

const data = (code: string, json = false) =>
  ({ args: [code], options: { json } }) as Parameters<typeof explainCommandAction>[0];

describe("warlock explain for package codes", () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    config.get.mockReturnValue({ commands: [[registered]] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("preloads only the Warlock config for a package code", () => {
    void explainCommand.commandPreAction?.({ args: ["GR2001"], options: {} } as never);
    expect(explainCommand.commandPreload).toEqual({ warlockConfig: true });

    void explainCommand.commandPreAction?.({ args: ["WL3001"], options: {} } as never);
    expect(explainCommand.commandPreload).toBeUndefined();

    void explainCommand.commandPreAction?.({ args: ["src/a.ts"], options: {} } as never);
    expect(explainCommand.commandPreload?.bootstrap).toBe(true);
  });

  it("prints the answer of a registered explainer without booting", async () => {
    await explainCommandAction(data("GR2001"));

    expect(log.mock.calls.map(([line]: unknown[]) => String(line))).toContain(
      "  Fix:      Repair the link.",
    );
    expect(bootForInspect).not.toHaveBeenCalled();
  });

  it("prints the answer as JSON", async () => {
    await explainCommandAction(data("GR2001", true));

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(fix);
  });

  it("asks for the upper-case code when it is typed in lower case", async () => {
    await explainCommandAction(data("gr2001", true));

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(fix);
  });

  it("names the reason when warlock.config.ts cannot be read", async () => {
    config.isLoaded = false;
    config.load.mockRejectedValueOnce(new Error("Unexpected token in warlock.config.ts"));

    try {
      await expect(explainCommandAction(data("GR2001"))).rejects.toThrow(/Unexpected token/);
      expect(bootForInspect).not.toHaveBeenCalled();
    } finally {
      config.isLoaded = true;
    }
  });

  it("throws for a code no package explains, without booting", async () => {
    await expect(explainCommandAction(data("GR9999"))).rejects.toThrow(/cli\.commands/);
    expect(bootForInspect).not.toHaveBeenCalled();
  });

  it("formats the same layout as a Warlock code", () => {
    expect(formatRegisteredExplanation(fix)[0]).toBe("GR2001  Broken link");
  });
});
