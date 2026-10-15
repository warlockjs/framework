import type { StandardSchemaV1 } from "@standard-schema/spec";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonSchemaToStandard, resetAjvCacheForTests } from "./json-schema-to-standard";

/**
 * Simulate the OPTIONAL `ajv` peer being absent: the dynamic
 * `import("ajv")` throws a module-resolution error, exactly as Node does
 * for an uninstalled package. The wrapper must NOT rethrow the raw stack —
 * it surfaces the curated install string as a Standard Schema issue so the
 * developer sees the install instruction in logs, while the agent reads it
 * as data.
 *
 * Mirrors `ai-panoptic`'s `otel-exporter-missing-sdk.spec.ts`.
 */
vi.mock("ajv", () => {
  throw new Error("Cannot find module 'ajv'");
});

afterEach(() => {
  resetAjvCacheForTests();
});

const SCHEMA = {
  type: "object",
  properties: { q: { type: "string" } },
  required: ["q"],
} as const;

/** Resolve a schema's validate (sync or async). */
async function validate(
  schema: StandardSchemaV1<unknown>,
  value: unknown,
): Promise<StandardSchemaV1.Result<unknown>> {
  return schema["~standard"].validate(value);
}

describe("jsonSchemaToStandard — missing ajv peer", () => {
  it("surfaces the curated install string as an issue rather than throwing", async () => {
    const schema = jsonSchemaToStandard(SCHEMA as unknown as Record<string, unknown>);

    const result = await validate(schema, { q: "hello" });

    expect("issues" in result).toBe(true);
    if ("issues" in result && result.issues) {
      expect(result.issues[0].message).toMatch(/requires the ajv package/i);
      expect(result.issues[0].message).toMatch(/npm install ajv/i);
    }
  });

  it("never rethrows the raw module-resolution error", async () => {
    const schema = jsonSchemaToStandard(SCHEMA as unknown as Record<string, unknown>);

    await expect(validate(schema, { q: "x" })).resolves.toBeDefined();
  });

  it("still accept-alls a no-schema tool without touching ajv", async () => {
    const schema = jsonSchemaToStandard(undefined);

    const result = await validate(schema, { anything: true });

    expect(result).toEqual({ value: { anything: true } });
  });
});
