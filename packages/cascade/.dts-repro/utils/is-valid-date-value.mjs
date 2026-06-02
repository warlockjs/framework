//#region ../../@warlock.js/cascade/src/utils/is-valid-date-value.ts
const isoRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
/**
* Check if the given value is a valid date value
*/
function isValidDateValue(value) {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return false;
		const date = new Date(value);
		return !Number.isNaN(date.getTime());
	}
	if (typeof value !== "string") return false;
	if (!isoRegex.test(value)) return false;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return false;
	const [y, m, d] = value.split("T")[0].split("-").map(Number);
	return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}
//#endregion
export { isValidDateValue };

//# sourceMappingURL=is-valid-date-value.mjs.map