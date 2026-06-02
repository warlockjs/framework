//#region ../../@warlock.js/core/src/mail/types.ts
/**
* Mail error class
*/
var MailError = class extends Error {
	constructor(message, code, originalError) {
		super(message);
		this.name = "MailError";
		this.code = code;
		this.originalError = originalError;
	}
};
//#endregion
export { MailError };

//# sourceMappingURL=types.mjs.map