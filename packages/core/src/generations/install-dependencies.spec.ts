import { describe, expect, it, vi } from "vitest";
import { installDependencies } from "./add-command.action";

describe("installDependencies", () => {
  it("runs the chosen manager's add command through the injected exec", async () => {
    const exec = vi.fn();
    await installDependencies("pnpm", { zod: "^3.0.0" }, { vitest: "^1.0.0" }, exec);
    expect(exec.mock.calls.map(c => c[0])).toEqual([
      "pnpm add zod@^3.0.0",
      "pnpm add vitest@^1.0.0 -D",
    ]);
  });
});
