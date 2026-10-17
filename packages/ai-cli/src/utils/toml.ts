/** A TOML value this writer supports. */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;

/** A TOML table. */
export type TomlTable = { [key: string]: TomlValue | undefined };

function isTable(value: TomlValue): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value);
}

/** A bare key when possible, else a quoted one. */
export function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

/** A TOML scalar or inline value. JSON string escapes are valid TOML basic-string escapes. */
function inlineValue(value: TomlValue): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("TOML cannot encode a non-finite number");
    }

    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map(inlineValue).join(", ")}]`;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, TomlValue] => entry[1] !== undefined,
  );

  return `{ ${entries.map(([key, item]) => `${tomlKey(key)} = ${inlineValue(item)}`).join(", ")} }`;
}

/**
 * Serialize a table to TOML: scalars and arrays first, then each nested
 * table as a `[dotted.header]` section. Enough for the CLI config files
 * this package writes (Codex and Mistral Vibe MCP sections).
 *
 * @example
 * toToml({ mcp_servers: { docs: { command: "npx", args: ["-y", "docs-mcp"] } } });
 * // [mcp_servers.docs]
 * // command = "npx"
 * // args = ["-y", "docs-mcp"]
 */
export function toToml(table: TomlTable, prefix: string[] = []): string {
  const lines: string[] = [];
  const nested: Array<[string, TomlTable]> = [];

  for (const [key, value] of Object.entries(table)) {
    if (value === undefined) {
      continue;
    }

    if (isTable(value)) {
      nested.push([key, value]);
      continue;
    }

    lines.push(`${tomlKey(key)} = ${inlineValue(value)}`);
  }

  const sections: string[] = [];

  if (lines.length > 0) {
    sections.push(
      (prefix.length > 0 ? `[${prefix.map(tomlKey).join(".")}]\n` : "") + lines.join("\n"),
    );
  }

  for (const [key, value] of nested) {
    const section = toToml(value, [...prefix, key]);

    if (section.length > 0) {
      sections.push(section.trimEnd());
    }
  }

  return sections.length > 0 ? `${sections.join("\n\n")}\n` : "";
}
