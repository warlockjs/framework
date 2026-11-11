/**
 * A client-sent `X-Request-Id` keys per-request bookkeeping (request log
 * scope, log correlation), so it must not be shared by two requests that are
 * answered at the same time.
 */
import { describe, expect, it } from "vitest";
import { Request } from "./request";
import { Response } from "./response";

function incoming(requestId: string) {
  const raw = { writableEnded: false, destroyed: false };
  const response = new Response();

  response.baseResponse = { raw } as never;

  const request = new Request();

  request.response = response;
  request.setRequest({
    method: "GET",
    url: "/x",
    headers: { "x-request-id": requestId },
    query: {},
    params: {},
  } as never);

  return { request, raw };
}

describe("inbound request id while another request uses it", () => {
  it("gives the second concurrent request its own id", () => {
    const first = incoming("shared-id-1");
    const second = incoming("shared-id-1");

    expect(first.request.id).toBe("shared-id-1");
    expect(second.request.id).not.toBe("shared-id-1");
  });

  it("reuses the id once the first response has ended", () => {
    const first = incoming("shared-id-2");

    first.raw.writableEnded = true;

    expect(incoming("shared-id-2").request.id).toBe("shared-id-2");
  });

  it("refuses the id of an in-flight request that generated its own id", () => {
    const victim = incoming("not valid because of spaces");

    expect(incoming(victim.request.id).request.id).not.toBe(victim.request.id);
  });
});
