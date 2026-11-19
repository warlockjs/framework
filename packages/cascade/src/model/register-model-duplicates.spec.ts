import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterModel } from "./register-model";

const KEY = Symbol.for("@warlock.js/test:silence-re-registration");
const context = (name: string) =>
  ({ kind: "class", name, metadata: {} }) as unknown as ClassDecoratorContext;

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
  vi.restoreAllMocks();
});

describe("RegisterModel duplicate registration", () => {
  it("warns by default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    RegisterModel()(class {} as never, context("DupModelA"));
    RegisterModel()(class {} as never, context("DupModelA"));

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("counts a name an earlier file registered, and still warns inside one file", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const silencer = { count: 0, current: new Set<string>(), previous: new Set<string>() };
    (globalThis as Record<symbol, unknown>)[KEY] = silencer;

    RegisterModel()(class {} as never, context("DupModelB"));
    // File boundary.
    silencer.current.forEach((name) => silencer.previous.add(name));
    silencer.current.clear();

    RegisterModel()(class {} as never, context("DupModelB")); // next file re-imports
    expect(warn).not.toHaveBeenCalled();
    expect(silencer.count).toBe(1);

    RegisterModel()(class {} as never, context("DupModelB")); // same file, second module
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
