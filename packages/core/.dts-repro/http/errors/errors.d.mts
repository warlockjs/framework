//#region ../../@warlock.js/core/src/http/errors/errors.d.ts
declare class HttpError extends Error {
  status: number;
  message: string;
  payload?: any | undefined;
  constructor(status: number, message: string, payload?: any | undefined);
}
declare class ResourceNotFoundError extends HttpError {
  payload?: any | undefined;
  constructor(message: string, payload?: any | undefined);
}
declare class UnAuthorizedError extends HttpError {
  payload?: any | undefined;
  constructor(message: string, payload?: any | undefined);
}
declare class ForbiddenError extends HttpError {
  payload?: any | undefined;
  constructor(message: string, payload?: any | undefined);
}
declare class BadRequestError extends HttpError {
  payload?: any | undefined;
  constructor(message: string, payload?: any | undefined);
}
declare class ServerError extends HttpError {
  payload?: any | undefined;
  constructor(message: string, payload?: any | undefined);
}
declare class ConflictError extends HttpError {
  payload?: any | undefined;
  constructor(message: string, payload?: any | undefined);
}
declare class NotAcceptableError extends HttpError {
  payload?: any | undefined;
  constructor(message: string, payload?: any | undefined);
}
declare class NotAllowedError extends HttpError {
  payload?: any | undefined;
  constructor(message: string, payload?: any | undefined);
}
//#endregion
export { BadRequestError, ConflictError, ForbiddenError, HttpError, NotAcceptableError, NotAllowedError, ResourceNotFoundError, ServerError, UnAuthorizedError };
//# sourceMappingURL=errors.d.mts.map