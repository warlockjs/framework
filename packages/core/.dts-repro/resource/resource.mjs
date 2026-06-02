import { useRequestStore } from "../http/context/request-context.mjs";
import { ResourceFieldBuilder } from "./resource-field-builder.mjs";
import { Model } from "@warlock.js/cascade";
import { get, isLazy, set } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/resource/resource.ts
/**
* Maximum recursion depth for self-referencing fields.
* Prevents runaway serialization on deep trees or circular data.
*/
const MAX_SELF_DEPTH = 10;
var Resource = class Resource {
	static {
		this.schema = {};
	}
	static {
		this.parsedSchema = {};
	}
	/**
	* Normalize a raw schema into parsedSchema.
	* Converts string cast types (including suffixes) and tuples into pre-built builders.
	* Other entry types (ResourceConstructor, resolver functions, ResourceArraySchema) are kept as-is.
	*/
	static normalizeSchema(schema) {
		const parsed = {};
		for (const [key, value] of Object.entries(schema)) if (value === "self" || value === "self[]") parsed[key] = value;
		else if (isLazy(value)) parsed[key] = value;
		else if (typeof value === "string") parsed[key] = ResourceFieldBuilder.fromCastType(value);
		else if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string") {
			const builder = ResourceFieldBuilder.fromCastType(value[1]);
			builder.setInputKey(value[0]);
			parsed[key] = builder;
		} else parsed[key] = value;
		return parsed;
	}
	/**
	* Constructor
	*/
	constructor(originalData) {
		this.originalData = originalData;
		this.resource = {};
		this.data = {};
		if (this.originalData instanceof Model) this.resource = this.originalData.data;
		else if (this.originalData instanceof Resource) this.resource = this.originalData.data;
		else this.resource = this.originalData;
	}
	/**
	* Convert resource to JSON
	*/
	toJSON() {
		this.boot();
		this.transformOutput();
		this.extend();
		return this.data;
	}
	/**
	* Boot method
	* Called before transforming the resource
	*/
	boot() {}
	/**
	* Transform resource to output using the pre-normalized parsedSchema.
	* Builders handle their own array/nullable logic internally.
	* ResourceConstructor and ResourceArraySchema handle arrays in transformValue.
	*/
	transformOutput() {
		const localeCode = useRequestStore()?.request?.locale;
		const parsedSchema = this.constructor.parsedSchema;
		for (const [outputKey, outputSettings] of Object.entries(parsedSchema)) {
			const inputValue = this.get(outputKey);
			const outputValue = this.transformValue(inputValue, outputSettings, localeCode);
			if (outputValue !== void 0) this.set(outputKey, outputValue);
		}
	}
	/**
	* Transform the given value with given type
	*/
	transform(value, type, locale) {
		return new ResourceFieldBuilder(type).transform(value, locale);
	}
	/**
	* Transform the given value for the given output setting.
	* After normalization, string cast types no longer reach here — they are pre-converted to builders.
	*/
	transformValue(value, outputSettings, locale) {
		let outputValue;
		if (isLazy(outputSettings)) return this.transformValue(value, outputSettings.resolve(), locale);
		if (outputSettings === "self" || outputSettings === "self[]") outputValue = this.transformSelfReference(value, outputSettings === "self[]");
		else if (typeof outputSettings === "function" && outputSettings.prototype instanceof Resource) {
			if (!value) return;
			if (Array.isArray(value)) {
				if (value.length === 0) return;
				outputValue = value.map((item) => new outputSettings(item).toJSON()).filter((v) => v !== void 0);
			} else outputValue = new outputSettings(value).toJSON();
		} else if (typeof outputSettings === "function") outputValue = outputSettings.call(this, value, this);
		else if (outputSettings instanceof ResourceFieldBuilder) {
			const inputKey = outputSettings.getInputKey();
			outputValue = outputSettings.transform(inputKey ? this.get(inputKey) : value, locale);
		} else if (typeof outputSettings === "object" && outputSettings !== null && "__type" in outputSettings && outputSettings.__type === "arrayOf") if (Array.isArray(value)) outputValue = value.map((item) => this.transformArrayItem(item, outputSettings.schema, locale)).filter((v) => v !== void 0);
		else outputValue = this.transformArrayItem(value, outputSettings.schema, locale);
		return outputValue;
	}
	/**
	* Extend the resource output
	*/
	extend() {}
	/**
	* Transform a self-referencing field value.
	*
	* @example
	* // Single: parent: "self"
	* // Array:  children: "self[]"
	*/
	transformSelfReference(value, isArray) {
		if (isArray) return Array.isArray(value) ? value.map((item) => this.resolveSelf(item)).filter((v) => v !== void 0) : void 0;
		return this.resolveSelf(value);
	}
	/**
	* Resolve a single self-reference value.
	* Uses identity-based cycle detection (id/_id) and a max depth guard.
	*/
	resolveSelf(value) {
		if (!value) return void 0;
		const identity = value.id ?? value._id ?? value;
		const seen = this._selfSeen ?? /* @__PURE__ */ new Set();
		if (seen.has(identity) || seen.size >= MAX_SELF_DEPTH) return;
		seen.add(identity);
		const SelfConstructor = this.constructor;
		const child = new SelfConstructor(value);
		child._selfSeen = seen;
		return child.toJSON();
	}
	/**
	* Transform a single array item according to the given schema
	*/
	transformArrayItem(item, schema, locale) {
		const transformedItem = {};
		for (const [outputKey, outputSettings] of Object.entries(schema)) {
			let fieldKey = outputKey;
			let valueTransformType = outputSettings;
			if (Array.isArray(outputSettings)) {
				fieldKey = outputSettings[0];
				valueTransformType = outputSettings[1];
			}
			const inputValue = get(item, fieldKey);
			const outputValue = this.transformValue(inputValue, valueTransformType, locale);
			if (outputValue !== void 0) set(transformedItem, outputKey, outputValue);
		}
		return transformedItem;
	}
	/**
	* Get a input value for the given key
	*/
	get(key, defaultValue) {
		return get(this.resource, key, defaultValue);
	}
	/**
	* Set the given value for the given field
	*/
	set(key, value) {
		set(this.data, key, value);
		return this;
	}
	/**
	* Create an array schema for transforming array items
	*/
	arrayOf(schema) {
		return {
			__type: "arrayOf",
			schema
		};
	}
	/**
	* Get a string field builder
	*/
	string(inputKey) {
		return this.fieldBuilder("string", inputKey);
	}
	/**
	* Get a date field builder
	*/
	date(inputKey) {
		return this.fieldBuilder("date", inputKey);
	}
	/**
	* Get a localized field builder
	*/
	localized(inputKey) {
		return this.fieldBuilder("localized", inputKey);
	}
	/**
	* Get a url field builder
	*/
	url(inputKey) {
		return this.fieldBuilder("url", inputKey);
	}
	/**
	* Get a uploadsUrl field builder
	*/
	uploadsUrl(inputKey) {
		return this.fieldBuilder("uploadsUrl", inputKey);
	}
	/**
	* Get a number field builder
	*/
	number(inputKey) {
		return this.fieldBuilder("number", inputKey);
	}
	/**
	* Get a boolean field builder
	*/
	boolean(inputKey) {
		return this.fieldBuilder("boolean", inputKey);
	}
	/**
	* Get a float field builder
	*/
	float(inputKey) {
		return this.fieldBuilder("float", inputKey);
	}
	/**
	* Get a int field builder
	*/
	int(inputKey) {
		return this.fieldBuilder("int", inputKey);
	}
	/**
	* New field builder
	*/
	fieldBuilder(type, inputKey) {
		const builder = new ResourceFieldBuilder(type);
		if (inputKey) builder.setInputKey(inputKey);
		return builder;
	}
};
//#endregion
export { Resource };

//# sourceMappingURL=resource.mjs.map