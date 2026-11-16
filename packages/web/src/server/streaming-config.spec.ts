import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import {
  LoaderTimeoutConfigError,
  ShellTimeoutConfigError,
  resolveLoaderTimeoutMs,
  resolveShellTimeoutMs,
} from "./streaming-config";

describe("resolveLoaderTimeoutMs (card 904a04eb)", () => {
  afterEach(() => {
    config.set("web", {});
  });

  it("defaults to 15000ms when web.loaderTimeout is unset", () => {
    expect(resolveLoaderTimeoutMs()).toBe(15_000);
  });

  it("reads web.loaderTimeout when set", () => {
    config.set("web", { loaderTimeout: 5_000 });

    expect(resolveLoaderTimeoutMs()).toBe(5_000);
  });

  it("allows 0, which disables the bound", () => {
    config.set("web", { loaderTimeout: 0 });

    expect(resolveLoaderTimeoutMs()).toBe(0);
  });

  it("throws LoaderTimeoutConfigError for a negative value", () => {
    config.set("web", { loaderTimeout: -1 });

    expect(() => resolveLoaderTimeoutMs()).toThrow(LoaderTimeoutConfigError);
  });

  it("throws LoaderTimeoutConfigError for a non-integer value", () => {
    config.set("web", { loaderTimeout: 12.5 });

    expect(() => resolveLoaderTimeoutMs()).toThrow(LoaderTimeoutConfigError);
  });
});

describe("resolveShellTimeoutMs", () => {
  afterEach(() => {
    config.set("web", {});
  });

  it("defaults to 30000ms when web.shellTimeout is unset", () => {
    expect(resolveShellTimeoutMs()).toBe(30_000);
  });

  it("reads web.shellTimeout, and 0 disables the bound", () => {
    config.set("web", { shellTimeout: 2_000 });
    expect(resolveShellTimeoutMs()).toBe(2_000);

    config.set("web", { shellTimeout: 0 });
    expect(resolveShellTimeoutMs()).toBe(0);
  });

  it("throws ShellTimeoutConfigError for a negative or fractional value", () => {
    config.set("web", { shellTimeout: -1 });
    expect(() => resolveShellTimeoutMs()).toThrow(ShellTimeoutConfigError);

    config.set("web", { shellTimeout: 1.5 });
    expect(() => resolveShellTimeoutMs()).toThrow(ShellTimeoutConfigError);
  });
});
