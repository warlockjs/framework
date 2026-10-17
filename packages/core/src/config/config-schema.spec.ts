import { v } from "@warlock.js/seal";
import { describe, expect, it } from "vitest";
import {
  assertValidConfigModules,
  type ConfigOf,
  defineConfigSchema,
  formatConfigIssues,
  InvalidConfigError,
  isConfigSchema,
  validateConfigValue,
} from "./config-schema";

const mailSchema = defineConfigSchema(
  v.object({
    host: v.string(),
    port: v.int(),
    smtp: v.object({ password: v.string() }),
  }),
  { env: { host: "MAIL_HOST", "smtp.password": "SMTP_PASSWORD" } },
);

const valid: ConfigOf<typeof mailSchema> = {
  host: "smtp.example.com",
  port: 587,
  smtp: { password: "s3cret" },
};

describe("config schemas", () => {
  it("recognises schemas made by defineConfigSchema only", () => {
    expect(isConfigSchema(mailSchema)).toBe(true);
    expect(isConfigSchema(v.object({}))).toBe(false);
    expect(isConfigSchema(undefined)).toBe(false);
  });

  it("accepts a value that satisfies the schema", async () => {
    expect(await validateConfigValue("mail", valid, mailSchema)).toEqual([]);
  });

  it("ignores a module with no config schema", async () => {
    expect(await validateConfigValue("mail", { anything: true }, undefined)).toEqual([]);
  });

  it("reports every missing or invalid key with its env variable", async () => {
    const issues = await validateConfigValue(
      "mail",
      { host: undefined, port: "587", smtp: { password: undefined } },
      mailSchema,
    );

    expect(issues.map((issue) => [issue.key, issue.env])).toEqual([
      ["host", "MAIL_HOST"],
      ["port", undefined],
      ["smtp.password", "SMTP_PASSWORD"],
    ]);
    for (const issue of issues) {
      expect(issue.config).toBe("mail");
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it("throws one error for all config files and never prints values", async () => {
    const error = await assertValidConfigModules([
      {
        name: "mail",
        module: {
          default: { host: "", port: 25, smtp: { password: "hunter2-secret" } },
          configSchema: mailSchema,
        },
      },
      { name: "app", module: { default: { name: "x" } } },
      {
        name: "payments",
        module: {
          default: { apiKey: 1234567 },
          configSchema: defineConfigSchema(v.object({ apiKey: v.string() }), {
            env: { apiKey: "PAYMENTS_API_KEY" },
          }),
        },
      },
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidConfigError);
    const invalid = error as InvalidConfigError;
    expect(invalid.issues.map((issue) => `${issue.config}.${issue.key}`)).toEqual([
      "mail.host",
      "payments.apiKey",
    ]);
    expect(invalid.message).toContain("Invalid configuration (2 problems)");
    expect(invalid.message).toContain("mail.host:");
    expect(invalid.message).toContain("(set MAIL_HOST in your environment or .env)");
    expect(invalid.message).toContain("(set PAYMENTS_API_KEY in your environment or .env)");
    expect(invalid.message).not.toContain("1234567");
    expect(invalid.message).not.toContain("hunter2");
  });

  it("passes when every schema is satisfied", async () => {
    await expect(
      assertValidConfigModules([
        { name: "mail", module: { default: valid, configSchema: mailSchema } },
      ]),
    ).resolves.toBeUndefined();
  });

  it("formats a single issue", () => {
    expect(formatConfigIssues([{ config: "app", key: "", message: "is required" }])).toBe(
      "Invalid configuration (1 problem); the app cannot start until it is fixed:\n  - app: is required",
    );
  });
});
