//#region ../../@warlock.js/core/src/http/errors/errors.ts
var HttpError = class extends Error {
	constructor(status, message, payload) {
		super(message);
		this.status = status;
		this.message = message;
		this.payload = payload;
		this.name = "HttpError";
	}
};
var ResourceNotFoundError = class extends HttpError {
	constructor(message, payload) {
		super(404, message, payload);
		this.payload = payload;
		this.name = "ResourceNotFoundError";
	}
};
var UnAuthorizedError = class extends HttpError {
	constructor(message, payload) {
		super(401, message, payload);
		this.payload = payload;
		this.name = "UnAuthorizedError";
	}
};
var ForbiddenError = class extends HttpError {
	constructor(message, payload) {
		super(403, message, payload);
		this.payload = payload;
		this.name = "ForbiddenError";
	}
};
var BadRequestError = class extends HttpError {
	constructor(message, payload) {
		super(400, message, payload);
		this.payload = payload;
		this.name = "BadRequestError";
	}
};
var ServerError = class extends HttpError {
	constructor(message, payload) {
		super(500, message, payload);
		this.payload = payload;
		this.name = "ServerError";
	}
};
var ConflictError = class extends HttpError {
	constructor(message, payload) {
		super(409, message, payload);
		this.payload = payload;
		this.name = "ConflictError";
	}
};
var NotAcceptableError = class extends HttpError {
	constructor(message, payload) {
		super(406, message, payload);
		this.payload = payload;
		this.name = "NotAcceptableError";
	}
};
var NotAllowedError = class extends HttpError {
	constructor(message, payload) {
		super(405, message, payload);
		this.payload = payload;
		this.name = "NotAllowedError";
	}
};
//#endregion
export { BadRequestError, ConflictError, ForbiddenError, HttpError, NotAcceptableError, NotAllowedError, ResourceNotFoundError, ServerError, UnAuthorizedError };

//# sourceMappingURL=errors.mjs.map