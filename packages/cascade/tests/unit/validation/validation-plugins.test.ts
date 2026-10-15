/**
 * Unit tests for the Cascade seal plugins that inject DB-aware validation:
 *
 *  - databaseRulesPlugin  → `.unique()` / `.exists()` on scalar validators
 *  - embedValidator       → `v.embed()` / `v.embedMany()`
 *
 * We invoke each plugin's `install()` directly (rather than the async
 * `registerPlugin`) and assert the methods are grafted onto the right
 * prototypes and wire the correct rule + options. The validator's public
 * `rules` array exposes each added rule as a clone carrying
 * `context.options`, which is exactly what these plugins populate.
 */
import { ScalarValidator, v } from "@warlock.js/seal";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import { databaseRulesPlugin } from "../../../src/validation/plugins/database-rules-plugin";
import { embedValidator } from "../../../src/validation/plugins/embed-validator-plugin";
import { EmbedModelValidator } from "../../../src/validation/validators/embed-validator";

type AddedRule = {
  name: string;
  context: { options: Record<string, unknown> };
};

function rulesOf(validator: unknown): AddedRule[] {
  return (validator as { rules: AddedRule[] }).rules;
}

class User extends Model {
  static table = "users";
}

describe("validation/plugins", () => {
  // Both plugins mutate shared seal prototypes / the v factory. Install once
  // for the whole suite; the mutations are idempotent grafts.
  beforeAll(() => {
    databaseRulesPlugin.install?.();
    embedValidator.install?.();
  });

  describe("databaseRulesPlugin", () => {
    it("exposes a name, version and description", () => {
      expect(databaseRulesPlugin.name).toBe("cascade-database-rules");
      expect(databaseRulesPlugin.version).toBe("1.0.0");
      expect(databaseRulesPlugin.description).toContain("unique()");
    });

    it("grafts unique() and exists() onto ScalarValidator", () => {
      expect(typeof (ScalarValidator.prototype as unknown as { unique: unknown }).unique).toBe(
        "function",
      );
      expect(typeof (ScalarValidator.prototype as unknown as { exists: unknown }).exists).toBe(
        "function",
      );
    });

    it("unique() pushes the unique rule carrying the Model reference", () => {
      const validator = v.string().unique(User);
      const rule = rulesOf(validator).find((r) => r.name === "unique");

      expect(rule).toBeDefined();
      expect(rule!.context.options.Model).toBe(User);
    });

    it("unique() forwards extra options and pulls out errorMessage", () => {
      const validator = v.string().unique(User, {
        except: "id",
        errorMessage: "Taken!",
      });
      const rule = rulesOf(validator).find((r) => r.name === "unique");

      expect(rule!.context.options.except).toBe("id");
      // errorMessage is destructured out of the options bag, not stored under it.
      expect(rule!.context.options.errorMessage).toBeUndefined();
    });

    it("exists() pushes the exists rule carrying the Model reference", () => {
      const validator = v.string().exists(User, { column: "slug" });
      const rule = rulesOf(validator).find((r) => r.name === "exists");

      expect(rule).toBeDefined();
      expect(rule!.context.options.Model).toBe(User);
      expect(rule!.context.options.column).toBe("slug");
    });

    it("accepts a string model reference", () => {
      const validator = v.string().unique("User");
      const rule = rulesOf(validator).find((r) => r.name === "unique");
      expect(rule!.context.options.Model).toBe("User");
    });

    it("the same unique() method is shared onto Number and String validators", () => {
      // The plugin copies ScalarValidator's impl onto String/Number prototypes.
      const numberValidator = v.number();
      expect(
        typeof (numberValidator as unknown as { unique: unknown }).unique,
      ).toBe("function");
      const rule = rulesOf((numberValidator as unknown as { unique: (m: unknown) => unknown }).unique(User)).find(
        (r) => r.name === "unique",
      );
      expect(rule!.context.options.Model).toBe(User);
    });
  });

  describe("embedValidator", () => {
    it("exposes a name, version and description", () => {
      expect(embedValidator.name).toBe("embed");
      expect(embedValidator.version).toBe("1.0.0");
      expect(embedValidator.description).toContain("v.embed()");
    });

    it("v.embed() returns an EmbedModelValidator bound to the model", () => {
      const validator = v.embed(User);
      expect(validator).toBeInstanceOf(EmbedModelValidator);

      // model() adds the databaseModel rule carrying the model ref.
      const rule = rulesOf(validator).find((r) => r.name === "databaseModel");
      expect(rule).toBeDefined();
      expect(rule!.context.options.model).toBe(User);
    });

    it("v.embedMany() returns an EmbedModelValidator validating a list", () => {
      const validator = v.embedMany(User);
      expect(validator).toBeInstanceOf(EmbedModelValidator);

      const names = rulesOf(validator).map((r) => r.name);
      // models() adds an array rule plus the databaseModels rule.
      expect(names).toContain("databaseModels");
    });

    it("v.embed() with embed option registers a transformer", () => {
      const validator = v.embed(User, { embed: ["id", "name"] });
      const transformers = (validator as unknown as { dataTransformers: unknown[] })
        .dataTransformers;
      expect(transformers.length).toBeGreaterThan(0);
    });

    it("accepts a string model reference for embed", () => {
      const validator = v.embed("User");
      const rule = rulesOf(validator).find((r) => r.name === "databaseModel");
      expect(rule!.context.options.model).toBe("User");
    });
  });
});
