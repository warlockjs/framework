import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevServerShortcuts } from "../../../src/dev-server/shortcuts";

/** What a terminal sends for Ctrl+C. */
const CTRL_C = String.fromCharCode(3);

type FakeTTY = NodeJS.ReadStream & { rawMode: boolean };

/**
 * A stand-in for an interactive stdin: a real readable stream that also
 * answers the TTY questions `DevServerShortcuts` asks before touching it.
 */
function createFakeTTY(isTTY = true): FakeTTY {
  const stream = new PassThrough() as unknown as FakeTTY;

  stream.isTTY = isTTY;
  stream.rawMode = false;
  stream.setRawMode = (mode: boolean) => {
    stream.rawMode = mode;
    return stream;
  };

  return stream;
}

/** Feed a key through the stream the way a terminal would. */
function press(stream: FakeTTY, sequence: string): void {
  (stream as unknown as PassThrough).write(sequence);
}

/** Let the keypress event and the (async) handler settle. */
const flush = () => new Promise(resolve => setImmediate(resolve));

describe("DevServerShortcuts", () => {
  let input: FakeTTY;

  beforeEach(() => {
    input = createFakeTTY();
  });

  it("registers a shortcut and runs its handler on the matching key", async () => {
    const handler = vi.fn();
    const shortcuts = new DevServerShortcuts(input);

    expect(shortcuts.register({ key: "u", description: "update", handler })).toBe(true);
    expect(input.rawMode).toBe(true);

    press(input, "u");
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("matches the key case-insensitively and ignores unrelated keys", async () => {
    const handler = vi.fn();
    const shortcuts = new DevServerShortcuts(input);

    shortcuts.register({ key: "U", description: "update", handler });

    press(input, "x");
    await flush();

    expect(handler).not.toHaveBeenCalled();

    press(input, "u");
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("declines to register without an interactive terminal", () => {
    const handler = vi.fn();
    const shortcuts = new DevServerShortcuts(createFakeTTY(false));

    expect(shortcuts.isSupported()).toBe(false);
    expect(shortcuts.register({ key: "u", description: "update", handler })).toBe(false);
  });

  it("turns Ctrl+C back into an interrupt and lets go of the terminal", async () => {
    const onInterrupt = vi.fn();
    const handler = vi.fn();
    const shortcuts = new DevServerShortcuts(input, onInterrupt);

    shortcuts.register({ key: "u", description: "update", handler });

    press(input, CTRL_C);
    await flush();

    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    expect(input.rawMode).toBe(false);
  });

  it("does not re-enter a handler that is still running", async () => {
    let release: () => void = () => {};
    const handler = vi.fn(() => new Promise<void>(resolve => (release = resolve)));
    const shortcuts = new DevServerShortcuts(input);

    shortcuts.register({ key: "u", description: "update", handler });

    press(input, "u");
    await flush();
    press(input, "u");
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await flush();

    press(input, "u");
    await flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("survives a handler that throws", async () => {
    const handler = vi.fn(() => {
      throw new Error("boom");
    });
    const shortcuts = new DevServerShortcuts(input);

    shortcuts.register({ key: "u", description: "update", handler });

    press(input, "u");
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);

    // Still listening: the failure did not tear the manager down.
    press(input, "u");
    await flush();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("releases raw mode when the last shortcut is unregistered", () => {
    const shortcuts = new DevServerShortcuts(input);

    shortcuts.register({ key: "u", description: "update", handler: vi.fn() });
    expect(input.rawMode).toBe(true);

    shortcuts.unregister("u");
    expect(input.rawMode).toBe(false);
  });

  it("stops delivering keys once released", async () => {
    const handler = vi.fn();
    const shortcuts = new DevServerShortcuts(input);

    shortcuts.register({ key: "u", description: "update", handler });
    shortcuts.release();

    press(input, "u");
    await flush();

    expect(handler).not.toHaveBeenCalled();
    expect(input.rawMode).toBe(false);
  });

  it("takes the terminal back on resume", async () => {
    const handler = vi.fn();
    const shortcuts = new DevServerShortcuts(input);

    shortcuts.register({ key: "u", description: "update", handler });
    shortcuts.release();
    shortcuts.resume();

    expect(input.rawMode).toBe(true);

    press(input, "u");
    await flush();

    expect(handler).toHaveBeenCalled();
  });

  it("is a no-op to release twice", () => {
    const shortcuts = new DevServerShortcuts(input);

    shortcuts.register({ key: "u", description: "update", handler: vi.fn() });

    expect(() => {
      shortcuts.release();
      shortcuts.release();
    }).not.toThrow();
  });
});
