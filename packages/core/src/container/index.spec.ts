import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContainerKeyMissingError } from "../errors/container-key-missing-error";
import { container } from "./index";
import {
  registerContainerInstance,
  resetContainerInstanceRegistryForTests,
} from "./container-instance-registry";

describe("container.getOrFail", () => {
  beforeEach(() => {
    resetContainerInstanceRegistryForTests();
    registerContainerInstance();
  });

  afterEach(() => {
    resetContainerInstanceRegistryForTests();
    registerContainerInstance();
  });

  it("behaves like an ordinary miss when exactly one instance is registered", () => {
    expect(() => container.getOrFail("does-not-exist")).toThrow(ContainerKeyMissingError);

    try {
      container.getOrFail("does-not-exist");
    } catch (error) {
      expect((error as Error).message).toBe('Container key "does-not-exist" is not registered.');
      expect((error as Error).message).not.toMatch(/instance/i);
    }
  });

  it("names the instance count when more than one instance is registered", () => {
    registerContainerInstance();

    try {
      container.getOrFail("does-not-exist");
      throw new Error("expected getOrFail to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ContainerKeyMissingError);
      expect((error as Error).message).toMatch(/2 separate copies/);
      expect((error as Error).message).toMatch(/published install/);
    }
  });

  it("returns the value on a hit regardless of instance count", () => {
    registerContainerInstance();
    container.set("http.baseUrl", "https://example.test");

    expect(container.getOrFail("http.baseUrl")).toBe("https://example.test");

    container.delete("http.baseUrl");
  });
});
