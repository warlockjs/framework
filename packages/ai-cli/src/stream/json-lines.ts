import type { CliParsedEvent, CliStreamParser } from "../contracts";

/** A plain JSON object. */
export type JsonRecord = Record<string, unknown>;

/** `value` as a JSON object, or `undefined`. */
export function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

/** `value` as an array, or an empty array. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A string field, or `undefined`. */
export function stringField(record: JsonRecord | undefined, key: string): string | undefined {
  const value = record?.[key];

  return typeof value === "string" ? value : undefined;
}

/** A finite number field, or `undefined`. */
export function numberField(record: JsonRecord | undefined, key: string): number | undefined {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A nested object field, or `undefined`. */
export function recordField(record: JsonRecord | undefined, key: string): JsonRecord | undefined {
  return asRecord(record?.[key]);
}

/** Tool output as text: strings verbatim, text-block arrays joined, anything else as JSON. */
export function outputText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    const texts = value.map((item) => {
      const block = asRecord(item);
      const text = stringField(block, "text");

      return text ?? (typeof item === "string" ? item : JSON.stringify(item));
    });

    return texts.join("\n");
  }

  return JSON.stringify(value);
}

/** Parse one line as a JSON object; anything else (banners, blank lines) is `undefined`. */
export function parseJsonLine(line: string): JsonRecord | undefined {
  const trimmed = line.trim();

  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

/**
 * Build a parser for a JSONL/NDJSON stream. Non-JSON lines (progress
 * banners, warnings) are skipped; each JSON object goes to `onRecord`.
 * `onEnd` may flush buffered state when stdout closes.
 *
 * @example
 * const parser = jsonLinesParser((record) =>
 *   record.type === "text" ? [{ type: "message", text: String(record.text), delta: false }] : [],
 * );
 */
export function jsonLinesParser(
  onRecord: (record: JsonRecord) => CliParsedEvent[],
  onEnd: () => CliParsedEvent[] = () => [],
): CliStreamParser {
  return {
    line(line: string): CliParsedEvent[] {
      const record = parseJsonLine(line);

      return record === undefined ? [] : onRecord(record);
    },
    end: onEnd,
  };
}
