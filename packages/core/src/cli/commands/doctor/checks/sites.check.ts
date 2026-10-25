import { config } from "../../../../config/config-getter";
import { container } from "../../../../container";
import { router } from "../../../../router/router";
import type { DoctorCheck } from "../check.types";

/** How long one site's root page may take before doctor calls it hung. */
export const SITE_RENDER_TIMEOUT_MS = 30_000;

/** A configured site doctor can render: it has exact hostnames. */
export type SiteTarget = {
  /** The `web.sites` key. */
  site: string;
  /** The first configured hostname; sent as the `Host` header. */
  host: string;
  /** The site's root path: `/` or its `basePath`. */
  path: string;
};

/** What the development error panel says about a failed page. */
export type DevErrorPanelDetails = {
  /** `Name: message` of the thrown error. */
  message?: string;
  /** The stage that failed: `loader`, `render`, `middleware`, ... */
  phase?: string;
  /** The matched page file. */
  file?: string;
  /** The route pattern. */
  route?: string;
};

/** The minimal slice of a Fastify instance doctor drives. */
export type InjectableServer = {
  inject(options: {
    method: "GET";
    url: string;
    headers: Record<string, string>;
  }): Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>;
};

type SiteConfigEntry = { hosts?: unknown; basePath?: unknown; dynamic?: unknown };

/**
 * The sites doctor can render, and how many it cannot: a dynamic site claims
 * its hosts at runtime through `web.resolveHost`, so there is no hostname to
 * request.
 */
export function listSiteTargets(sites: unknown): { targets: SiteTarget[]; dynamic: string[] } {
  const targets: SiteTarget[] = [];
  const dynamic: string[] = [];

  if (typeof sites !== "object" || sites === null) return { targets, dynamic };

  for (const [site, entry] of Object.entries(sites as Record<string, SiteConfigEntry>)) {
    const host = Array.isArray(entry?.hosts)
      ? entry.hosts.find((candidate): candidate is string => typeof candidate === "string")
      : undefined;

    if (host === undefined) {
      if (entry?.dynamic === true) dynamic.push(site);
      continue;
    }

    const basePath = typeof entry.basePath === "string" ? entry.basePath.trim() : "";

    targets.push({
      site,
      host,
      path: basePath === "" || basePath === "/" ? "/" : `/${basePath.replace(/^\/+|\/+$/g, "")}`,
    });
  }

  return { targets, dynamic };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, "")).trim();
}

/**
 * Read the page error details out of a development 500 response. The web
 * package draws them in an `<aside data-warlock-dev-error>` panel (message,
 * then Phase / Page file / Route / Site rows); a production response has no
 * panel, and this returns an empty object for any body without one.
 */
export function parseDevErrorPanel(html: string): DevErrorPanelDetails {
  const start = html.indexOf("data-warlock-dev-error");

  if (start < 0) return {};

  const end = html.indexOf("</aside>", start);
  const panel = html.slice(start, end < 0 ? undefined : end);
  const message = /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(panel)?.[1];
  const details: DevErrorPanelDetails = {};

  if (message !== undefined) details.message = stripTags(message);

  const rows = panel.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g);

  for (const row of rows) {
    const label = stripTags(row[1] ?? "").toLowerCase();
    const value = stripTags(row[2] ?? "");

    if (label === "phase") details.phase = value;
    else if (label === "page file") details.file = value;
    else if (label === "route") details.route = value;
  }

  return details;
}

/** The outcome of requesting one site's root page. */
export type SiteRenderOutcome = {
  target: SiteTarget;
  status: number;
  /** Set for a 5xx, or when the request itself failed or timed out. */
  failure?: string;
};

function describeFailure(status: number, body: string, contentType: unknown): string {
  const panel = parseDevErrorPanel(body);
  const parts = [`${status}`];

  if (panel.phase) parts.push(`in phase "${panel.phase}"`);
  if (panel.file) parts.push(`at ${panel.file}`);
  if (panel.route) parts.push(`(route ${panel.route})`);

  let message = panel.message;

  if (message === undefined && typeof contentType === "string" && contentType.includes("json")) {
    try {
      const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };

      message = String(parsed.message ?? parsed.error ?? "");
    } catch {
      // not JSON after all
    }
  }

  if (!panel.phase && !panel.file) {
    parts.push("with no page error details (a production-style answer or a non-page 5xx)");
  }

  return message ? `${parts.join(" ")}: ${message}` : parts.join(" ");
}

/** Render one site's root page in-process, with no listening socket. */
export async function renderSiteRoot(
  server: InjectableServer,
  target: SiteTarget,
  timeoutMs: number = SITE_RENDER_TIMEOUT_MS,
): Promise<SiteRenderOutcome> {
  let timer: NodeJS.Timeout | undefined;

  try {
    const response = await Promise.race([
      server.inject({
        method: "GET",
        url: target.path,
        headers: { host: target.host, accept: "text/html" },
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`)),
          timeoutMs,
        );
      }),
    ]);

    return {
      target,
      status: response.statusCode,
      ...(response.statusCode >= 500 && {
        failure: describeFailure(response.statusCode, response.body, response.headers["content-type"]),
      }),
    };
  } catch (error) {
    return {
      target,
      status: 0,
      failure: `the request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Renders the root page of every configured site through the development page
 * pipeline, in this process.
 *
 * Why it exists: a multi-site app can serve every page of every site as a 500
 * in development and under the test server while production, which reads route
 * names from the build manifest, stays healthy. Nothing in a single-site run or
 * in the other checks touches that path.
 *
 * How: the boot pass has built the Fastify instance and the web connector has
 * registered the pages; doctor scans the router onto that instance exactly as
 * `warlock dev` does and calls `inject` per site, with the site's first
 * hostname as the `Host` header. `inject` never opens a socket, so no port is
 * used. Only the root page is requested: a smoke test, not a crawl.
 *
 * Verdicts:
 * - no `web.sites`, web or http not booted, or only dynamic sites → not
 *   applicable, no line;
 * - any site answers 5xx, or does not answer → `fail`, naming the site, the
 *   status, and the phase and page file the page error record carries;
 * - otherwise → `ok`. A 404 or a redirect is not a defect here.
 */
export const sitesCheck: DoctorCheck = {
  name: "sites",
  run: async (context) => {
    const { targets, dynamic } = listSiteTargets(config.get("web.sites"));

    if (targets.length === 0) return undefined;

    if (!context.connectors.booted.includes("web") || !context.connectors.booted.includes("http")) {
      return undefined;
    }

    const server = container.tryGet<InjectableServer>("http.server");

    if (!server || typeof server.inject !== "function") return undefined;

    try {
      router.scanDevServer(server as never);
    } catch (error) {
      return {
        name: "sites",
        status: "fail",
        code: "WL5005",
        detail: `could not bind the routes to render the sites: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const outcomes: SiteRenderOutcome[] = [];

    // One at a time: a page render is the heaviest thing doctor does.
    for (const target of targets) outcomes.push(await renderSiteRoot(server, target));

    const failed = outcomes.filter((outcome) => outcome.failure !== undefined);

    if (failed.length > 0) {
      return {
        name: "sites",
        status: "fail",
        code: "WL5005",
        detail:
          `${failed.length} of ${outcomes.length} site(s) failed to render their root page in development:\n` +
          failed
            .map(
              (outcome) =>
                `  - ${outcome.target.site} (GET ${outcome.target.path} on ${outcome.target.host}): ${outcome.failure}`,
            )
            .join("\n"),
      };
    }

    const rendered = outcomes
      .map((outcome) => `${outcome.target.site} ${outcome.status}`)
      .join(", ");
    const skipped =
      dynamic.length > 0
        ? `; not rendered (host resolved at runtime): ${dynamic.join(", ")}`
        : "";

    return {
      name: "sites",
      status: "ok",
      detail: `root page rendered without a 5xx — ${rendered}${skipped}`,
    };
  },
};
