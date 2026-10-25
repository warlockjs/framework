import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import {
  describeToolSchema,
  describeToolSchemas,
  formatToolSchemaReports,
} from "./tool-schema-lint";

type JsonSchema = Record<string, unknown>;

/**
 * Hand-rolled schema that answers the Standard JSON Schema slot the way
 * Seal does: one shape per target.
 */
function sealLike(byTarget: Record<string, JsonSchema>): StandardSchemaV1<unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: ({ target }: { target: string }) => byTarget[target] ?? byTarget.default,
      },
    },
  } as unknown as StandardSchemaV1<unknown>;
}

/** Zod-like: one fixed JSON Schema regardless of the requested target. */
function fixed(schema: JsonSchema): StandardSchemaV1<unknown> {
  return {
    "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) },
    jsonSchema: schema,
  } as unknown as StandardSchemaV1<unknown>;
}

const strictObject: JsonSchema = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
  additionalProperties: false,
};

describe("describeToolSchema()", () => {
  it("reports a clean tool with its estimated token cost and a stable hash", () => {
    const tool = { name: "get_weather", description: "Weather by city", input: fixed(strictObject) };

    const report = describeToolSchema(tool);

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.tokens).toBeGreaterThan(0);
    expect(report.targets).toEqual(["openai-strict", "anthropic", "google"]);
    expect(describeToolSchema(tool).schemaHash).toBe(report.schemaHash);
    expect(
      describeToolSchema({ ...tool, description: "Weather by city name" }).schemaHash,
    ).not.toBe(report.schemaHash);
  });

  it("warns when an optional field is sent as required and nullable", () => {
    const tool = {
      name: "save_facts",
      description: "Save facts",
      input: sealLike({
        "draft-2020-12": {
          type: "object",
          properties: { fact: { type: "string" }, note: { type: "string" } },
          required: ["fact"],
        },
        default: {
          type: "object",
          properties: { fact: { type: "string" }, note: { type: ["string", "null"] } },
          required: ["fact", "note"],
          additionalProperties: false,
        },
      }),
    };

    const report = describeToolSchema(tool);
    const forced = report.issues.filter((issue) => issue.code === "optional-forced-required");

    expect(forced).toHaveLength(1);
    expect(forced[0]).toMatchObject({ path: "properties.note", severity: "warning" });
    expect(forced[0]?.targets).toEqual(["openai-strict", "anthropic", "google"]);
    expect(report.ok).toBe(true);
  });

  it("flags what OpenAI strict mode rejects: optional properties and open objects", () => {
    const report = describeToolSchema({
      name: "loose",
      description: "d",
      input: fixed({
        type: "object",
        properties: { a: { type: "string" }, b: { type: "number" } },
        required: ["a"],
      }),
    });

    const codes = report.issues.map((issue) => `${issue.code}:${issue.targets.join("+")}`);

    expect(codes).toContain("optional-not-required:openai-strict");
    expect(codes).toContain("missing-additional-properties-false:openai-strict");
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.severity).toBe("error");
  });

  it("flags unsupported keywords per target", () => {
    const report = describeToolSchema({
      name: "combo",
      description: "d",
      input: fixed({
        type: "object",
        properties: {
          value: { oneOf: [{ type: "string" }, { type: "number" }] },
          other: { allOf: [{ type: "string" }] },
        },
        required: ["value", "other"],
        additionalProperties: false,
      }),
    });

    const byMessage = (needle: string) =>
      report.issues.find((issue) => issue.code === "unsupported-keyword" && issue.message.includes(needle));

    expect(byMessage('"oneOf"')?.targets).toEqual(["openai-strict"]);
    expect(byMessage('"oneOf"')?.message).toContain("use anyOf");
    expect(byMessage('"allOf"')?.targets).toEqual(["openai-strict", "google"]);
  });

  it("checks only the requested targets", () => {
    const tool = {
      name: "combo",
      description: "d",
      input: fixed({ type: "object", properties: { v: { not: {} } }, required: ["v"] }),
    };

    expect(describeToolSchema(tool, { targets: ["anthropic"] }).issues).toEqual([]);
    expect(describeToolSchema(tool, { targets: ["google"] }).issues[0]?.code).toBe(
      "unsupported-keyword",
    );
  });

  it("flags oversized descriptions, invalid names and a non-object root", () => {
    const report = describeToolSchema(
      {
        name: "bad name!",
        description: "x".repeat(2000),
        input: fixed({ type: "array", items: { type: "string" } }),
      },
      { maxDescriptionChars: 1000 },
    );

    const codes = report.issues.map((issue) => issue.code);

    expect(codes).toContain("oversized-description");
    expect(codes).toContain("invalid-name");
    expect(codes).toContain("root-not-object");
    expect(report.descriptionChars).toBe(2000);
    expect(report.ok).toBe(false);
  });

  it("flags oversized property descriptions with their path", () => {
    const report = describeToolSchema(
      {
        name: "described",
        description: "d",
        input: fixed({
          ...strictObject,
          properties: { city: { type: "string", description: "y".repeat(600) } },
        }),
      },
      { targets: ["anthropic"] },
    );

    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      code: "oversized-description",
      path: "properties.city",
    });
  });

  it("flags a heavy definition against the token budget", () => {
    const report = describeToolSchema(
      { name: "heavy", description: "z".repeat(4000), input: fixed(strictObject) },
      { warnAboveTokens: 100, maxDescriptionChars: 10_000, targets: ["anthropic"] },
    );

    expect(report.tokens).toBeGreaterThan(100);
    expect(report.issues.map((issue) => issue.code)).toEqual(["heavy-definition"]);
  });

  it("honours charsPerToken in the estimate", () => {
    const tool = { name: "t", description: "d".repeat(400), input: fixed(strictObject) };

    expect(describeToolSchema(tool, { charsPerToken: 2 }).tokens).toBeGreaterThan(
      describeToolSchema(tool, { charsPerToken: 8 }).tokens,
    );
  });

  it("does not throw for a tool without an input schema", () => {
    const report = describeToolSchema({ name: "view_cart", description: "Show the cart" });

    expect(report.ok).toBe(true);
    expect(report.tokens).toBeGreaterThan(0);
  });
});

describe("describeToolSchemas() and formatToolSchemaReports()", () => {
  it("totals tokens and findings across tools", () => {
    const summary = describeToolSchemas([
      { name: "a", description: "d", input: fixed(strictObject) },
      {
        name: "b",
        description: "d",
        input: fixed({ type: "object", properties: { x: { type: "string" } } }),
      },
    ]);

    expect(summary.tools).toHaveLength(2);
    expect(summary.tokens).toBe(summary.tools[0]!.tokens + summary.tools[1]!.tokens);
    expect(summary.issueCount).toBe(summary.tools[1]!.issues.length);
    expect(summary.issueCount).toBeGreaterThan(0);
  });

  it("prints one block per tool with severity, targets and path", () => {
    const { tools } = describeToolSchemas([
      { name: "a", description: "d", input: fixed(strictObject) },
      {
        name: "b",
        description: "d",
        input: fixed({ type: "object", properties: { x: { type: "string" } }, required: [] }),
      },
    ]);

    const text = formatToolSchemaReports(tools);

    expect(text).toContain("a  ~");
    expect(text).toContain("b  ~");
    expect(text).toContain("(has errors)");
    expect(text).toContain("error [openai-strict] properties.x:");
  });
});
