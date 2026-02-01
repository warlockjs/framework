import type { ParsedName } from "../types";

/**
 * Parse module path from input
 * Examples:
 * - "users/create-user" → { module: "users", name: "create-user" }
 * - "create-user" → { module: undefined, name: "create-user" }
 */
export function parseModulePath(input: string): { module?: string; name: string } {
  const parts = input.split("/");

  if (parts.length === 1) {
    return { name: parts[0] };
  }

  return {
    module: parts[0],
    name: parts.slice(1).join("/"),
  };
}

/**
 * Convert string to PascalCase
 * Examples:
 * - "create-user" → "CreateUser"
 * - "create_user" → "CreateUser"
 * - "createUser" → "CreateUser"
 */
export function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
    .replace(/^(.)/, (char) => char.toUpperCase());
}

/**
 * Convert string to camelCase
 * Examples:
 * - "create-user" → "createUser"
 * - "CreateUser" → "createUser"
 */
export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Convert string to kebab-case
 * Examples:
 * - "CreateUser" → "create-user"
 * - "createUser" → "create-user"
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Convert string to snake_case
 * Examples:
 * - "CreateUser" → "create_user"
 * - "create-user" → "create_user"
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

/**
 * Parse name into all case variants
 */
export function parseName(input: string, module?: string): ParsedName {
  const kebab = toKebabCase(input);

  return {
    raw: input,
    pascal: toPascalCase(input),
    camel: toCamelCase(input),
    kebab,
    snake: toSnakeCase(input),
    module,
  };
}
