import type { StandardSchemaV1 } from "@standard-schema/spec";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonSchemaToStandard, resetAjvCacheForTests } from "./json-schema-to-standard";

/**
 * A hand-rolled fake `ajv` registered via `vi.mock` so the lazily-imported
 * validator path runs without the real (optional, uninstalled) peer. The
 * fake compiles a schema into a validator that enforces `required` string
 * keys + a top-level `type: "object"` — enough to drive accept / reject /
 * error-shape assertions.
 */
vi.mock("ajv", () => {
  interface FakeValidator {
    (value: unknown): boolean;
    errors?: Array<{ instancePath: string; message: string; keyword: string }>;
  }

  class FakeAjv {
    public compile(schema: Record<string, unknown>): FakeValidator {
      const required = (schema.required as string[] | undefined) ?? [];
      const properties = (schema.properties as Record<string, { type?: string }> | undefined) ?? {};

      const validator: FakeValidator = (value: unknown) => {
        validator.errors = [];

        if (schema.type === "object" && (typeof value !== "object" || value === null)) {
          validator.errors = [{ instancePath: "", message: "must be object", keyword: "type" }];

          return false;
        }

        const record = (value ?? {}) as Record<string, unknown>;

        for (const key of required) {
          if (!(key in record)) {
            validator.errors?.push({
              instancePath: `/${key}`,
              message: "is required",
              keyword: "required",
            });
          }
        }

        for (const [key, spec] of Object.entries(properties)) {
          if (key in record && spec.type === "string" && typeof record[key] !== "string") {
            validator.errors?.push({
              instancePath: `/${key}`,
              message: "must be string",
              keyword: "type",
            });
          }
        }

        return (validator.errors?.length ?? 0) === 0;
      };

      return validator;
    }
  }

  return { default: FakeAjv };
});

afterEach(() => {
  resetAjvCacheForTests();
});

const STRING_SCHEMA = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
} as const;

/** Resolve a schema's validate (it may be sync or async). */
async function validate<T>(
  schema: StandardSchemaV1<T>,
  value: unknown,
): Promise<StandardSchemaV1.Result<T>> {
  return schema["~standard"].validate(value);
}

describe("jsonSchemaToStandard — structural shape", () => {
  it("mirrors the passthroughSchema template (version 1, warlock-ai vendor)", () => {
    const schema = jsonSchemaToStandard(STRING_SCHEMA as unknown as Record<string, unknown>);

    expect(schema["~standard"].version).toBe(1);
    expect(schema["~standard"].vendor).toBe("warlock-ai");
    expect(typeof schema["~standard"].validate).toBe("function");
  });
});

describe("jsonSchemaToStandard — no / empty schema", () => {
  it("accepts anything when the schema is undefined", async () => {
    const schema = jsonSchemaToStandard(undefined);

    const result = await validate(schema, { anything: 1 });

    expect(result).toEqual({ value: { anything: 1 } });
  });

  it("accepts anything when the schema is an empty object", async () => {
    const schema = jsonSchemaToStandard({});

    const result = await validate(schema, "whatever");

    expect(result).toEqual({ value: "whatever" });
  });
});

describe("jsonSchemaToStandard — ajv-backed validation", () => {
  it("accepts input that satisfies the schema", async () => {
    const schema = jsonSchemaToStandard<{ message: string }>(
      STRING_SCHEMA as unknown as Record<string, unknown>,
    );

    const result = await validate(schema, { message: "hi" });

    expect(result).toEqual({ value: { message: "hi" } });
  });

  it("rejects input missing a required field with a pathed issue", async () => {
    const schema = jsonSchemaToStandard(STRING_SCHEMA as unknown as Record<string, unknown>);

    const result = await validate(schema, {});

    expect("issues" in result).toBe(true);
    if ("issues" in result && result.issues) {
      expect(result.issues[0].path).toEqual(["message"]);
      expect(result.issues[0].message).toContain("required");
    }
  });

  it("rejects input whose field has the wrong type", async () => {
    const schema = jsonSchemaToStandard(STRING_SCHEMA as unknown as Record<string, unknown>);

    const result = await validate(schema, { message: 42 });

    expect("issues" in result).toBe(true);
    if ("issues" in result && result.issues) {
      expect(result.issues[0].message).toContain("string");
    }
  });

  it("rejects a non-object when the schema demands an object", async () => {
    const schema = jsonSchemaToStandard(STRING_SCHEMA as unknown as Record<string, unknown>);

    const result = await validate(schema, "not-an-object");

    expect("issues" in result).toBe(true);
  });

  it("compiles each schema once and reuses the validator across calls", async () => {
    const schema = jsonSchemaToStandard(STRING_SCHEMA as unknown as Record<string, unknown>);

    const a = await validate(schema, { message: "one" });
    const b = await validate(schema, { message: "two" });

    expect(a).toEqual({ value: { message: "one" } });
    expect(b).toEqual({ value: { message: "two" } });
  });
});
