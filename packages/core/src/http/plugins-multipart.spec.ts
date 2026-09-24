/**
 * Multipart must register with safe limits (finding B10).
 */
import config from "@mongez/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHttpPlugins } from "./plugins";

const register = vi.fn();
vi.mock("@fastify/multipart", () => ({ default: "multipart" }));

async function limits() {
  register.mockClear();
  await registerHttpPlugins({ register, addContentTypeParser: vi.fn() } as any);
  return register.mock.calls.find(call => call[0] === "multipart")![1].limits;
}

describe("multipart limits", () => {
  afterEach(() => config.set("http.multipart", undefined));

  it("defaults to safe limits", async () => {
    expect(await limits()).toMatchObject({
      fileSize: 10 * 1024 * 1024,
      files: 10,
      fields: 100,
      fieldSize: 1024 * 1024,
    });
  });

  it("is overridable from http.multipart", async () => {
    config.set("http.multipart", { files: 2 });
    expect((await limits()).files).toBe(2);
  });
});
