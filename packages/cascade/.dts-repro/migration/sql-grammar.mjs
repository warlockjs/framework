//#region ../../@warlock.js/cascade/src/migration/sql-grammar.ts
/**
* Parses and sorts SQL statements globally based on their execution phase,
* and classifies statements by their semantic type.
*/
var SQLGrammar = class {
	/**
	* Determine the execution phase of a SQL statement (1–6).
	*
	* Phase ordering ensures DDL operations run in dependency-safe order
	* regardless of which migration file they originate from.
	*
	* | Phase | Statements                                    |
	* |-------|-----------------------------------------------|
	* | 1     | CREATE EXTENSION, TYPE, DOMAIN, SCHEMA        |
	* | 2     | CREATE TABLE                                  |
	* | 3     | ADD COLUMN, ADD PRIMARY KEY                   |
	* | 4     | CREATE INDEX, ADD FOREIGN KEY                 |
	* | 5     | DROP COLUMN, ALTER COLUMN, DROP TABLE         |
	* | 6     | Raw / unclassified                            |
	*
	* @example
	* SQLGrammar.phase("CREATE EXTENSION IF NOT EXISTS vector"); // => 1
	* SQLGrammar.phase("ALTER TABLE users ADD COLUMN email TEXT"); // => 3
	*/
	static phase(sql) {
		const s = sql.trim().toUpperCase();
		if (s.startsWith("CREATE EXTENSION") || s.startsWith("CREATE TYPE") || s.startsWith("CREATE DOMAIN") || s.startsWith("CREATE SCHEMA")) return 1;
		if (s.startsWith("CREATE TABLE")) return 2;
		if (s.startsWith("ALTER TABLE")) {
			if (s.includes("ADD CONSTRAINT") && s.includes("FOREIGN KEY")) return 4;
			if (s.includes("DROP COLUMN") || s.includes("DROP CONSTRAINT") || s.includes("ALTER COLUMN")) return 5;
			if (s.includes("ADD COLUMN")) return 3;
			if (s.includes("ADD CONSTRAINT") && s.includes("PRIMARY KEY")) return 3;
		}
		if (s.startsWith("CREATE INDEX") || s.startsWith("CREATE UNIQUE INDEX")) return 4;
		if (s.startsWith("DROP TABLE") || s.startsWith("TRUNCATE TABLE") || s.startsWith("DROP INDEX")) return 5;
		return 6;
	}
	/**
	* Classify a SQL statement into its semantic statement type.
	*
	* This is independent of execution phase — it identifies *what* a statement
	* does, not *when* it should run. Use this for pre-flight checks, dry-run
	* display, selective filtering, and extension detection.
	*
	* @example
	* SQLGrammar.classify("CREATE EXTENSION IF NOT EXISTS vector");
	* // => "CREATE_EXTENSION"
	*
	* SQLGrammar.classify("ALTER TABLE users ADD COLUMN email TEXT");
	* // => "ADD_COLUMN"
	*/
	static classify(sql) {
		const s = sql.trim().toUpperCase();
		if (s.startsWith("CREATE EXTENSION")) return "CREATE_EXTENSION";
		if (s.startsWith("CREATE SCHEMA")) return "CREATE_SCHEMA";
		if (s.startsWith("CREATE TYPE")) return "CREATE_TYPE";
		if (s.startsWith("CREATE DOMAIN")) return "CREATE_DOMAIN";
		if (s.startsWith("CREATE TABLE")) return "CREATE_TABLE";
		if (s.startsWith("DROP TABLE")) return "DROP_TABLE";
		if (s.startsWith("TRUNCATE TABLE")) return "TRUNCATE_TABLE";
		if (s.startsWith("DROP INDEX")) return "DROP_INDEX";
		if (s.startsWith("CREATE UNIQUE INDEX")) return "CREATE_UNIQUE_INDEX";
		if (s.startsWith("CREATE INDEX")) return "CREATE_INDEX";
		if (s.startsWith("ALTER TABLE")) {
			if (s.includes("ADD CONSTRAINT") && s.includes("FOREIGN KEY")) return "ADD_FOREIGN_KEY";
			if (s.includes("DROP CONSTRAINT") && s.includes("FOREIGN KEY")) return "DROP_FOREIGN_KEY";
			if (s.includes("ADD CONSTRAINT") && s.includes("PRIMARY KEY")) return "ADD_PRIMARY_KEY";
			if (s.includes("DROP CONSTRAINT")) return "DROP_PRIMARY_KEY";
			if (s.includes("ADD COLUMN")) return "ADD_COLUMN";
			if (s.includes("DROP COLUMN")) return "DROP_COLUMN";
			if (s.includes("RENAME COLUMN")) return "RENAME_COLUMN";
			if (s.includes("RENAME TO")) return "RENAME_TABLE";
			if (s.includes("ALTER COLUMN")) return "MODIFY_COLUMN";
		}
		return "RAW";
	}
	/**
	* Extract the extension name from a CREATE EXTENSION statement.
	*
	* Returns undefined if the statement is not a CREATE EXTENSION statement
	* or the name cannot be parsed.
	*
	* @example
	* SQLGrammar.extractExtensionName("CREATE EXTENSION IF NOT EXISTS vector");
	* // => "vector"
	*
	* SQLGrammar.extractExtensionName("CREATE EXTENSION postgis");
	* // => "postgis"
	*/
	static extractExtensionName(sql) {
		return sql.trim().match(/^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1]?.toLowerCase();
	}
	/**
	* Sort an array of tagged SQL statements by phase, then creation date, then migration name.
	*/
	static sort(statements) {
		return statements.slice().sort((a, b) => {
			if (a.phase !== b.phase) return a.phase - b.phase;
			let dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
			let dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
			if (isNaN(dateA)) dateA = 0;
			if (isNaN(dateB)) dateB = 0;
			if (dateA !== dateB) return dateA - dateB;
			const nameA = a.migrationName || "";
			const nameB = b.migrationName || "";
			return nameA.localeCompare(nameB);
		});
	}
};
//#endregion
export { SQLGrammar };

//# sourceMappingURL=sql-grammar.mjs.map