/** Types a request whose signed-in user is the app's own User model. */
import type { Request, RequestHandler, RequestLocals } from "@warlock.js/core";
import type { User } from "app/users/models/user";

export type GuardedRequest<RequestPayload = unknown> = Request<RequestPayload> & {
  locals: RequestLocals & { user: User };
};

export type GuardedRequestHandler<RequestPayload = unknown> = RequestHandler<
  GuardedRequest<RequestPayload>
>;
