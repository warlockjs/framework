import type { DevtoolsRouteAccess, DevtoolsRouteAccessRule } from "./types";

type Method = DevtoolsRouteAccessRule["method"];

const PUBLIC: DevtoolsRouteAccess = { type: "public" };
const VIEWER: DevtoolsRouteAccess = { type: "viewer" };
const ADMIN: DevtoolsRouteAccess = { type: "admin" };
const SHARE: DevtoolsRouteAccess = { type: "share" };

const pending = (...stages: Extract<DevtoolsRouteAccess, { type: "pending" }>["stages"]) =>
  ({ type: "pending", stages }) satisfies DevtoolsRouteAccess;

const ALL_STEPS = ["password-change", "mfa-enrol", "mfa-verify"] as const;

/**
 * The access table: every production route, its method and who may call it.
 * A route with no entry is `admin` (fail closed). A package panel `<id>`
 * gets `GET /api/<id>` and `GET /api/<id>/*` for viewers and every other
 * method there for admins, audited as `panel.action`; a url ending in `/*`
 * matches every pattern below it. The share routes exist only when
 * `options.share` is `true` (`production.share.enabled`).
 */
export function productionRouteAccess(
  panelIds: readonly string[],
  options: { share?: boolean } = {},
): DevtoolsRouteAccessRule[] {
  const rule = (
    method: Method,
    url: string,
    access: DevtoolsRouteAccess,
    audit?: DevtoolsRouteAccessRule["audit"],
  ): DevtoolsRouteAccessRule => ({ method, url, access, ...(audit ? { audit } : {}) });

  const rules: DevtoolsRouteAccessRule[] = [
    // The shell and its sign-in steps.
    rule("GET", "/", PUBLIC),
    rule("GET", "/assets/:name", PUBLIC),
    rule("GET", "/api/auth/session", PUBLIC),
    rule("POST", "/api/auth/login", PUBLIC),
    rule("POST", "/api/auth/setup", PUBLIC),
    rule("POST", "/api/auth/invite/inspect", PUBLIC),
    rule("POST", "/api/auth/invite/accept", PUBLIC),
    rule("POST", "/api/auth/password", pending("password-change")),
    rule("POST", "/api/auth/totp/start", pending("mfa-enrol")),
    rule("POST", "/api/auth/totp/confirm", pending("mfa-enrol")),
    rule("POST", "/api/auth/passkey/options", pending("mfa-enrol", "mfa-verify")),
    rule("POST", "/api/auth/passkey/verify", pending("mfa-enrol", "mfa-verify")),
    rule("POST", "/api/auth/mfa", pending("mfa-verify")),
    rule("POST", "/api/auth/logout", pending(...ALL_STEPS)),

    // The signed-in account.
    rule("GET", "/api/panels", VIEWER),
    rule("GET", "/api/account", VIEWER),
    rule("GET", "/api/account/sessions", VIEWER),
    rule("DELETE", "/api/account/sessions/:id", VIEWER),
    rule("POST", "/api/account/password", VIEWER),
    rule("POST", "/api/account/totp/start", VIEWER),
    rule("POST", "/api/account/totp/confirm", VIEWER),
    rule("DELETE", "/api/account/totp", VIEWER),
    rule("POST", "/api/account/recovery-codes", VIEWER),
    rule("POST", "/api/account/passkey/options", VIEWER),
    rule("POST", "/api/account/passkey/verify", VIEWER),
    rule("DELETE", "/api/account/passkeys/:id", VIEWER),

    // Administration.
    rule("GET", "/api/admin/users", ADMIN),
    rule("POST", "/api/admin/invites", ADMIN),
    rule("DELETE", "/api/admin/invites/:id", ADMIN),
    rule("PATCH", "/api/admin/users/:id", ADMIN),
    rule("DELETE", "/api/admin/users/:id", ADMIN),
    rule("POST", "/api/admin/users/:id/reset-mfa", ADMIN),
    rule("POST", "/api/admin/users/:id/sign-out", ADMIN),
    rule("GET", "/api/admin/audit", ADMIN),
    rule("POST", "/api/admin/disable", ADMIN),

    // Data.
    rule("GET", "/api/stream", VIEWER),
    rule("GET", "/api/instances", VIEWER),
    rule("GET", "/api/resources", VIEWER),
    rule("GET", "/api/queries/stats", VIEWER),
    rule("GET", "/api/routes/stats", VIEWER),
    rule("GET", "/api/health", VIEWER),
    rule("GET", "/api/errors", VIEWER),
    rule("GET", "/api/jobs", VIEWER),
    rule("GET", "/api/logs", VIEWER),
    rule("GET", "/api/requests", VIEWER),
    rule("GET", "/api/requests/:id", VIEWER),
    rule("GET", "/api/requests/:id/curl", VIEWER),
    rule("DELETE", "/api/requests", ADMIN, "requests.cleared"),
    rule("POST", "/api/queries/:shapeId/explain", ADMIN, "explain.run"),
    rule("GET", "/api/routes", VIEWER),
    rule("GET", "/panels/:id/:name", VIEWER),
    rule("GET", "/panels/:id/files/*", VIEWER),

    // Tabs that are off unless the project turns them on.
    rule("GET", "/api/mails", VIEWER),
    rule("GET", "/api/mails/:id", VIEWER),
    rule("GET", "/api/mails/:id/html", VIEWER),
    rule("GET", "/api/ai", VIEWER),
    rule("GET", "/api/ai/agent-runs", VIEWER),
    rule("GET", "/api/ai/agent-runs/:id", VIEWER),
    rule("GET", "/api/ai/runs/:id", VIEWER),
    rule("GET", "/api/ai/runs", VIEWER),
    rule("GET", "/api/ai/reports", VIEWER),
    rule("GET", "/api/ai/models", VIEWER),
    rule("GET", "/api/ai/errors", VIEWER),
    rule("GET", "/api/ai/evaluate", VIEWER),
    rule("POST", "/api/ai/evaluate", ADMIN),
    rule("GET", "/api/openapi.json", VIEWER),
    rule("GET", "/api/postman.json", VIEWER),
    rule("GET", "/docs", VIEWER),
    rule("GET", "/docs/swagger", VIEWER),
  ];

  if (options.share === true) {
    rules.push(
      // The grant exchange: public, answered only for a valid token.
      rule("POST", "/api/share/open", PUBLIC),
      // What a share grant may reach.
      rule("GET", "/api/share/info", SHARE),
      rule("GET", "/api/share/view.js", SHARE),
      rule("GET", "/api/share/assets/:name", SHARE),
      rule("GET", "/api/share/files/*", SHARE),
      rule("GET", "/api/share/panel", SHARE),
      rule("GET", "/api/share/panel/*", SHARE),
      // Managing the links.
      rule("GET", "/api/admin/shares", ADMIN),
      rule("POST", "/api/admin/shares", ADMIN),
      rule("DELETE", "/api/admin/shares/:id", ADMIN),
      rule("POST", "/api/admin/shares/revoke-all", ADMIN),
    );
  }

  for (const id of panelIds) {
    rules.push(rule("GET", `/api/${id}`, VIEWER), rule("GET", `/api/${id}/*`, VIEWER));

    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      rules.push(
        rule(method, `/api/${id}`, ADMIN, "panel.action"),
        rule(method, `/api/${id}/*`, ADMIN, "panel.action"),
      );
    }
  }

  return rules;
}

/** Looks routes up by method and URL pattern: exact first, then the longest `/*` prefix. */
export function createAccessLookup(
  rules: readonly DevtoolsRouteAccessRule[],
): (method: string, pattern: string) => DevtoolsRouteAccessRule | undefined {
  const exact = new Map<string, DevtoolsRouteAccessRule>();
  const wildcards: { method: Method; prefix: string; rule: DevtoolsRouteAccessRule }[] = [];

  for (const rule of rules) {
    if (rule.url.endsWith("/*")) {
      wildcards.push({ method: rule.method, prefix: rule.url.slice(0, -1), rule });
    } else {
      exact.set(`${rule.method} ${rule.url}`, rule);
    }
  }

  wildcards.sort((a, b) => b.prefix.length - a.prefix.length);

  return (method, pattern) => {
    // A HEAD request is answered by the GET route.
    const verb = method === "HEAD" ? "GET" : method;
    const found = exact.get(`${verb} ${pattern}`);

    if (found) return found;

    return wildcards.find((item) => item.method === verb && pattern.startsWith(item.prefix))?.rule;
  };
}
