import { vi } from "vitest";

/**
 * Tiny in-memory stand-in for a Cascade `DriverContract`, scoped to exactly the
 * surface the seeders manager + `dropSeedRecords` touch:
 * `blueprint.tableExists`, `insert`, `insertMany`, `deleteMany`, and a chainable
 * `queryBuilder` supporting `.where().first()`, `.where().update()`, `.get()`.
 *
 * Rows get an auto-increment `id` so insertion order is observable (mirrors the
 * autoincrement primary key that backs reverse-order undo in production).
 *
 * NO real database here — Docker / Mongo / Postgres are not used.
 */
export type Row = Record<string, unknown> & { id: number };

export function createInMemoryDriver() {
  const tables = new Map<string, Row[]>();
  let nextId = 1;

  const ensure = (table: string): Row[] => {
    if (!tables.has(table)) {
      tables.set(table, []);
    }

    return tables.get(table)!;
  };

  const matches = (row: Row, filter: Record<string, unknown>): boolean => {
    return Object.entries(filter).every(([key, value]) => {
      // Compare loosely so a numeric id stored as text still matches.
      return String(row[key]) === String(value);
    });
  };

  const insert = vi.fn(async (table: string, document: Record<string, unknown>) => {
    const row = { id: nextId++, ...document } as Row;
    ensure(table).push(row);

    return { id: row.id };
  });

  const insertMany = vi.fn(
    async (table: string, documents: Record<string, unknown>[]) => {
      const rows: Row[] = [];

      for (const document of documents) {
        const row = { id: nextId++, ...document } as Row;
        ensure(table).push(row);
        rows.push(row);
      }

      return rows.map((row) => ({ id: row.id }));
    },
  );

  const deleteMany = vi.fn(
    async (table: string, filter: Record<string, unknown> = {}) => {
      const rows = ensure(table);
      const keep = rows.filter((row) => !matches(row, filter));
      const deleted = rows.length - keep.length;
      tables.set(table, keep);

      return deleted;
    },
  );

  const queryBuilder = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};

    const builder = {
      where(field: string, value: unknown) {
        filters[field] = value;

        return builder;
      },
      async first() {
        return ensure(table).find((row) => matches(row, filters)) ?? null;
      },
      async get() {
        return ensure(table).filter((row) => matches(row, filters));
      },
      async update(changes: Record<string, unknown>) {
        let updated = 0;

        for (const row of ensure(table)) {
          if (matches(row, filters)) {
            Object.assign(row, changes);
            updated++;
          }
        }

        return updated;
      },
    };

    return builder;
  });

  const blueprint = {
    tableExists: vi.fn(async (table: string) => tables.has(table)),
    listTables: vi.fn(async () => [...tables.keys()]),
  };

  const driver = {
    blueprint,
    insert,
    insertMany,
    deleteMany,
    queryBuilder,
    truncateTable: vi.fn(async (table: string) => {
      const count = ensure(table).length;
      tables.set(table, []);

      return count;
    }),
  };

  return {
    driver,
    tables,
    /** Pre-create a table so `tableExists` returns true (skips migration run). */
    createTable(name: string) {
      ensure(name);
    },
    rowsOf(table: string): Row[] {
      return ensure(table);
    },
  };
}

export type InMemoryDriver = ReturnType<typeof createInMemoryDriver>;
