import type { TaggedSQL } from "./types";

/**
 * Parses and sorts SQL statements globally based on their execution phase.
 */
export class SQLGrammar {
  /**
   * Classify a raw SQL statement into one of the 6 execution phases.
   *
   * @param sql The SQL statement
   * @returns Phase 1-6
   */
  public static classify(sql: string): 1 | 2 | 3 | 4 | 5 | 6 {
    const s = sql.trim().toUpperCase();

    // Phase 1: Preparation (Extensions, Enums, Domains, Types)
    if (
      s.startsWith("CREATE EXTENSION") ||
      s.startsWith("CREATE TYPE") ||
      s.startsWith("CREATE DOMAIN") ||
      s.startsWith("CREATE SCHEMA")
    ) {
      return 1;
    }

    // Phase 2: Table Creation (CREATE TABLE ...)
    if (s.startsWith("CREATE TABLE")) {
      return 2;
    }

    // Phase 3: Column Creation (ALTER TABLE ... ADD COLUMN ... without references)
    // Actually, our PostgresSQLSerializer generates ADD COLUMN, DROP COLUMN, etc.
    // Let's distinguish destructive and non-destructive ALTERs.
    if (s.startsWith("ALTER TABLE")) {
      if (s.includes("ADD CONSTRAINT") && s.includes("FOREIGN KEY")) {
        // Phase 4: Indexes & Constraints
        return 4;
      }
      if (s.includes("DROP COLUMN") || s.includes("DROP CONSTRAINT") || s.includes("ALTER COLUMN")) {
        // Phase 5: Destructive Column Modification
        return 5;
      }
      if (s.includes("ADD COLUMN")) {
        // Phase 3: Column Addition
        return 3;
      }
      if (s.includes("ADD CONSTRAINT") && s.includes("PRIMARY KEY")) {
        // Primary keys can be phase 3 or 4, usually 3 is fine before FKs
        return 3;
      }
    }

    // Phase 4: Indexes & Constraints
    if (s.startsWith("CREATE INDEX") || s.startsWith("CREATE UNIQUE INDEX")) {
      return 4;
    }

    // Phase 5: Table and Database Drops/Destructive Operations
    if (s.startsWith("DROP TABLE") || s.startsWith("TRUNCATE TABLE") || s.startsWith("DROP INDEX")) {
      return 5;
    }

    // Phase 6: Raw/Unclassified statements (Data manipulation, triggers, procedures, views)
    return 6;
  }

  /**
   * Sort an array of tagged SQL statements sequentially by phase, then by creation date, then by migration name.
   */
  public static sort(statements: TaggedSQL[]): TaggedSQL[] {
    return statements.slice().sort((a, b) => {
      // 1. Sort by Phase (ascending)
      if (a.phase !== b.phase) {
        return a.phase - b.phase;
      }

      // 2. Sort by CreatedAt (within same phase)
      let dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      let dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (isNaN(dateA)) dateA = 0;
      if (isNaN(dateB)) dateB = 0;

      if (dateA !== dateB) {
        return dateA - dateB;
      }

      // 3. Sort by Migration Name (tie-breaker)
      const nameA = a.migrationName || "";
      const nameB = b.migrationName || "";
      return nameA.localeCompare(nameB);
    });
  }
}
