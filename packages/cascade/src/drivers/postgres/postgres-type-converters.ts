/**
 * Column-type driven conversion of PostgreSQL result values (K1:B29).
 *
 * Conversion is keyed on the column's `dataTypeID` from the pg result
 * `fields`, never on what a string value looks like.
 */

export type PostgresColumnTypes = ReadonlyMap<string, number>;

type Converter = (value: string) => unknown;

const toDate: Converter = (value) => new Date(value);

const toSafeInteger: Converter = (value) => {
  const n = Number(value);
  // Beyond 2^53 a number would silently lose digits; keep the exact string.
  return Number.isSafeInteger(n) ? n : value;
};

const toFiniteNumber: Converter = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
};

/** OID → converter. json/jsonb are already parsed by pg, so they are absent. */
const CONVERTERS = new Map<number, Converter>([
  [20, toSafeInteger], // int8
  [1700, toFiniteNumber], // numeric
  [1082, toDate], // date
  [1114, toDate], // timestamp
  [1184, toDate], // timestamptz
]);

/** Built-in OIDs whose text must never be reinterpreted (text, varchar, bpchar, name, json, jsonb, uuid). */
const LITERAL_TEXT_OIDS = new Set([18, 19, 25, 114, 142, 1042, 1043, 2950, 3802]);

/** pgvector columns use an extension OID (not fixed), returned as '[n1,n2,...]'. */
function parseVector(value: string): number[] | undefined {
  // '[' = 91, ']' = 93
  if (value.charCodeAt(0) !== 91 || value.charCodeAt(value.length - 1) !== 93) return undefined;

  const parts = value.slice(1, -1).split(",");
  const nums = new Array<number>(parts.length);

  for (let i = 0; i < parts.length; i++) {
    const n = +(parts[i] ?? "");
    if (!Number.isFinite(n)) return undefined;
    nums[i] = n;
  }

  return nums;
}

/**
 * Convert one value by its column type. Values of a known text type, and
 * non-string values, are returned untouched.
 */
export function convertPostgresValue(value: unknown, dataTypeID: number | undefined): unknown {
  if (typeof value !== "string" || dataTypeID === undefined) return value;

  const converter = CONVERTERS.get(dataTypeID);
  if (converter) return converter(value);

  if (LITERAL_TEXT_OIDS.has(dataTypeID)) return value;

  // Unknown (extension) type: only pgvector's bracketed list is re-inflated.
  return parseVector(value) ?? value;
}
