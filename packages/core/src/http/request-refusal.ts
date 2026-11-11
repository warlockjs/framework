/**
 * An error Fastify answers with the given status before any route runs (body
 * parsers, server-level hooks). Fastify reads `statusCode` for the response
 * status and echoes `code` in the JSON body, so clients can branch on the code
 * and `http.errorResponse` can format it like any other 4xx.
 */
export type RequestRefusal = Error & { statusCode: number; code: string };

export function createRequestRefusal(
  statusCode: number,
  code: string,
  message: string,
): RequestRefusal {
  return Object.assign(new Error(message), { statusCode, code });
}
