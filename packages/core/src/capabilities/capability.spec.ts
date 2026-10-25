import { beforeEach, describe, expect, it } from "vitest";
import { errorCodeOf } from "../errors/error-codes";
import {
  CapabilityNotProvidedError,
  defineCapability,
  hasCapability,
  listCapabilities,
  provideCapability,
  resetCapabilities,
  useCapability,
} from "./capability";

type Mailer = { send(id: string): string };

beforeEach(() => {
  resetCapabilities();
});

describe("capabilities", () => {
  it("returns what was provided, typed by the capability", () => {
    const mailer = defineCapability<Mailer>("billing.mailer");

    provideCapability(mailer, { send: (id) => `sent ${id}` });

    expect(useCapability(mailer).send("42")).toBe("sent 42");
  });

  it("fails with WL2008 and the fix when nothing provided it", () => {
    const mailer = defineCapability<Mailer>("billing.mailer");

    expect(() => useCapability(mailer)).toThrow(CapabilityNotProvidedError);
    expect(() => useCapability(mailer)).toThrow(/billing\.mailer.*provideCapability/s);

    try {
      useCapability(mailer);
    } catch (error) {
      expect(errorCodeOf(error)).toBe("WL2008");
    }
  });

  it("names the capabilities that are provided in the error", () => {
    provideCapability(defineCapability<string>("a.one"), "x");

    expect(() => useCapability(defineCapability<string>("a.two"))).toThrow(/Provided capabilities: a\.one/);
  });

  it("replaces the implementation when provided again", () => {
    const flag = defineCapability<{ on: boolean }>("flags");

    provideCapability(flag, { on: false });
    provideCapability(flag, { on: true });

    expect(useCapability(flag).on).toBe(true);
  });

  it("keeps the provider when the capability is defined again (a hot reload)", () => {
    provideCapability(defineCapability<string>("reload.me", { description: "first" }), "live");

    const redefined = defineCapability<string>("reload.me", { description: "second" });

    expect(useCapability(redefined)).toBe("live");
    expect(listCapabilities()[0]).toMatchObject({ name: "reload.me", description: "second" });
  });

  it("shares a provider between two tokens of the same name", () => {
    provideCapability(defineCapability<string>("shared"), "value");

    expect(useCapability(defineCapability<string>("shared"))).toBe("value");
  });

  it("answers hasCapability without counting a consumer", () => {
    const optional = defineCapability<string>("optional", { required: false });

    expect(hasCapability(optional)).toBe(false);

    provideCapability(optional, "here");

    expect(hasCapability(optional)).toBe(true);
    expect(listCapabilities()[0]?.consumers).toEqual([]);
  });

  it("lists capabilities sorted, with required, provided and the files involved", () => {
    const b = defineCapability<string>("b.cap", { description: "second" });
    defineCapability<string>("a.cap", { required: false });
    provideCapability(b, "impl");
    useCapability(b);

    const [a, second] = listCapabilities();

    expect(a).toMatchObject({
      name: "a.cap",
      description: null,
      required: false,
      provided: false,
      providedBy: null,
      consumers: [],
    });
    expect(second).toMatchObject({
      name: "b.cap",
      description: "second",
      required: true,
      provided: true,
    });
    expect(second?.definedIn).toMatch(/capability\.spec\.ts$/);
    expect(second?.providedBy).toMatch(/capability\.spec\.ts$/);
    expect(second?.consumers).toHaveLength(1);
    expect(second?.consumers[0]).toMatch(/capability\.spec\.ts$/);
  });

  it("records each consumer file once", () => {
    const cap = defineCapability<string>("once");

    provideCapability(cap, "v");
    useCapability(cap);
    useCapability(cap);

    expect(listCapabilities()[0]?.consumers).toHaveLength(1);
  });
});
