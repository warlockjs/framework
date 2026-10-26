import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Registry symbol stamped on the Fastify request while a core-level refusal is
 * being answered by a refusal-capable route. Registered (`Symbol.for`) so the
 * dev server's two module copies agree on the slot.
 */
export const REFUSAL_STATUS = Symbol.for("warlock.http.refusal-status");

type RefusalCarrier = { [REFUSAL_STATUS]?: number };

/** Answers a refusal, resolving `true` when a route took over the response. */
export type RefusalDispatcher = (
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
) => Promise<boolean>;

let dispatcher: RefusalDispatcher | undefined;

/** @internal The router installs itself here; nothing else should. */
export function setRefusalDispatcher(next: RefusalDispatcher | undefined): void {
  dispatcher = next;
}

/**
 * Hand a core-level 4xx refusal (a path-traversal 403 on the public mount, a
 * malformed URL 400) to the route marked `handlesRefusals`, when there is one
 * and the request is a document request. Resolves `false` when nothing took
 * over, in which case the caller keeps answering with its own JSON body.
 */
export async function dispatchRefusal(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
): Promise<boolean> {
  if (dispatcher === undefined || status < 400 || status > 499) return false;

  try {
    return await dispatcher(request, reply, status);
  } catch {
    return false;
  }
}

/**
 * The refused status when this request is a core-level refusal being rendered by
 * a `handlesRefusals` route, otherwise `undefined`. Accepts a Warlock `Request`
 * or the Fastify request itself.
 */
export function refusalStatusOf(request: object | undefined): number | undefined {
  if (request === undefined) return undefined;

  const direct = (request as RefusalCarrier)[REFUSAL_STATUS];

  if (direct !== undefined) return direct;

  const base = (request as { baseRequest?: RefusalCarrier }).baseRequest;

  return base?.[REFUSAL_STATUS];
}

/** True when `text/html` is named explicitly (and not with `q=0`) in an `Accept` header. */
export function requestAcceptsHtml(accept: string | string[] | undefined): boolean {
  const header = Array.isArray(accept) ? accept.join(",") : accept;

  if (!header) return false;

  for (const entry of header.split(",")) {
    const [type = "", ...parameters] = entry.split(";");

    if (type.trim().toLowerCase() !== "text/html") continue;

    const quality = parameters.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith("q="));

    if (quality !== undefined && Number.parseFloat(quality.slice(2)) === 0) continue;

    return true;
  }

  return false;
}
