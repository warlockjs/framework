import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { panelContentType, type MountedDevtoolsPanel } from "../../panels";
import { sendPanelFile } from "../../server/panel-routes";
import { sendFile } from "../../server/ui-assets";
import type { DevtoolsPanelRequest } from "../../types";
import { generateToken, hashToken } from "../auth/helpers";
import type { DevtoolsAuthenticated, DevtoolsRequestMeta } from "../auth/types";
import {
  DEVTOOLS_FAILURE_AUDIT_TYPES,
  DEVTOOLS_SHARE_LABEL_MAX,
  type DevtoolsCreatedShare,
  type DevtoolsShareList,
  type DevtoolsShareOpenAnswer,
  type DevtoolsShareView,
} from "../contracts";
import { DevtoolsApiError } from "../errors";
import type { DevtoolsShareRecord } from "../store/types";
import { devtoolsRequestContext } from "./context";
import { readCookie, shareCookie, shareCookieName } from "./cookie";
import { rateLimitClient } from "./ip";
import { createShareSessions, type DevtoolsShareGrant } from "./share-session";
import type { MountProductionDevtoolsDeps } from "./types";

const DAY_MS = 86_400_000;
const MAX_TOKEN = 512;
const MAX_PANEL_ID = 64;

/** A failed token is not looked up again for this long once its client is over the limit. */
const BLOCK_CACHE_MS = 30_000;
const BLOCK_CACHE_SIZE = 1000;

/** A cookie failure is audited at most this often per client (a revoked link in use must not flood the log). */
const COOKIE_AUDIT_INTERVAL_MS = 60_000;

type Notfound = (
  request: FastifyRequest,
  reply: FastifyReply,
) => FastifyReply | Promise<FastifyReply>;

/** The path pattern `pattern` (`/flows/:feature`) matched against `path`, as its params; `null` for no match. */
export function matchSharePath(pattern: string, path: string): Record<string, string> | null {
  if (/[\0\\]/.test(path)) return null;

  const wanted = pattern.split("/");
  const given = path.split("/");

  if (wanted.length !== given.length) return null;

  const params: Record<string, string> = {};

  for (const [index, part] of wanted.entries()) {
    const actual = given[index];

    if (actual === undefined) return null;

    if (part.startsWith(":")) {
      if (actual === "") return null;

      params[part.slice(1)] = actual;
    } else if (part !== actual) {
      return null;
    }
  }

  return params;
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  const body: unknown = request.body;

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new DevtoolsApiError("input.invalid");
  }

  return body as Record<string, unknown>;
}

function viewOf(
  record: DevtoolsShareRecord,
  createdBy: string | null,
  at: number,
): DevtoolsShareView {
  return {
    id: record.id,
    panel: record.panel,
    label: record.label,
    createdBy,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    lastUsedAt: record.lastUsedAt,
    uses: record.uses,
    status: record.revokedAt !== null ? "revoked" : record.expiresAt <= at ? "expired" : "active",
  };
}

function openAnswer(grant: DevtoolsShareGrant): DevtoolsShareOpenAnswer {
  const { panel, share } = grant;

  return {
    panel: panel.id,
    title: panel.title,
    label: share.label,
    expiresAt: share.expiresAt,
    assets: [...(panel.share?.assets ?? [])],
    files: panel.share?.files === true,
  };
}

/** What `mountProductionDevtools` gets back when sharing is on. */
export type DevtoolsShareMount = {
  /** The grant of a request's share cookie, or `null` (the gate then answers the uniform 404). */
  authorize(request: FastifyRequest, meta: DevtoolsRequestMeta): Promise<DevtoolsShareGrant | null>;
  /** Registers the share routes and the admin routes that manage links. */
  register(server: FastifyInstance, notFound: Notfound): void;
};

/**
 * Read-only share links of the production monitor. An admin creates a link
 * for a panel that declares `share`; the token is shown once and only its
 * SHA-256 is stored. Opening a link exchanges the token for a scoped cookie
 * (`__Secure-warlock-devtools-share`) that reaches only that panel's shared
 * view. Every refusal answers the dashboard's uniform 404, is audited as
 * `share.failed` (which counts toward the per-IP failure limit) and never
 * records the token.
 */
export function createDevtoolsShare(
  deps: MountProductionDevtoolsDeps & { now?: () => number },
): DevtoolsShareMount {
  const { production, store, auth } = deps;
  const now = deps.now ?? (() => Date.now());

  if (typeof deps.hmac !== "function") {
    throw new Error("Share links need deps.hmac (HMAC-SHA256 keyed with encryption.key).");
  }

  const sessions = createShareSessions({
    store,
    panels: deps.panels,
    hmac: deps.hmac,
    now,
    ...(deps.warn ? { warn: deps.warn } : {}),
  });
  const cookieOptions = { path: production.path, secure: production.requireHttps };
  const cookieName = shareCookieName(production.requireHttps);
  const sharePanels = deps.panels.filter((panel) => panel.share !== null);
  const blocked = new Map<string, number>();
  const cookieAudited = new Map<string, number>();

  const limits = production.rateLimits;
  const windowMs = limits.windowMinutes * 60_000;

  async function overLimit(ip: string): Promise<boolean> {
    const client = rateLimitClient(ip);
    const at = now();
    const until = blocked.get(client);

    if (until !== undefined && at < until) return true;

    const state = await store.state.read();
    const since = Math.max(at - windowMs, state.failuresResetAt ?? 0);
    const count = await store.audit.count({ types: DEVTOOLS_FAILURE_AUDIT_TYPES, since, ip });

    blocked.delete(client);

    if (count < limits.ip) return false;

    if (blocked.size >= BLOCK_CACHE_SIZE) {
      const oldest = blocked.keys().next();

      if (!oldest.done) blocked.delete(oldest.value);
    }

    blocked.set(client, at + BLOCK_CACHE_MS);

    return true;
  }

  /** Writes one `share.failed` entry (never the token). Never throws. */
  async function failed(
    meta: DevtoolsRequestMeta,
    reason: string,
    shareId: string | null,
  ): Promise<void> {
    await auth.audit("share.failed", { meta, detail: { reason, share: shareId } });
  }

  /** The cookie check for a share request. */
  async function authorize(
    request: FastifyRequest,
    meta: DevtoolsRequestMeta,
  ): Promise<DevtoolsShareGrant | null> {
    const value = readCookie(request.headers.cookie, cookieName);

    if (value === undefined) return null;

    let result;

    try {
      result = await sessions.verify(value);
    } catch (error) {
      deps.warn?.(
        `A devtools share link could not be checked and the request was refused: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    }

    if ("grant" in result) {
      sessions.touch(result.grant.share.id);

      return result.grant;
    }

    const client = rateLimitClient(meta.ip);
    const last = cookieAudited.get(client);

    if (last === undefined || now() - last >= COOKIE_AUDIT_INTERVAL_MS) {
      cookieAudited.delete(client);

      if (cookieAudited.size >= BLOCK_CACHE_SIZE) {
        const oldest = cookieAudited.keys().next();

        if (!oldest.done) cookieAudited.delete(oldest.value);
      }

      cookieAudited.set(client, now());

      try {
        if (!(await overLimit(meta.ip))) await failed(meta, result.refused, result.shareId);
      } catch {
        // The refusal stands even when the audit cannot be written.
      }
    }

    return null;
  }

  function grantOf(request: FastifyRequest): DevtoolsShareGrant {
    const grant = devtoolsRequestContext(request)?.share;

    if (!grant) throw new Error("A share route ran without its grant.");

    return grant;
  }

  function createdByOf(
    accounts: readonly { id: string; email: string }[],
    id: string | null,
  ): string | null {
    return accounts.find((account) => account.id === id)?.email ?? null;
  }

  // ---- Admin ----------------------------------------------------------------

  async function list(): Promise<DevtoolsShareList> {
    const [records, accounts] = await Promise.all([store.shares.list(), store.accounts.list()]);
    const at = now();

    return {
      enabled: true,
      maxDays: production.share.maxDays,
      panels: sharePanels.map((panel) => ({ id: panel.id, title: panel.title })),
      shares: records.map((record) => viewOf(record, createdByOf(accounts, record.createdBy), at)),
    };
  }

  async function create(
    authenticated: DevtoolsAuthenticated,
    meta: DevtoolsRequestMeta,
    body: Record<string, unknown>,
  ): Promise<DevtoolsCreatedShare> {
    const panel = body.panel;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const days = body.days;

    if (
      typeof panel !== "string" ||
      panel.length > MAX_PANEL_ID ||
      !sharePanels.some((item) => item.id === panel) ||
      label === "" ||
      label.length > DEVTOOLS_SHARE_LABEL_MAX ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/.test(label) ||
      typeof days !== "number" ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > production.share.maxDays
    ) {
      throw new DevtoolsApiError("input.invalid");
    }

    const token = generateToken();
    const at = now();
    const record = await store.shares.create({
      tokenHash: hashToken(token),
      panel,
      label,
      createdBy: authenticated.account.id,
      createdAt: at,
      expiresAt: at + days * DAY_MS,
    });

    sessions.invalidate();
    await auth.audit("share.created", {
      auth: authenticated,
      meta,
      detail: { share: record.id, panel, days },
    });

    return {
      share: viewOf(record, authenticated.account.email, at),
      // The token rides in the fragment: it never reaches an access log or a Referer header.
      url: `${meta.origin}${production.path}/#/share/${token}`,
    };
  }

  // ---- Registration -----------------------------------------------------------

  function register(server: FastifyInstance, notFound: Notfound): void {
    const requireAuth = (request: FastifyRequest) => {
      const context = devtoolsRequestContext(request);

      if (!context?.authenticated) throw new Error("A dashboard route ran without its session.");

      return { auth: context.authenticated, meta: context.meta };
    };

    // The grant exchange. Every failure answers the uniform 404.
    server.post("/api/share/open", async (request, reply) => {
      const context = devtoolsRequestContext(request);

      if (!context) return notFound(request, reply);

      const { meta } = context;
      const token = (request.body as { token?: unknown } | null | undefined)?.token;

      if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN) {
        return notFound(request, reply);
      }

      try {
        if (await overLimit(meta.ip)) return notFound(request, reply);

        const result = await sessions.open(hashToken(token));

        if (!("grant" in result)) {
          await failed(meta, result.refused, result.shareId);

          return notFound(request, reply);
        }

        const { value, maxAgeSeconds } = sessions.issue(result.grant.share);

        sessions.touch(result.grant.share.id);
        reply.header("set-cookie", shareCookie(value, { ...cookieOptions, maxAgeSeconds }));

        return openAnswer(result.grant);
      } catch (error) {
        deps.warn?.(
          `A devtools share link could not be opened: ${error instanceof Error ? error.message : String(error)}`,
        );

        return notFound(request, reply);
      }
    });

    server.get("/api/share/info", async (request) => openAnswer(grantOf(request)));

    server.get("/api/share/view.js", async (request, reply) => {
      const view = grantOf(request).panel.share?.view;

      if (view === undefined) return notFound(request, reply);

      sendFile(reply, view, "text/javascript; charset=utf-8");

      return reply;
    });

    server.get<{ Params: { name: string } }>("/api/share/assets/:name", async (request, reply) => {
      const { panel } = grantOf(request);
      const name = request.params.name;
      const file =
        panel.share?.assets.includes(name) === true && Object.hasOwn(panel.assets, name)
          ? panel.assets[name]
          : undefined;

      if (file === undefined) return notFound(request, reply);

      sendFile(reply, file, panelContentType(name));

      return reply;
    });

    server.get<{ Params: { "*": string } }>("/api/share/files/*", async (request, reply) => {
      const { panel } = grantOf(request);

      return sendPanelFile(
        { files: panel.share?.files === true ? panel.files : null },
        request.params["*"],
        request,
        reply,
        notFound,
      );
    });

    const panelRoute = async (request: FastifyRequest, reply: FastifyReply) => {
      const { panel } = grantOf(request);
      const sub = (request.params as { "*"?: string })["*"];
      const path = sub === undefined || sub === "" ? "" : `/${sub}`;
      let matched: {
        route: MountedDevtoolsPanel["routes"][number];
        params: Record<string, string>;
      } | null = null;

      for (const pattern of panel.share?.routes ?? []) {
        const params = matchSharePath(pattern, path);
        const route = panel.routes.find(
          (candidate) => candidate.method === "GET" && candidate.path === pattern,
        );

        if (params !== null && route !== undefined) {
          matched = { route, params };
          break;
        }
      }

      if (matched === null) return notFound(request, reply);

      const input: DevtoolsPanelRequest = {
        params: matched.params,
        query: (request.query ?? {}) as Record<string, string | string[]>,
        body: undefined,
        shared: true,
      };
      const result = await matched.route.handler(input);

      reply.header("cache-control", "no-store");

      if (result === undefined) return reply.code(204).send();

      return result;
    };

    server.get("/api/share/panel", panelRoute);
    server.get("/api/share/panel/*", panelRoute);

    server.get("/api/admin/shares", async () => list());

    server.post("/api/admin/shares", async (request, reply) => {
      const { auth: authenticated, meta } = requireAuth(request);
      const created = await create(authenticated, meta, bodyOf(request));

      return reply.code(201).send(created);
    });

    server.delete<{ Params: { id: string } }>("/api/admin/shares/:id", async (request, reply) => {
      const { auth: authenticated, meta } = requireAuth(request);
      const id = request.params.id;

      if (typeof id !== "string" || id === "" || id.length > 64) {
        throw new DevtoolsApiError("input.invalid");
      }

      const record = await store.shares.get(id);

      if (!record || !(await store.shares.revoke(id, now()))) {
        throw new DevtoolsApiError("share.not-found");
      }

      sessions.invalidate();
      await auth.audit("share.revoked", {
        auth: authenticated,
        meta,
        detail: { share: id, panel: record.panel },
      });

      return reply.code(204).send();
    });

    server.post("/api/admin/shares/revoke-all", async (request) => {
      const { auth: authenticated, meta } = requireAuth(request);
      const revoked = await store.shares.revokeAll(now());

      sessions.invalidate();
      await auth.audit("share.revoked", {
        auth: authenticated,
        meta,
        detail: { all: true, count: revoked },
      });

      return { revoked };
    });
  }

  return { authorize, register };
}
