import { uploadsUrl, url } from "../utils/urls.mjs";
import { storage } from "../storage/storage.mjs";
import "../storage/index.mjs";
import { isObject } from "@mongez/supportive-is";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
//#region ../../@warlock.js/core/src/resource/resource-field-builder.ts
dayjs.extend(relativeTime);
var ResourceFieldBuilder = class ResourceFieldBuilder {
	/**
	* Constructor
	*/
	constructor(type) {
		this.type = type;
		this.isNullable = false;
		this.isArrayField = false;
		this.dateFormat = "DD-MM-YYYY hh:mm:ss A";
		this.dateOptionsInput = {
			format: true,
			timestamp: true,
			timezone: false,
			locale: false,
			offset: false,
			humanTime: true,
			iso: true
		};
	}
	/**
	* Parse a cast type string (including suffixes) into a configured builder.
	* Suffix order: [] before ? (e.g. "string[]?")
	* Parsing strips right-to-left: ? first, then [].
	*/
	static fromCastType(castType) {
		let baseType = castType;
		let nullable = false;
		let isArray = false;
		if (baseType.endsWith("?")) {
			nullable = true;
			baseType = baseType.slice(0, -1);
		}
		if (baseType.endsWith("[]")) {
			isArray = true;
			baseType = baseType.slice(0, -2);
		}
		const builder = new ResourceFieldBuilder(baseType);
		if (nullable) builder.nullable();
		if (isArray) builder.array();
		return builder;
	}
	/**
	* Set input key
	* Will be used in transformation if provided
	*/
	setInputKey(key) {
		this.inputKeyToUse = key;
		return this;
	}
	/**
	* Add a condition before transforming the value
	*/
	when(condition) {
		this.condition = condition;
		return this;
	}
	/**
	* Set whether the value is nullable
	*/
	nullable() {
		this.isNullable = true;
		return this;
	}
	/**
	* Mark this field as an array
	* transform() will map over each element using the base type
	*/
	array() {
		this.isArrayField = true;
		return this;
	}
	/**
	* Get input key
	*/
	getInputKey() {
		return this.inputKeyToUse;
	}
	/**
	* Set default value
	*/
	default(value) {
		this.defaultValue = value;
		return this;
	}
	/**
	* Set field format
	*/
	format(format) {
		this.dateFormat = format;
		return this;
	}
	/**
	* Set date options
	* This will override current date options
	*/
	dateOptions(options) {
		this.dateOptionsInput = options;
		return this;
	}
	/**
	* Transform the value.
	* When isArrayField is true, maps over each element using transformSingleValue.
	*/
	transform(value, locale) {
		if (this.isArrayField) {
			if (!Array.isArray(value)) return this.isNullable ? null : [];
			return value.map((item) => this.transformSingleValue(item, locale)).filter((v) => v !== void 0);
		}
		return this.transformSingleValue(value, locale);
	}
	/**
	* Transform a single value according to the base type.
	*/
	transformSingleValue(value, locale) {
		if (value === void 0 || value === null) return this.isNullable ? null : this.defaultValue;
		if (this.condition && !this.condition()) return this.isNullable ? null : this.defaultValue;
		switch (this.type) {
			case "string": return String(value);
			case "number": {
				const num = Number(value);
				return isNaN(num) ? this.isNullable ? null : void 0 : num;
			}
			case "boolean": return Boolean(value);
			case "float": {
				const float = parseFloat(value);
				return isNaN(float) ? this.isNullable ? null : void 0 : float;
			}
			case "int": {
				const int = parseInt(value);
				return isNaN(int) ? this.isNullable ? null : void 0 : int;
			}
			case "date": return this.transformDate(value, locale);
			case "localized": return this.transformLocalized(value, locale);
			case "url": return url(value);
			case "uploadsUrl": return uploadsUrl(value);
			case "storageUrl": return storage.url(value);
			case "object": return isObject(value) && !Array.isArray(value) && Object.keys(value).length > 0 ? value : this.isNullable ? null : void 0;
			case "array": return Array.isArray(value) ? value : this.isNullable ? null : void 0;
		}
	}
	/**
	* Transform date value
	*/
	transformDate(value, locale) {
		if (typeof this.dateOptionsInput === "string") {
			if (this.dateOptionsInput === "format") return dayjs(value).format(this.dateFormat);
			if (this.dateOptionsInput === "iso") return dayjs(value).toISOString();
			if (this.dateOptionsInput === "timestamp") return dayjs(value).valueOf();
			if (this.dateOptionsInput === "humanTime") return dayjs(value).fromNow();
			if (this.dateOptionsInput === "locale") {
				if (!locale) return dayjs(value).format(this.dateFormat);
				return dayjs(value).locale(locale).format(this.dateFormat);
			}
		}
		const output = {};
		let dayjsObject = dayjs(value?.iso || value);
		if (locale) dayjsObject = dayjsObject.locale(locale);
		if (this.dateOptionsInput.iso) output.iso = dayjsObject.toISOString();
		if (this.dateOptionsInput.format) output.format = dayjsObject.format(this.dateFormat);
		if (this.dateOptionsInput.timestamp) output.timestamp = dayjsObject.valueOf();
		if (this.dateOptionsInput.humanTime) output.humanTime = dayjsObject.fromNow();
		if (this.dateOptionsInput.locale) output.locale = dayjsObject.format(this.dateFormat);
		if (this.dateOptionsInput.iso) output.iso = dayjsObject.toISOString();
		return output;
	}
	/**
	* Transform localized value
	*/
	transformLocalized(value, locale) {
		if (typeof value === "string") return value;
		if (!locale) return value[0]?.value || value;
		return value.find((item) => item.localeCode === locale)?.value;
	}
};
//#endregion
export { ResourceFieldBuilder };

//# sourceMappingURL=resource-field-builder.mjs.map