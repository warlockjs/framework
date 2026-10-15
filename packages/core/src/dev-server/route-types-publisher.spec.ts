import { describe, expect, it, vi } from "vitest";
import { publishCurrentRouteTypes } from "./route-types-publisher";

describe("publishCurrentRouteTypes", () => {
  it("does nothing when the consuming project does not install optional Web", async () => {
    const resolveModule = vi.fn(() => {
      const error = Object.assign(new Error("Cannot find package '@warlock.js/web'"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
      throw error;
    });

    await expect(
      publishCurrentRouteTypes("C:/app", [], {
        resolveModule,
        importModule: vi.fn(),
      }),
    ).resolves.toBe(false);
  });

  it("resolves Web's build-only entry from the consuming project and sends Core snapshots", async () => {
    const writeCurrentRouteTypes = vi.fn().mockResolvedValue(undefined);
    const resolveModule = vi
      .fn()
      .mockReturnValueOnce(new URL("file:///C:/app/node_modules/@warlock.js/web/index.mjs"))
      .mockReturnValueOnce(new URL("file:///C:/app/node_modules/@warlock.js/web/build/index.mjs"));
    const importModule = vi.fn().mockResolvedValue({ writeCurrentRouteTypes });
    const apis = [{ name: "posts.create", path: "/posts", method: "POST" }] as const;

    await expect(
      publishCurrentRouteTypes("C:/app", apis, { resolveModule, importModule }),
    ).resolves.toBe(true);
    expect(writeCurrentRouteTypes).toHaveBeenCalledWith({ appRoot: "C:/app", apis });
  });

  it("fails loudly when installed Web lacks the compatible build helper", async () => {
    const resolveModule = vi.fn(
      () => new URL("file:///C:/app/node_modules/@warlock.js/web/build/index.mjs"),
    );

    await expect(
      publishCurrentRouteTypes("C:/app", [], {
        resolveModule,
        importModule: vi.fn().mockResolvedValue({}),
      }),
    ).rejects.toThrow("does not export writeCurrentRouteTypes");
  });
});
