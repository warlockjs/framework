/**
 * Throw from a `serve` callback (`authorize`, `toInput`,
 * `session.createId`, `session.loadHistory`) to refuse the request with a
 * specific HTTP status. The client receives `status` with the JSON body
 * `{ "error": code }`; `message` stays on the server. Any other error
 * thrown there is answered with `500 { "error": "internal_error" }`.
 *
 * @example
 * ai.serve(agent, {
 *   session: {
 *     createId: (req) => {
 *       const id = sessionIdFromCookie(req);
 *       if (!id) throw new ServeHttpError(401, "unauthorized", "no session cookie");
 *       return id;
 *     },
 *   },
 * });
 */
export class ServeHttpError extends Error {
  public override name = "ServeHttpError";

  /** HTTP status sent to the client (a 4xx or 5xx code; anything else becomes 500). */
  public readonly status: number;

  /** Machine-readable code sent to the client as `{ "error": code }`. */
  public readonly code: string;

  public constructor(status: number, code: string, message: string = code) {
    super(message);
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    this.code = code;
  }
}
