/**
 * Pool-local pg type parsers: int8 as a safe number and `date` as UTC midnight,
 * without changing pg's process-wide registry.
 */

type PgPoolConfig = import("pg").PoolConfig;
type PgTypes = Pick<typeof import("pg").types, "getTypeParser">;

const POSTGRES_INT8_OID = 20;
const POSTGRES_INT8_ARRAY_OID = 1016;
const POSTGRES_DATE_OID = 1082;
const POSTGRES_DATE_ARRAY_OID = 1182;
const PLAIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert a PostgreSQL int8 result to a number only when it can be represented
 * exactly. PostgreSQL sends int8 values as strings by default to avoid silently
 * losing precision above JavaScript's safe-integer limit.
 */
export function parsePostgresInt8(value: string | null): number | string | null {
  if (value === null) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : value;
}

/**
 * Read a `date` as UTC midnight of its calendar day, so the value does not
 * depend on the Node process time zone. `infinity`, `-infinity` and BC dates
 * are left to pg's own parser.
 */
function parsePostgresDate(value: string, fallback: (value: string) => unknown): unknown {
  return PLAIN_DATE_PATTERN.test(value) ? new Date(`${value}T00:00:00.000Z`) : fallback(value);
}

/** Split a one-dimensional `date[]` text literal (`{2026-08-24,NULL,"0044-03-15 BC"}`) into its elements. */
function splitPostgresDateArray(value: string): Array<string | null> {
  const body = value.slice(1, -1);
  if (body === "") {
    return [];
  }

  return body.split(",").map((item) => {
    if (item === "NULL") {
      return null;
    }

    return item.startsWith('"') ? item.slice(1, -1) : item;
  });
}

/**
 * Build pool-local type overrides without changing pg's process-wide registry.
 */
export function createPostgresTypes(types: PgTypes): NonNullable<PgPoolConfig["types"]> {
  return {
    getTypeParser(oid, format) {
      if (oid === POSTGRES_INT8_OID) {
        return parsePostgresInt8;
      }

      if ((oid as number) === POSTGRES_INT8_ARRAY_OID) {
        const parseArray = types.getTypeParser(oid, format);
        return (value: string) => {
          const array = parseArray(value);
          return Array.isArray(array) ? array.map(parsePostgresInt8) : array;
        };
      }

      if ((oid as number) === POSTGRES_DATE_OID) {
        const fallback = types.getTypeParser(oid, format) as (value: string) => unknown;
        return (value: string) => (value === null ? null : parsePostgresDate(value, fallback));
      }

      if ((oid as number) === POSTGRES_DATE_ARRAY_OID) {
        const fallback = types.getTypeParser(POSTGRES_DATE_OID as never, format) as (
          value: string,
        ) => unknown;
        return (value: string) =>
          value === null
            ? null
            : splitPostgresDateArray(value).map((item) =>
                item === null ? null : parsePostgresDate(item, fallback),
              );
      }

      return types.getTypeParser(oid, format);
    },
  };
}
