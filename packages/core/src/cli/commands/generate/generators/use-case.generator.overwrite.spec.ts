import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.hoisted(() => vi.fn());
vi.mock("../utils/writer", () => ({ putFileAsync: put, setDryRun: vi.fn() }));
vi.mock("../utils/path-resolver", () => ({
  moduleExists: async () => true,
  componentExists: async () => true,
  ensureComponentDirectory: async () => undefined,
  resolveComponentPath: (m: string, t: string, n: string) => `src/app/${m}/${t}/${n}.ts`,
}));

import { generateUseCase } from "./use-case.generator";

describe("generateUseCase", () => {
  beforeEach(() => put.mockClear());

  it("refuses to overwrite an existing file without --force", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      generateUseCase({ args: ["orders/place-order"], options: {} } as never),
    ).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(put).not.toHaveBeenCalled();
  });

  it("writes both files to use-cases/ with --force", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await generateUseCase({ args: ["orders/place-order"], options: { force: true } } as never);

    expect(put.mock.calls.map((c) => c[0])).toEqual([
      "src/app/orders/use-cases/place-order.use-case.ts",
      "src/app/orders/use-cases/place-order.use-case.spec.ts",
    ]);
  });
});
