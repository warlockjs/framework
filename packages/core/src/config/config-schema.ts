/**
 * Typed, validated configuration.
 *
 * A config file (`src/config/<name>.ts`) may export a `configSchema` next to
 * its default export. Before the config is registered, at `warlock dev` boot,
 * on every config hot reload, and at production start, its value is validated
 * against that schema. Every problem across every config file is collected and
 * the app refuses to start with ONE error that lists them all — key path, what
 * is wrong, and the environment variable to set when the schema names one.
 * Values are never printed, so a secret cannot end up in the boot log.
 *
 * Config files without a `configSchema` load exactly as before.
 *
 * @example
 * // src/config/mail.ts
 * import { defineConfigSchema, env, type ConfigOf } from "@warlock.js/core";
 * import { v } from "@warlock.js/seal";
 *
 * export const configSchema = defineConfigSchema(
 *   v.object({ host: v.string(), port: v.int(), from: v.email() }),
 *   { env: { host: "MAIL_HOST", port: "MAIL_PORT", from: "MAIL_FROM" } },
 * );
 *
 * const mailConfig: ConfigOf<typeof configSchema> = {
 *   host: env("MAIL_HOST"),
 *   port: Number(env("MAIL_PORT", 587)),
 *   from: env("MAIL_FROM"),
 * };
 *
 * export default mailConfig;
 */

import type { BaseValidator, Infer } from "@warlock.js/seal";
import { validate } from "@warlock.js/seal";

const CONFIG_SCHEMA_MARKER: unique symbol = Symbol.for("warlock.js.configSchema");

export type ConfigSchemaOptions = {
  /**
   * The environment variable each key is read from, by key path
   * (`{ host: "MAIL_HOST", "smtp.password": "SMTP_PASSWORD" }`). Named in the
   * boot error so the fix is obvious.
   */
  env?: Readonly<Record<string, string>>;
};

/** A config file's schema, as returned by {@link defineConfigSchema}. */
export type ConfigSchema<TValidator extends BaseValidator = BaseValidator> = {
  readonly [CONFIG_SCHEMA_MARKER]: true;
  readonly validator: TValidator;
  readonly env: Readonly<Record<string, string>>;
};

/** The config value a schema describes, for typing the default export. */
export type ConfigOf<TSchema extends ConfigSchema> =
  TSchema extends ConfigSchema<infer TValidator> ? Infer.Input<TValidator> : never;

/** One problem found while validating configuration. */
export type ConfigIssue = {
  /** Config name (the file's key, e.g. `mail`). */
  config: string;
  /** Key path inside it (`smtp.host`); empty for the config value as a whole. */
  key: string;
  /** What is wrong, from the schema's rule. */
  message: string;
  /** The environment variable that feeds this key, when the schema names it. */
  env?: string;
};

/**
 * Declare the schema a config file's default export must satisfy. Export the
 * result as `configSchema` from the same file.
 */
export function defineConfigSchema<TValidator extends BaseValidator>(
  validator: TValidator,
  options: ConfigSchemaOptions = {},
): ConfigSchema<TValidator> {
  return { [CONFIG_SCHEMA_MARKER]: true, validator, env: { ...options.env } };
}

/** Whether a value is a {@link ConfigSchema}. */
export function isConfigSchema(value: unknown): value is ConfigSchema {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[CONFIG_SCHEMA_MARKER] === true
  );
}

/**
 * Thrown at boot when one or more config files do not satisfy their
 * `configSchema`. `issues` lists every problem; the message is ready to print.
 */
export class InvalidConfigError extends Error {
  public override readonly name = "InvalidConfigError";

  public constructor(public readonly issues: readonly ConfigIssue[]) {
    super(formatConfigIssues(issues));
  }
}

/** Render issues as the boot error message. */
export function formatConfigIssues(issues: readonly ConfigIssue[]): string {
  const lines = issues.map((issue) => {
    const path = issue.key ? `${issue.config}.${issue.key}` : issue.config;
    const hint = issue.env ? ` (set ${issue.env} in your environment or .env)` : "";
    return `  - ${path}: ${issue.message}${hint}`;
  });

  const count = issues.length === 1 ? "1 problem" : `${issues.length} problems`;

  return `Invalid configuration (${count}); the app cannot start until it is fixed:\n${lines.join("\n")}`;
}

/**
 * Validate one config value against its schema. Returns the issues found (an
 * empty list when it is valid, or when `schema` is not a config schema).
 */
export async function validateConfigValue(
  configName: string,
  value: unknown,
  schema: unknown,
): Promise<ConfigIssue[]> {
  if (!isConfigSchema(schema)) return [];

  const result = await validate(schema.validator, value);
  if (result.isValid) return [];

  if (result.errors.length === 0) {
    return [{ config: configName, key: "", message: "does not match its config schema" }];
  }

  return result.errors.map((error) => {
    const key = error.input ?? "";
    const env = schema.env[key];
    return {
      config: configName,
      key,
      message: error.error,
      ...(env !== undefined && { env }),
    };
  });
}

/** A loaded config module: its default export and, optionally, its `configSchema`. */
export type ConfigModuleEntry = {
  name: string;
  module: { default?: unknown; configSchema?: unknown };
};

/**
 * Validate every config module that exports a `configSchema` and throw one
 * {@link InvalidConfigError} listing all problems. Used by the production
 * config loader `warlock build` generates.
 */
export async function assertValidConfigModules(
  entries: readonly ConfigModuleEntry[],
): Promise<void> {
  const issues: ConfigIssue[] = [];

  for (const entry of entries) {
    issues.push(
      ...(await validateConfigValue(entry.name, entry.module.default, entry.module.configSchema)),
    );
  }

  if (issues.length > 0) throw new InvalidConfigError(issues);
}
