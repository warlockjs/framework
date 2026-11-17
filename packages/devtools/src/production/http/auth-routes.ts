import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DevtoolsAuthenticated, DevtoolsAuthStep, DevtoolsRequestMeta } from "../auth/types";
import type { DevtoolsAuditType, DevtoolsAuthStepResult, DevtoolsRole } from "../contracts";
import { DevtoolsApiError } from "../errors";
import { readCookie, sessionCookie, sessionCookieName } from "./cookie";
import { devtoolsRequestContext } from "./context";
import type { MountProductionDevtoolsDeps } from "./types";

const MAX_TEXT = 1024;
const MAX_EMAIL = 320;
const MAX_CODE = 128;
const MAX_TOKEN = 512;
const ROLES: readonly DevtoolsRole[] = ["admin", "viewer"];

/** A request body that is a plain JSON object, or `input.invalid`. */
function bodyOf(request: FastifyRequest): Record<string, unknown> {
  const body: unknown = request.body;

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new DevtoolsApiError("input.invalid");
  }

  return body as Record<string, unknown>;
}

/** A non-empty string field no longer than `max`, or `input.invalid`. */
function text(body: Record<string, unknown>, key: string, max = MAX_TEXT): string {
  const value = body[key];

  if (typeof value !== "string" || value === "" || value.length > max) {
    throw new DevtoolsApiError("input.invalid");
  }

  return value;
}

/** An optional string field; `undefined` when absent, `input.invalid` when present but wrong. */
function optionalText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): string | undefined {
  return body[key] === undefined ? undefined : text(body, key, max);
}

function email(body: Record<string, unknown>): string {
  const value = text(body, "email", MAX_EMAIL).trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+$/.test(value)) throw new DevtoolsApiError("input.invalid");

  return value;
}

function role(body: Record<string, unknown>): DevtoolsRole {
  const value = body.role;

  if (typeof value !== "string" || !ROLES.includes(value as DevtoolsRole)) {
    throw new DevtoolsApiError("input.invalid");
  }

  return value as DevtoolsRole;
}

function purpose(body: Record<string, unknown>): "register" | "login" {
  const value = body.purpose;

  if (value !== "register" && value !== "login") throw new DevtoolsApiError("input.invalid");

  return value;
}

function idParam(request: FastifyRequest): string {
  const { id } = (request.params ?? {}) as { id?: unknown };

  if (typeof id !== "string" || id === "" || id.length > MAX_CODE) {
    throw new DevtoolsApiError("input.invalid");
  }

  return id;
}

/** The `current` password of a request that may have no body (a DELETE). */
function currentOf(request: FastifyRequest): string | undefined {
  return request.body === undefined || request.body === null
    ? undefined
    : optionalText(bodyOf(request), "current");
}

/** What the gate stored, for a route that is never reached without it. */
function contextOf(request: FastifyRequest): {
  meta: DevtoolsRequestMeta;
  auth: DevtoolsAuthenticated;
} {
  const context = devtoolsRequestContext(request);

  if (!context?.authenticated) throw new Error("A dashboard route ran without its session.");

  return { meta: context.meta, auth: context.authenticated };
}

function metaOf(request: FastifyRequest): DevtoolsRequestMeta {
  const context = devtoolsRequestContext(request);

  if (!context) throw new Error("A dashboard route ran without its request context.");

  return context.meta;
}

/**
 * Registers the sign-in, account and admin routes. All decisions live in the
 * auth service; the handlers read the body, call it and answer. The gate
 * (`mountProductionDevtools`) has already checked the session, role, origin
 * and CSRF token by the time a handler runs.
 */
export function registerAuthRoutes(
  server: FastifyInstance,
  deps: MountProductionDevtoolsDeps,
): void {
  const { auth, store, state, production } = deps;
  const cookieOptions = { path: production.path, secure: production.requireHttps };

  /** Sets the new session cookie when the step minted one; answers the step. */
  const answerStep = (
    reply: FastifyReply,
    step: DevtoolsAuthStep,
    recoveryCodes?: string[] | null,
  ): DevtoolsAuthStepResult & { recoveryCodes?: string[] } => {
    if (step.token !== null) reply.header("set-cookie", sessionCookie(step.token, cookieOptions));

    return {
      stage: step.stage,
      csrf: step.csrf,
      ...(recoveryCodes ? { recoveryCodes } : {}),
    };
  };

  /** The stage and CSRF token of the session in force, for answers that do not change it. */
  const currentStep = (authenticated: DevtoolsAuthenticated): DevtoolsAuthStepResult => ({
    stage: authenticated.stage,
    csrf: auth.csrfToken(authenticated.session),
  });

  const clearCookie = (reply: FastifyReply): void => {
    reply.header("set-cookie", sessionCookie(null, cookieOptions));
  };

  const requireAdmin = (authenticated: DevtoolsAuthenticated): void => {
    if (authenticated.account.role !== "admin" || authenticated.stage !== "active") {
      throw new DevtoolsApiError("role.forbidden");
    }
  };

  // ---- Public ------------------------------------------------------------

  server.get("/api/auth/session", async (request, reply) => {
    const token = readCookie(request.headers.cookie, sessionCookieName(production.requireHttps));
    const authenticated = token === undefined ? null : await auth.authenticate(token);

    // A cookie that no longer matches a session is dead weight: clear it.
    if (token !== undefined && authenticated === null) clearCookie(reply);

    return auth.sessionView(authenticated);
  });

  server.post("/api/auth/login", async (request, reply) => {
    const body = bodyOf(request);
    const step = await auth.login(
      { email: email(body), password: text(body, "password") },
      metaOf(request),
    );

    return answerStep(reply, step);
  });

  server.post("/api/auth/setup", async (request, reply) => {
    const body = bodyOf(request);
    const step = await auth.setup(
      { token: text(body, "token", MAX_TOKEN), password: text(body, "password") },
      metaOf(request),
    );

    return answerStep(reply, step);
  });

  server.post("/api/auth/invite/inspect", async (request) => {
    const body = bodyOf(request);

    return auth.inspectInvite(text(body, "token", MAX_TOKEN));
  });

  server.post("/api/auth/invite/accept", async (request, reply) => {
    const body = bodyOf(request);
    const step = await auth.acceptInvite(
      { token: text(body, "token", MAX_TOKEN), password: text(body, "password") },
      metaOf(request),
    );

    return answerStep(reply, step);
  });

  // ---- Sign-in steps and the account (a session is required) --------------

  const changePassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const { auth: authenticated, meta } = contextOf(request);
    const body = bodyOf(request);
    const current = optionalText(body, "current");
    const step = await auth.changePassword(
      authenticated,
      { ...(current === undefined ? {} : { current }), password: text(body, "password") },
      meta,
    );

    return answerStep(reply, step);
  };

  const startTotp = async (request: FastifyRequest) => {
    const { auth: authenticated, meta } = contextOf(request);

    return auth.startTotp(authenticated, meta);
  };

  const confirmTotp = async (request: FastifyRequest, reply: FastifyReply) => {
    const { auth: authenticated, meta } = contextOf(request);
    const body = bodyOf(request);
    const result = await auth.confirmTotp(
      authenticated,
      text(body, "code", MAX_CODE),
      meta,
      optionalText(body, "current"),
    );

    return answerStep(reply, result.step, result.recoveryCodes);
  };

  const passkeyOptions = async (request: FastifyRequest) => {
    const { auth: authenticated, meta } = contextOf(request);

    return auth.passkeyOptions(authenticated, purpose(bodyOf(request)), meta);
  };

  const passkeyVerify = async (request: FastifyRequest, reply: FastifyReply) => {
    const { auth: authenticated, meta } = contextOf(request);
    const body = bodyOf(request);

    if (body.response === null || typeof body.response !== "object") {
      throw new DevtoolsApiError("input.invalid");
    }

    const result = await auth.verifyPasskey(
      authenticated,
      purpose(body),
      body.response,
      meta,
      optionalText(body, "current"),
    );

    if (result.step === null) {
      return {
        ...currentStep(authenticated),
        ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}),
      };
    }

    return answerStep(reply, result.step, result.recoveryCodes);
  };

  server.post("/api/auth/password", changePassword);
  server.post("/api/auth/totp/start", startTotp);
  server.post("/api/auth/totp/confirm", confirmTotp);
  server.post("/api/auth/passkey/options", passkeyOptions);
  server.post("/api/auth/passkey/verify", passkeyVerify);

  server.post("/api/auth/mfa", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);
    const body = bodyOf(request);
    const code = optionalText(body, "code", MAX_CODE);
    const recoveryCode = optionalText(body, "recoveryCode", MAX_CODE);

    if ((code === undefined) === (recoveryCode === undefined)) {
      throw new DevtoolsApiError("input.invalid");
    }

    const step = await auth.verifySecondFactor(
      authenticated,
      code === undefined ? { recoveryCode: recoveryCode as string } : { code },
      meta,
    );

    return answerStep(reply, step);
  });

  server.post("/api/auth/logout", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    await auth.logout(authenticated, meta);
    clearCookie(reply);

    return reply.code(204).send();
  });

  server.get("/api/account", async (request) => {
    const { auth: authenticated } = contextOf(request);

    return auth.accountView(authenticated.account);
  });

  server.get("/api/account/sessions", async (request) => {
    const { auth: authenticated } = contextOf(request);

    return auth.listSessions(authenticated);
  });

  server.delete("/api/account/sessions/:id", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    await auth.revokeSession(authenticated, idParam(request), meta);

    return reply.code(204).send();
  });

  server.post("/api/account/password", changePassword);
  server.post("/api/account/totp/start", startTotp);
  server.post("/api/account/totp/confirm", confirmTotp);

  server.delete("/api/account/totp", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    await auth.removeTotp(authenticated, meta, currentOf(request));

    return reply.code(204).send();
  });

  server.post("/api/account/recovery-codes", async (request) => {
    const { auth: authenticated, meta } = contextOf(request);
    // No code: a passkey step-up in this session stands in for it.
    const codes = await auth.regenerateRecoveryCodes(
      authenticated,
      optionalText(bodyOf(request), "code", MAX_CODE) ?? "",
      meta,
    );

    return { codes };
  });

  server.post("/api/account/passkey/options", passkeyOptions);
  server.post("/api/account/passkey/verify", passkeyVerify);

  server.delete("/api/account/passkeys/:id", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    await auth.removePasskey(authenticated, idParam(request), meta, currentOf(request));

    return reply.code(204).send();
  });

  // ---- Admin ---------------------------------------------------------------

  server.get("/api/admin/users", async (request) => {
    const { auth: authenticated } = contextOf(request);

    return auth.listUsers(authenticated);
  });

  server.post("/api/admin/invites", async (request) => {
    const { auth: authenticated, meta } = contextOf(request);
    const body = bodyOf(request);

    return auth.createInvite(authenticated, { email: email(body), role: role(body) }, meta);
  });

  server.delete("/api/admin/invites/:id", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    await auth.revokeInvite(authenticated, idParam(request), meta);

    return reply.code(204).send();
  });

  server.patch("/api/admin/users/:id", async (request) => {
    const { auth: authenticated, meta } = contextOf(request);

    return auth.setRole(authenticated, idParam(request), role(bodyOf(request)), meta);
  });

  server.delete("/api/admin/users/:id", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    await auth.removeAccount(authenticated, idParam(request), meta);

    return reply.code(204).send();
  });

  server.post("/api/admin/users/:id/reset-mfa", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    await auth.resetSecondFactor(authenticated, idParam(request), meta);

    return reply.code(204).send();
  });

  server.post("/api/admin/users/:id/sign-out", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    await auth.signOutAccount(authenticated, idParam(request), meta);

    return reply.code(204).send();
  });

  server.get<{ Querystring: Record<string, string | undefined> }>(
    "/api/admin/audit",
    async (request) => {
      const { auth: authenticated } = contextOf(request);

      requireAdmin(authenticated);

      const query = request.query;
      const types = query.type
        ?.split(",")
        .map((type) => type.trim())
        .filter((type) => type !== "");
      const before = query.before === undefined ? undefined : Number(query.before);
      const limit = query.limit === undefined ? 100 : Number(query.limit);

      if (
        (before !== undefined && !Number.isFinite(before)) ||
        !Number.isInteger(limit) ||
        limit < 1
      ) {
        throw new DevtoolsApiError("input.invalid");
      }

      return store.audit.list({
        ...(types && types.length > 0 ? { types: types as DevtoolsAuditType[] } : {}),
        ...(query.account ? { accountId: query.account } : {}),
        ...(before === undefined ? {} : { before }),
        limit: Math.min(limit, 500),
      });
    },
  );

  server.post("/api/admin/disable", async (request, reply) => {
    const { auth: authenticated, meta } = contextOf(request);

    if (bodyOf(request).confirm !== "disable") throw new DevtoolsApiError("input.invalid");

    await auth.disableDashboard(authenticated, meta);
    // This process closes at once; the others within the state cache time.
    state.invalidate();

    return reply.code(204).send();
  });
}
