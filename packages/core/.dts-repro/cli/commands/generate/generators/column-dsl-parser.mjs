//#region ../../@warlock.js/core/src/cli/commands/generate/generators/column-dsl-parser.ts
const typeMapping = {
	text: "text",
	string: "string",
	integer: "integer",
	int: "integer",
	bigInteger: "bigInteger",
	bigInt: "bigInteger",
	boolean: "boolCol",
	bool: "boolCol",
	uuid: "uuid",
	timestamp: "timestamp",
	date: "date",
	json: "json",
	object: "objectCol",
	decimal: "decimal",
	float: "float",
	enum: "enumCol",
	set: "setCol",
	blob: "blobCol",
	binary: "blobCol"
};
/**
* Parses a subset DSL for column schemas:
* "phone:text:nullable,price:decimal:notNullable:unsigned"
*/
function parseColumnDsl(input) {
	if (!input) return [];
	return input.split(",").map((c) => c.trim()).filter(Boolean).map((colStr) => {
		const parts = colStr.split(":").map((p) => p.trim());
		const name = parts[0];
		const rawType = parts[1] || "string";
		const helper = typeMapping[rawType] || rawType;
		const modifiers = [];
		for (let i = 2; i < parts.length; i++) {
			let modifier = parts[i];
			modifiers.push(`.${modifier}()`);
		}
		return {
			name,
			helper,
			modifiers
		};
	});
}
//#endregion
export { parseColumnDsl };

//# sourceMappingURL=column-dsl-parser.mjs.map