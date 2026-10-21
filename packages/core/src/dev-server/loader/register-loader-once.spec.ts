import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagePort } from "node:worker_threads";

const mocks = vi.hoisted(() => ({
  build: vi.fn(async () => ({ outputFiles: [{ text: "export {};" }] })),
  register: vi.fn(
    (_specifier: string, _parent: string, _options: { data: { port: MessagePort } }) => undefined,
  ),
}));
vi.mock("esbuild", () => ({ build: mocks.build }));
vi.mock("node:module", () => ({ register: mocks.register }));
vi.mock("@warlock.js/fs", () => ({ putFileAsync: vi.fn(async () => undefined) }));

const ports: MessagePort[] = [];
const key = Symbol.for("@warlock.js/core:esm-loader");
let previous: unknown;
beforeEach(() => {
  const host = globalThis as Record<symbol, unknown>;
  previous = host[key];
  delete host[key];
});
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
  for (const call of mocks.register.mock.calls) {
    const options = call[2] as { data: { port: MessagePort } } | undefined;
    options?.data.port.close();
  }
  const host = globalThis as Record<symbol, unknown>;
  if (previous === undefined) delete host[key];
  else host[key] = previous;
  vi.clearAllMocks();
});

describe("process loader registration", () => {
  it("shares concurrent initialization and survives module reloads", async () => {
    const { registerLoader } = await import("./register-loader");
    const settings = {
      cacheDir: "/unused",
      fingerprint: "test",
      target: "node22",
      tsconfigRaw: "{}",
      debugNames: false,
    };
    const first = registerLoader(settings);
    const second = registerLoader(settings);
    expect(second).toBe(first);
    ports.push(await first);
    vi.resetModules();
    const reloaded = await import("./register-loader");
    expect(await reloaded.registerLoader(settings)).toBe(ports[0]);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.build).toHaveBeenCalledTimes(1);
  });
});
