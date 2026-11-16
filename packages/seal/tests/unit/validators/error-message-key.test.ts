import { afterEach, describe, expect, it } from "vitest";
import { configureSeal, resetSealConfig } from "../../../src/config";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import "../../../src/validators";

afterEach(() => resetSealConfig());

const TRANSLATIONS: Record<string, string> = {
  "forms.nameTooShort": "The :input is too short",
};

function translateFromTable() {
  configureSeal({
    translateMessageKey: (key) => TRANSLATIONS[key] ?? key,
  });
}

describe("errorMessage given as a translation key", () => {
  it("is translated when the app configures translateMessageKey, and fills its placeholders", async () => {
    translateFromTable();

    const result = await validate(v.object({ name: v.string().min(5, "forms.nameTooShort") }), {
      name: "ab",
    });

    expect(result.errors[0]?.error).toBe("The name is too short");
  });

  it("stays as given when the key has no translation", async () => {
    translateFromTable();

    const result = await validate(v.object({ name: v.string().min(5, "forms.unknownKey") }), {
      name: "ab",
    });

    expect(result.errors[0]?.error).toBe("forms.unknownKey");
  });

  it("never passes a literal sentence to the translator", async () => {
    const seen: string[] = [];

    configureSeal({
      translateMessageKey: (key) => {
        seen.push(key);

        return "translated";
      },
    });

    const result = await validate(v.object({ name: v.string().min(5, "Too short, sorry.") }), {
      name: "ab",
    });

    expect(result.errors[0]?.error).toBe("Too short, sorry.");
    expect(seen).toEqual([]);
  });

  it("is returned literally when no translator is configured", async () => {
    const result = await validate(v.object({ name: v.string().min(5, "forms.nameTooShort") }), {
      name: "ab",
    });

    expect(result.errors[0]?.error).toBe("forms.nameTooShort");
  });
});
