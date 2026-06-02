import { toCamelCase, toKebabCase, toSnakeCase, toStudlyCase } from "@mongez/reinforcements";
import pluralize from "pluralize-esm";
//#region ../../@warlock.js/core/src/cli/commands/generate/utils/name-parser.ts
/**
* Parse module path from input
* Examples:
* - "users/create-user" → { module: "users", name: "create-user" }
* - "create-user" → { module: undefined, name: "create-user" }
*/
function parseModulePath(input) {
	const parts = input.split("/");
	if (parts.length === 1) return { name: parts[0] };
	return {
		module: parts[0],
		name: parts.slice(1).join("/")
	};
}
/**
* Parse name into all case variants
*/
function parseName(input) {
	return new Name(input);
}
/**
* Get plural name
*/
function pluralName(name) {
	return new Name(pluralize(name));
}
/**
* Get singular name
*/
function singularName(name) {
	return new Name(pluralize.singular(name));
}
var Name = class Name {
	constructor(raw) {
		this.raw = raw;
		this.parsedData = {
			kebab: toKebabCase(raw),
			camel: toCamelCase(raw),
			snake: toSnakeCase(raw),
			studly: toStudlyCase(raw)
		};
	}
	get plural() {
		return new Name(pluralize(this.raw));
	}
	get singular() {
		return new Name(pluralize.singular(this.raw));
	}
	get pascal() {
		return this.parsedData.studly;
	}
	get camel() {
		return this.parsedData.camel;
	}
	get kebab() {
		return this.parsedData.kebab;
	}
	get snake() {
		return this.parsedData.snake;
	}
};
//#endregion
export { parseModulePath, parseName, pluralName, singularName };

//# sourceMappingURL=name-parser.mjs.map