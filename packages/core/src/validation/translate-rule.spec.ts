import { extend, trans } from "@mongez/localization";
import { log } from "@warlock.js/logger";
import { v, validate } from "@warlock.js/seal";
import type { RuleTranslation } from "@warlock.js/seal";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setEnvironment } from "../utils/environment";
import { resetUnfilledPlaceholderWarningsForTests, translateSealRule } from "./translate-rule";

/**
 * The English `validation.*` defaults the browser form library registers into
 * the process-wide translation store when it is imported (it names the
 * length value `:length`, where seal names it `:maxLength` / `:minLength`).
 */
const formLibraryDefaults = {
  required: "This input is required",
  min: "Value can not be lower than :min",
  max: "Value can not be greater than :max",
  match: "This input is not matching with :matchingInput",
  length: "This input should have :length characters",
  minLength: "This input can not be less than :length characters",
  maxLength: "This input can not be greater than :length characters",
  pattern: "This input is not matching with the :pattern",
  email: "This input is not an email of :domain",
};

const translateRule = (ruleTranslation: RuleTranslation) =>
  translateSealRule({
    ...ruleTranslation,
    key: `validation.${ruleTranslation.rule.name}`,
    translate: (key, placeholders) => trans(key, placeholders),
  });

async function messageOf(schema: ReturnType<typeof v.string>, value: unknown) {
  const result = await validate(v.object({ name: schema }), { name: value }, { translateRule });

  return result.isValid ? undefined : result.errors[0]?.error;
}

describe("default seal rule translation with the form library defaults registered", () => {
  beforeAll(() => {
    extend("en", { validation: formLibraryDefaults });
  });

  afterEach(() => {
    setEnvironment("test");
    resetUnfilledPlaceholderWarningsForTests();
    vi.restoreAllMocks();
  });

  it("fills the length placeholder for maxLength", async () => {
    const message = await messageOf(v.string().maxLength(5), "abcdefghij");

    expect(message).toBe("This input can not be greater than 5 characters");
  });

  it("fills the length placeholder for minLength and length", async () => {
    expect(await messageOf(v.string().minLength(5), "ab")).toBe(
      "This input can not be less than 5 characters",
    );
    expect(await messageOf(v.string().length(5), "ab")).toBe("This input should have 5 characters");
  });

  it("falls back to seal's message when a placeholder has no matching parameter", async () => {
    const message = await messageOf(v.string().email(), "bbb");

    expect(message).toBe("The name must be a valid email address");
    expect(message).not.toMatch(/:[a-zA-Z]/);
  });

  it("keeps an app override of the validation translation", async () => {
    extend("en", { validation: { maxLength: "Too long, keep it under :maxLength" } });

    try {
      expect(await messageOf(v.string().maxLength(5), "abcdefghij")).toBe(
        "Too long, keep it under 5",
      );
    } finally {
      extend("en", { validation: { maxLength: formLibraryDefaults.maxLength } });
    }
  });

  it("warns once per key in development when a message cannot be filled", async () => {
    setEnvironment("development");
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);

    await messageOf(v.string().email(), "bbb");
    await messageOf(v.string().email(), "ccc");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[2])).toContain("validation.email");
  });

  it("does not warn outside development", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);

    await messageOf(v.string().pattern(/^a+$/), "bbb");

    expect(warn).not.toHaveBeenCalled();
  });
});
