import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectCommand } from "../inspect.command";
import { explainCommand } from "../explain.command";
import { explainCommandAction } from "../explain/explain-command.action";
import { inspectCommandAction } from "./inspect-command.action";
import { bootForInspect } from "../../../tooling/inspect/boot-for-inspect";
import { inspectApp } from "../../../tooling/inspect/inspect-app";

vi.mock("../../../tooling/inspect/boot-for-inspect", () => ({
  bootForInspect: vi.fn(async () => ({})),
  inspectOptionsFromBoot: () => ({}),
}));
vi.mock("../../../tooling/inspect/inspect-app", async (original) => ({
  ...(await original<typeof import("../../../tooling/inspect/inspect-app")>()),
  inspectApp: vi.fn(async () => ({
    app: { root: "/fixture" },
    files: [
      {
        file: "src/shared/value.ts",
        module: "src/shared",
        role: "util",
        exports: ["value"],
        imports: [],
        importedBy: [],
      },
    ],
    routes: [],
    pages: [],
    warnings: [],
  })),
}));

afterEach(() => vi.clearAllMocks());

describe("file inspection CLI", () => {
  it("skips preload and boot for files-only JSON requests", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const data = { args: [], options: { section: "files", json: true } };
      await inspectCommand.commandPreAction?.(data);
      expect(inspectCommand.commandPreload).toBeUndefined();
      await inspectCommandAction(data);
      expect(bootForInspect).not.toHaveBeenCalled();
      expect(inspectApp).toHaveBeenCalledWith({ sections: ["files"] });
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
        files: [{ exports: ["value"] }],
      });
      await inspectCommand.commandPreAction?.({ args: [], options: {} });
      expect(inspectCommand.commandPreload).toMatchObject({ config: true, bootstrap: true });
    } finally {
      log.mockRestore();
    }
  });

  it("keeps code explanations static and boots for file explanations", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const code = { args: ["WL3001"], options: { json: true } };
      await explainCommand.commandPreAction?.(code);
      expect(explainCommand.commandPreload).toBeUndefined();
      await explainCommandAction(code);
      expect(bootForInspect).not.toHaveBeenCalled();
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ code: "WL3001" });
      const file = { args: ["src/shared/value.ts"], options: { json: true } };
      await explainCommand.commandPreAction?.(file);
      expect(explainCommand.commandPreload).toMatchObject({ config: true });
      await explainCommandAction(file);
      expect(bootForInspect).toHaveBeenCalledOnce();
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
        role: "util",
        exports: ["value"],
        importedBy: [],
        routes: [],
        pages: [],
      });
    } finally {
      log.mockRestore();
    }
  });
});
