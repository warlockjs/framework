import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { listPanelInfos } from "../../panels";
import { registerAiRoutes } from "../../server/ai-routes";
import { registerShapeExplainRoute } from "../../server/explain-route";
import { registerInsightsRoutes } from "../../server/insights-routes";
import { registerLogRoutes } from "../../server/log-routes";
import { registerMailRoutes } from "../../server/mail-routes";
import { registerOpenApiRoutes } from "../../server/openapi-routes";
import { registerPanelRoutes } from "../../server/panel-routes";
import { registerRequestsRoutes } from "../../server/requests-routes";
import { registerRouteRoutes } from "../../server/route-routes";
import { registerStreamRoute } from "../../server/stream-route";
import type { DevtoolsStreamSession, MountDevtoolsRoutesDeps } from "../../server/types";
import { registerUiAssets } from "../../server/ui-assets";
import type { DevtoolsAuthenticated, DevtoolsRequestMeta } from "../auth/types";
import { DevtoolsApiError, createErrorRef, DEVTOOLS_ERROR_MESSAGES } from "../errors";
import { createAccessLookup, productionRouteAccess } from "./access";
import { registerAuthRoutes } from "./auth-routes";
import { resolveClient } from "./client";
import { setDevtoolsRequestContext, devtoolsRequestContext } from "./context";
import { readCookie, sessionCookieName } from "./cookie";
import { DASHBOARD_CSP, DASHBOARD_HEADERS, DOCS_CSP } from "./headers";
import { DEVTOOLS_CSRF_HEADER } from "./constants";
import { ipMatches } from "./ip";
import type { DevtoolsRouteAccess, MountProductionDevtoolsDeps } from "./types";

/** Open live streams a session may hold, and an instance may serve. */
const MAX_STREAMS_PER_SESSION = 3;
const MAX_STREAMS_PER_INSTANCE = 50;

const MAX_USER_AGENT = 200;

/** Methods that never change state. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The routes of the opt-in API documentation pages (they keep a CSP of their own). */
const DOCS_PATTERNS = new Set(["/docs", "/docs/swagger"]);

/** The mail preview's HTML: framed by the dashboard, with a policy of its own. */
const MAIL_HTML_PATTERN = "/api/mails/:id/html";

/** Which tab a route belongs to: a route of a tab that is off answers the uniform 404. */
const TAB_OF_ROUTE: readonly (readonly [prefix: string, tab: string])[] = [
  ["/api/resources", "resources"],
  ["/api/queries", "queries"],
  ["/api/routes/stats", "routes"],
  ["/api/routes", "routes"],
  ["/api/health", "health"],
  ["/api/errors", "errors"],
  ["/api/jobs", "jobs"],
  ["/api/logs", "logs"],
  ["/api/requests", "requests"],
  ["/api/mails", "mail"],
  ["/api/ai/agent-runs", "agents"],
  ["/api/ai", "ai"],
  ["/api/openapi.json", "api"],
  ["/api/postman.json", "api"],
  ["/docs", "api"],
];

function tabOf(pattern: string): string | undefined {
  return TAB_OF_ROUTE.find(
    ([prefix]) => pattern === prefix || pattern.startsWith(`${prefix}/`),
  )?.[1];
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Requests that were answered with the uniform 404: they get none of the dashboard's headers. */
const uniformNotFound = new WeakSet<FastifyRequest>();

/**
 * The origin the browser must send for an unsafe request: `production.origin`,
 * else the scheme and host the request was addressed to.
 */
function originAllowed(request: FastifyRequest, expected: string): boolean {
  const origin = request.headers.origin;
  const site = request.headers["sec-fetch-site"];

  if (site !== undefined && site !== "same-origin") return false;

  if (origin !== undefined) return origin.toLowerCase() === expected.toLowerCase();

  // No Origin header: a same-origin fetch from an older browser. Accept it only with the fetch metadata that proves it.
  return site === "same-origin";
}

function hasBody(request: FastifyRequest): boolean {
  const length = request.headers["content-length"];

  return (
    (length !== undefined && length !== "0") || request.headers["transfer-encoding"] !== undefined
  );
}

function isJson(request: FastifyRequest): boolean {
  return /^application\/json\s*(;|$)/i.test(request.headers["content-type"] ?? "");
}

function sessionAccessOk(
  access: Exclude<DevtoolsRouteAccess, { type: "public" }>,
  stage: string,
): boolean {
  if (stage === "active") return true;

  return access.type === "pending" && (access.stages as readonly string[]).includes(stage);
}

/**
 * Mounts the production monitor under `production.path` in one encapsulated
 * Fastify context: the gate (uniform 404, HTTPS, allowed IPs, open state),
 * session and role checks from the access table, CSRF and origin checks,
 * security headers and CORS stripping, the auth/account/admin routes, and
 * the shared data routes of the enabled tabs.
 */
export function mountProductionDevtools(
  server: FastifyInstance,
  deps: MountProductionDevtoolsDeps,
): void {
  const { production, auth, state, store } = deps;
  const prefix = production.path;
  const cookieName = sessionCookieName(production.requireHttps);
  const enabledTabs = new Set(deps.builtInPanels);
  const lookup = createAccessLookup(productionRouteAccess(deps.panels.map((panel) => panel.id)));
  const streamsPerSession = new Map<string, number>();
  let streamsInstance = 0;
  let lastWarningAt = 0;

  const warn = (message: string): void => {
    // At most one line a minute: a database outage must not flood the log.
    const now = Date.now();

    if (now - lastWarningAt < 60_000) return;

    lastWarningAt = now;
    deps.warn?.(message);
  };

  const notFound = (request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    uniformNotFound.add(request);

    // The app's own not-found handler answers, so the reply is the one any unknown URL gets.
    reply.callNotFound();

    // Returning the reply is what stops an async hook's lifecycle.
    return reply;
  };

  const streamSession = async (request: FastifyRequest): Promise<DevtoolsStreamSession> => {
    const authenticated = devtoolsRequestContext(request)?.authenticated;

    if (!authenticated) throw new Error("A dashboard stream was opened without a session.");

    const sessionId = authenticated.session.id;
    const token = readCookie(request.headers.cookie, cookieName);
    const open = streamsPerSession.get(sessionId) ?? 0;

    if (open >= MAX_STREAMS_PER_SESSION || streamsInstance >= MAX_STREAMS_PER_INSTANCE) {
      throw new DevtoolsApiError("stream.too-many");
    }

    streamsPerSession.set(sessionId, open + 1);
    streamsInstance += 1;

    let released = false;

    return {
      role: authenticated.account.role,
      logLevels: production.logLevels,
      headers: DASHBOARD_HEADERS,
      // Reads the session without touching `lastSeenAt`: a stream left open must not keep the session alive.
      async revalidate() {
        if (token === undefined || !(await state.isOpen())) return false;

        const session = await store.sessions.findByTokenHash(tokenHash(token));
        const now = Date.now();

        if (
          session === null ||
          session.stage !== "active" ||
          now >= session.expiresAt ||
          now - session.lastSeenAt >= production.session.idleMinutes * 60_000
        ) {
          return false;
        }

        return (await store.accounts.findById(session.accountId)) !== null;
      },
      release() {
        if (released) return;

        released = true;
        streamsInstance -= 1;

        const left = (streamsPerSession.get(sessionId) ?? 1) - 1;

        if (left <= 0) streamsPerSession.delete(sessionId);
        else streamsPerSession.set(sessionId, left);
      },
    };
  };

  // The route deps the shared route files read: the development deps, completed.
  const routes: MountDevtoolsRoutesDeps = {
    ...deps.routes,
    mode: "production",
    isDevelopment: () => false,
    instance: deps.instance,
    insights: deps.insights,
    collector: deps.routes.collector ?? deps.capture.collector,
    requests: deps.routes.requests ?? deps.capture.requests,
    explainShape: deps.routes.explainShape ?? ((shapeId) => deps.capture.explain(shapeId)),
    builtInPanels: deps.builtInPanels,
    streamSession,
  };

  server.register(
    async (instance) => {
      // ---- The gate -------------------------------------------------------
      instance.addHook("onRequest", async (request, reply) => {
        let open: boolean;

        try {
          open = await state.isOpen();
        } catch (error) {
          // Fail closed: when the state cannot be read the dashboard does not answer.
          warn(
            `The devtools dashboard state could not be read and the dashboard is closed: ${error instanceof Error ? error.message : String(error)}`,
          );
          open = false;
        }

        if (!open) return notFound(request, reply);

        const client = resolveClient(request, production.trustedProxies);

        if (production.requireHttps && client.proto !== "https") return notFound(request, reply);

        if (production.allowedIps.length > 0 && !ipMatches(client.ip, production.allowedIps)) {
          return notFound(request, reply);
        }

        const userAgent = request.headers["user-agent"];
        const expectedOrigin = production.origin ?? `${client.proto}://${client.host}`;
        const meta: DevtoolsRequestMeta = {
          ip: client.ip,
          userAgent: typeof userAgent === "string" ? userAgent.slice(0, MAX_USER_AGENT) : null,
          origin: expectedOrigin,
          hostname: client.hostname,
        };

        const routeUrl = request.routeOptions.url ?? "";
        const relative = routeUrl.startsWith(prefix) ? routeUrl.slice(prefix.length) : routeUrl;
        // The shell is registered once for both `<path>` and `<path>/`.
        const pattern = relative === "" ? "/" : relative;
        const method = request.method;

        // The bare path (no trailing slash) redirects to the shell's address. The
        // address as sent: core's server drops a trailing slash before routing,
        // so the rewritten URL of `<path>/` is the bare path too.
        const sent = request.originalUrl ?? request.raw.url ?? "";

        if (sent.split("?")[0] === prefix) {
          setDevtoolsRequestContext(request, {
            client,
            meta,
            rule: undefined,
            pattern,
            authenticated: null,
          });

          if (method !== "GET" && method !== "HEAD") return notFound(request, reply);

          const search = sent.includes("?") ? `?${sent.split("?").slice(1).join("?")}` : "";

          return reply.redirect(`${prefix}/${search}`, 308);
        }

        const tab = tabOf(pattern);

        if (tab !== undefined && !enabledTabs.has(tab)) return notFound(request, reply);

        const rule = lookup(method, pattern);
        const access: DevtoolsRouteAccess = rule?.access ?? { type: "admin" };
        let authenticated: DevtoolsAuthenticated | null = null;

        if (access.type !== "public") {
          try {
            authenticated = await auth.authenticate(readCookie(request.headers.cookie, cookieName));
          } catch (error) {
            warn(
              `The devtools session could not be checked and the request was refused: ${error instanceof Error ? error.message : String(error)}`,
            );

            return notFound(request, reply);
          }

          if (authenticated === null || !sessionAccessOk(access, authenticated.stage)) {
            return notFound(request, reply);
          }

          if (access.type === "admin" && authenticated.account.role !== "admin") {
            setDevtoolsRequestContext(request, { client, meta, rule, pattern, authenticated });
            throw new DevtoolsApiError("role.forbidden");
          }
        }

        setDevtoolsRequestContext(request, { client, meta, rule, pattern, authenticated });

        if (SAFE_METHODS.has(method)) return;

        if (!originAllowed(request, expectedOrigin)) {
          if (authenticated === null) return notFound(request, reply);

          throw new DevtoolsApiError("csrf.invalid");
        }

        if (hasBody(request) && !isJson(request)) throw new DevtoolsApiError("input.invalid");

        if (authenticated !== null) {
          const header = request.headers[DEVTOOLS_CSRF_HEADER];

          if (!auth.verifyCsrf(authenticated, Array.isArray(header) ? header[0] : header)) {
            throw new DevtoolsApiError("csrf.invalid");
          }
        }
      });

      // ---- Headers --------------------------------------------------------
      instance.addHook("onSend", async (request, reply, payload) => {
        // The uniform 404 must look like any other 404 of the app.
        if (uniformNotFound.has(request)) return payload;

        for (const name of Object.keys(reply.getHeaders())) {
          if (name.startsWith("access-control-")) reply.removeHeader(name);
        }

        reply.headers(DASHBOARD_HEADERS);

        const pattern = devtoolsRequestContext(request)?.pattern ?? "";

        // The mail preview is the one page the dashboard frames, from its own origin, and it sends its own policy.
        if (pattern === MAIL_HTML_PATTERN) {
          reply.header("X-Frame-Options", "SAMEORIGIN");

          return payload;
        }

        // The API docs pages are shown in a frame by the dashboard's API tab.
        if (DOCS_PATTERNS.has(pattern)) reply.header("X-Frame-Options", "SAMEORIGIN");

        // Always the dashboard's policy: the app's own (core's security headers set one on every response) is not
        // written for this page and must not replace it.
        if (String(reply.getHeader("content-type") ?? "").startsWith("text/html")) {
          reply.header(
            "Content-Security-Policy",
            DOCS_PATTERNS.has(pattern) ? DOCS_CSP : DASHBOARD_CSP,
          );
        }

        return payload;
      });

      // ---- Audit ----------------------------------------------------------
      instance.addHook("onResponse", async (request, reply) => {
        const context = devtoolsRequestContext(request);
        const type = context?.rule?.audit;

        if (!context || !type || reply.statusCode < 200 || reply.statusCode > 299) return;

        const params = (request.params ?? {}) as Record<string, string | undefined>;
        const detail: Record<string, string | number | boolean | null> =
          type === "explain.run"
            ? { shapeId: params.shapeId ?? null }
            : type === "panel.action"
              ? {
                  panel: context.pattern.split("/")[2] ?? null,
                  method: request.method,
                  route: context.pattern,
                }
              : {};

        await auth.audit(type, { auth: context.authenticated, meta: context.meta, detail });
      });

      // ---- Errors ---------------------------------------------------------
      instance.setErrorHandler(
        (error: Error & { statusCode?: number; code?: string }, request, reply) => {
          if (error instanceof DevtoolsApiError) {
            return reply.code(error.statusCode).send(error.toBody());
          }

          const status = error.statusCode;

          // The request itself was wrong (bad JSON, too large): say so in the dashboard's own shape.
          if (status !== undefined && status >= 400 && status < 500) {
            return reply
              .code(status)
              .send(
                error.code?.startsWith("FST_ERR_")
                  ? new DevtoolsApiError("input.invalid").toBody()
                  : { error: error.message },
              );
          }

          const ref = createErrorRef();

          // Never rate limited: the reference the browser shows must always be findable in the log. The route is
          // written relative to the dashboard path, which never reaches the log.
          deps.warn?.(
            `Devtools dashboard error ${ref} on ${request.method} ${devtoolsRequestContext(request)?.pattern ?? "(dashboard route)"}: ${error.message}`,
          );
          request.log.error({ ref, err: error }, "devtools dashboard error");

          return reply.code(500).send({
            error: DEVTOOLS_ERROR_MESSAGES["server.error"],
            code: "server.error",
            ref,
          });
        },
      );

      // ---- Routes ---------------------------------------------------------
      registerUiAssets(instance, { notFound });
      registerAuthRoutes(instance, deps);

      instance.get("/api/panels", async () => listPanelInfos(deps.panels, deps.builtInPanels));

      registerRequestsRoutes(instance, routes);
      registerRouteRoutes(instance, routes);
      registerInsightsRoutes(instance, routes);
      registerLogRoutes(instance, routes);
      registerShapeExplainRoute(instance, routes);
      registerPanelRoutes(instance, deps.panels);

      if (enabledTabs.has("mail")) registerMailRoutes(instance, routes);
      if (enabledTabs.has("ai") || enabledTabs.has("agents")) registerAiRoutes(instance, routes);
      if (enabledTabs.has("api")) registerOpenApiRoutes(instance, routes);

      registerStreamRoute(instance, routes);
    },
    { prefix },
  );
}
