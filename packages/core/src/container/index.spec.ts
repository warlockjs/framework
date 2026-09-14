import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContainerKeyMissingError } from "../errors/container-key-missing-error";
import { container } from "./index";
import {
  registerContainerInstance,
  resetContainerInstanceRegistryForTests,
} from "./container-instance-registry";

describe("container.get", () => {
  beforeEach(() => {
    resetContainerInstanceRegistryForTests();
    registerContainerInstance();
  });

  afterEach(() => {
    resetContainerInstanceRegistryForTests();
    registerContainerInstance();
  });

  it("returns the value for a registered key", () => {
    container.set("http.baseUrl", "https://example.test");

    expect(container.get("http.baseUrl")).toBe("https://example.test");

    container.delete("http.baseUrl");
  });

  it("throws a named error naming the missing key, behaving like an ordinary miss when exactly one instance is registered", () => {
    expect(() => container.get("does-not-exist")).toThrow(ContainerKeyMissingError);

    try {
      container.get("does-not-exist");
    } catch (error) {
      expect((error as Error).message).toMatch(/^Container key "does-not-exist" is not registered\./);
      expect((error as Error).message).not.toMatch(/separate copies/i);
    }
  });

  it("lists the currently registered keys, bounded, in the thrown message", () => {
    container.set("http.baseUrl", "https://example.test");

    try {
      container.get("does-not-exist");
      throw new Error("expected get to throw");
    } catch (error) {
      expect((error as Error).message).toMatch(/Registered keys:/);
      expect((error as Error).message).toContain('"http.baseUrl"');
    } finally {
      container.delete("http.baseUrl");
    }
  });

  it("names the instance count when more than one instance is registered", () => {
    registerContainerInstance();

    try {
      container.get("does-not-exist");
      throw new Error("expected get to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ContainerKeyMissingError);
      expect((error as Error).message).toMatch(/2 separate copies/);
      expect((error as Error).message).toMatch(/published install/);
    }
  });
});

describe("container.tryGet", () => {
  beforeEach(() => {
    resetContainerInstanceRegistryForTests();
    registerContainerInstance();
  });

  afterEach(() => {
    resetContainerInstanceRegistryForTests();
    registerContainerInstance();
  });

  it("returns undefined for a missing key instead of throwing", () => {
    expect(container.tryGet("does-not-exist")).toBeUndefined();
  });

  it("returns the value for a registered key", () => {
    container.set("http.baseUrl", "https://example.test");

    expect(container.tryGet("http.baseUrl")).toBe("https://example.test");

    container.delete("http.baseUrl");
  });
});

describe("container.has", () => {
  it("reports whether a key is registered without throwing", () => {
    expect(container.has("does-not-exist")).toBe(false);

    container.set("http.baseUrl", "https://example.test");

    expect(container.has("http.baseUrl")).toBe(true);

    container.delete("http.baseUrl");
  });
});
