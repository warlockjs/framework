import { guardedFetch, OutboundPolicyError, tool, type ToolContract } from "@warlock.js/ai";
import type {
  FetchUrlExtract,
  FetchUrlExtractor,
  FetchUrlInput,
  FetchUrlOptions,
  FetchUrlResult,
} from "../contracts";
import { WebToolError } from "../errors";
import { htmlToMarkdown } from "./html-to-markdown";
import { objectSchema, stringField } from "./schema";

/** Default tool name exposed to the LLM. */
const DEFAULT_NAME = "fetch_url";

/** Default hard cap on response bytes read before truncation. */
const DEFAULT_MAX_BYTES = 1_000_000;

/** Default per-request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Default rendering mode for the fetched document. */
const DEFAULT_EXTRACT: FetchUrlExtract = "text";

/** Default HTML extractor for the `"text"` / `"markdown"` modes. */
const DEFAULT_EXTRACTOR: FetchUrlExtractor = "auto";

/** In `"auto"` mode, readability output shorter than this falls back to the simple converter. */
const MIN_READABILITY_CHARS = 200;

/** Browser-like headers sent on the challenge retry. */
const CHALLENGE_RETRY_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/** Input schema: `{ url }`. */
const inputSchema = objectSchema<FetchUrlInput>({
  url: stringField(),
});

// ============================================================
// Lazily-loaded @mozilla/readability + jsdom (OPTIONAL peers)
// ============================================================

/**
 * Minimal structural shapes of the optional `@mozilla/readability` + `jsdom`
 * peers — only the members this file actually uses. Declared locally so the
 * package type-checks even when the peers are NOT installed (they are lazy
 * optional peers, loaded below via a `string` specifier so `tsc` never tries
 * to statically resolve them).
 */
interface ReadabilityArticleLike {
  readonly content?: string | null;
  readonly textContent?: string | null;
}
interface ReadabilityInstanceLike {
  parse(): ReadabilityArticleLike | null;
}
interface ReadabilityModuleLike {
  Readability: new (document: unknown) => ReadabilityInstanceLike;
}
interface JsdomInstanceLike {
  readonly window: { readonly document: unknown };
}
interface JsdomModuleLike {
  JSDOM: new (html: string, options?: { url?: string }) => JsdomInstanceLike;
}

// String specifiers typed `string` (not a literal) so `tsc` does not attempt
// to resolve these optional peers at build time.
const READABILITY_MODULE_ID: string = "@mozilla/readability";
const JSDOM_MODULE_ID: string = "jsdom";

let ReadabilitySdk: ReadabilityModuleLike;
let JsdomSdk: JsdomModuleLike;
let isReadabilityAvailable: boolean | undefined;
let loadingPromise: Promise<void> | undefined;

const READABILITY_INSTALL_INSTRUCTIONS = `
The fetch_url text/markdown extractor requires the @mozilla/readability and jsdom packages.
Install them with:

  npm install @mozilla/readability jsdom

Or with your preferred package manager:

  pnpm add @mozilla/readability jsdom
  yarn add @mozilla/readability jsdom
`.trim();

/**
 * Settle the lazy import of `@mozilla/readability` + `jsdom` once,
 * concurrency-safe. Only needed for the `"text"` / `"markdown"` extract
 * modes — `"html"` returns the raw body and never loads them. A bare
 * `catch` flips the flag to `false`; the curated install string surfaces
 * at use time via {@link WebToolError}, never a raw module-resolution
 * stack trace.
 */
function loadReadability(): Promise<void> {
  if (isReadabilityAvailable !== undefined) {
    return Promise.resolve();
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      ReadabilitySdk = (await import(READABILITY_MODULE_ID)) as ReadabilityModuleLike;
      JsdomSdk = (await import(JSDOM_MODULE_ID)) as JsdomModuleLike;
      isReadabilityAvailable = true;
    } catch {
      isReadabilityAvailable = false;
    }
  })();

  return loadingPromise;
}

/**
 * Parse the input URL, rejecting anything unparseable or not over
 * `http`/`https` with a typed {@link WebToolError}.
 */
function parseUrl(raw: string): URL {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new WebToolError(`fetch_url received an unparseable URL: "${raw}".`, {
      type: "invalid-url",
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebToolError(`fetch_url only supports http(s) URLs; got "${url.protocol}".`, {
      type: "invalid-url",
    });
  }

  return url;
}

/**
 * Enforce the host allowlist (an SSRF guardrail) before any network call.
 * When `allowHosts` is set, a request to a host not in it is rejected;
 * matching is exact on the URL hostname (case-insensitive).
 */
function assertHostAllowed(url: URL, allowHosts?: string[]): void {
  if (!allowHosts || allowHosts.length === 0) {
    return;
  }

  const host = url.hostname.toLowerCase();
  const allowed = allowHosts.some((entry) => entry.toLowerCase() === host);

  if (!allowed) {
    throw new WebToolError(
      `fetch_url blocked host "${url.hostname}" — it is not in the allowHosts allowlist.`,
      { type: "denied-host", context: { host: url.hostname } },
    );
  }
}

/**
 * Read the response body up to `maxBytes`, stopping early once the cap is
 * reached. Returns the decoded text and whether it was truncated. When
 * the body has no stream (a stubbed `Response`), falls back to `.text()`
 * and truncates the decoded string at `maxBytes`.
 */
async function readBody(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  const stream = response.body;

  if (!stream) {
    const bytes = new TextEncoder().encode(await response.text());

    if (bytes.byteLength > maxBytes) {
      return { body: decodeUtf8Prefix(bytes, maxBytes), truncated: true };
    }

    return { body: new TextDecoder().decode(bytes), truncated: false };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      received += value.byteLength;
      chunks.push(value);

      if (received >= maxBytes) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  }

  const merged = new Uint8Array(received);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const body = truncated ? decodeUtf8Prefix(merged, maxBytes) : new TextDecoder().decode(merged);

  return { body, truncated };
}

/**
 * Decode the first `maxBytes` bytes as UTF-8 without splitting a
 * multi-byte character: when the cut lands inside one, the partial
 * character is dropped instead of decoding to U+FFFD.
 */
function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  let end = Math.min(maxBytes, bytes.byteLength);

  // A continuation byte (10xxxxxx) at the cut means the character started earlier.
  if (end < bytes.byteLength) {
    while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
      end -= 1;
    }
  }

  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** Outcome of {@link render}. */
interface RenderOutcome {
  content: string;
  /** The extractor that produced `content`; absent for `"html"`. */
  extractor?: Exclude<FetchUrlExtractor, "auto">;
}

/**
 * Minimal HTML to Markdown reduction for readability's extracted article
 * HTML: headings become `#` prefixes, paragraphs and line breaks become
 * blank-line separated blocks, and remaining tags are stripped.
 */
function readabilityToMarkdown(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_match, level: string, text: string) => {
      const hashes = "#".repeat(Number(level));

      return `\n\n${hashes} ${text.replace(/<[^>]+>/g, "").trim()}\n\n`;
    })
    .replace(/<\/(p|div|section|article|li)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Run readability over a jsdom document; `undefined` when it found no article. */
function runReadability(
  html: string,
  url: string,
  extract: "text" | "markdown",
): string | undefined {
  const dom = new JsdomSdk.JSDOM(html, { url });
  const article = new ReadabilitySdk.Readability(dom.window.document).parse();

  if (!article) {
    return undefined;
  }

  if (extract === "markdown") {
    return article.content ? readabilityToMarkdown(article.content) : (article.textContent ?? "");
  }

  return article.textContent ?? "";
}

/**
 * Render the fetched HTML into the configured `extract` mode. `"html"`
 * returns the raw body untouched. For `"text"` / `"markdown"` the
 * `extractor` decides how: `"readability"` runs `@mozilla/readability`
 * over `jsdom` (throwing a curated {@link WebToolError} when those
 * optional peers are absent), `"simple"` uses the dependency-free
 * converter, and `"auto"` prefers readability when its peers load and it
 * yields at least {@link MIN_READABILITY_CHARS} characters, else falls
 * back to the simple converter.
 */
async function render(
  html: string,
  url: string,
  extract: FetchUrlExtract,
  extractor: FetchUrlExtractor,
): Promise<RenderOutcome> {
  if (extract === "html") {
    return { content: html };
  }

  const simple = (): RenderOutcome => ({
    content: htmlToMarkdown(html, { plain: extract === "text" }),
    extractor: "simple",
  });

  if (extractor === "simple") {
    return simple();
  }

  await loadReadability();

  if (!isReadabilityAvailable) {
    if (extractor === "auto") {
      return simple();
    }

    throw new WebToolError(READABILITY_INSTALL_INSTRUCTIONS, { type: "missing-peer" });
  }

  if (extractor === "readability") {
    return { content: runReadability(html, url, extract) ?? "", extractor: "readability" };
  }

  let content: string | undefined;

  try {
    content = runReadability(html, url, extract);
  } catch {
    content = undefined;
  }

  if (content !== undefined && content.trim().length >= MIN_READABILITY_CHARS) {
    return { content, extractor: "readability" };
  }

  return simple();
}

/** True for a response that carries a `cf-mitigated: challenge` header. */
function isChallenge(response: Response): boolean {
  return response.headers?.get("cf-mitigated")?.toLowerCase() === "challenge";
}

/**
 * Build the agent-facing `fetch_url` tool — fetch a URL over the global
 * `fetch` (Node 18+) and hand the model back rendered `content`.
 *
 * Guardrails, applied in order before/around the network call:
 * - **Private-network deny (default).** Every request — and every
 *   redirect hop — goes through the framework's `guardedFetch` outbound
 *   policy, which refuses private / loopback / link-local /
 *   cloud-metadata addresses (and hostnames resolving to them) unless
 *   `allowPrivateNetwork: true` is set. This applies even when
 *   `allowHosts` is not configured, so a bare `ai.tools.fetchUrl()` is
 *   not an SSRF primitive.
 * - **`allowHosts`** — when set, a request to any host not in the list is
 *   rejected before the fetch, and redirect targets are held to the same
 *   allowlist.
 * - **`timeoutMs`** — the request is aborted via `AbortSignal.timeout`
 *   (default {@link DEFAULT_TIMEOUT_MS}).
 * - **`maxBytes`** — the response body is read up to this cap and the
 *   result flags `truncated` when it was cut off (default
 *   {@link DEFAULT_MAX_BYTES}).
 * - **`extract`** — `"html"` returns the raw body; `"text"` (default) and
 *   `"markdown"` render the page through the `extractor`: `"auto"`
 *   (default) uses `@mozilla/readability` over `jsdom` (lazily imported
 *   OPTIONAL peers) and falls back to a built-in converter when they are
 *   absent or the article is short; `"readability"` requires the peers
 *   (a missing peer throws the curated install string); `"simple"` always
 *   uses the built-in converter.
 * - **`retryOnChallenge`** — retries once with browser-like headers when
 *   the first response carries a `cf-mitigated: challenge` header (on by default).
 *
 * **Errors flow as data.** Every guardrail rejection and network failure
 * throws a typed {@link WebToolError}; the `tool()` wrapper catches it and
 * surfaces it in the returned `{ error }` field — `invoke()` never throws
 * — so the agent reads the failure and self-corrects.
 *
 * @param options - Tool-name override, byte cap, timeout, extract mode,
 *   and host allowlist.
 * @returns A `ToolContract<{ url }, FetchUrlResult>`.
 *
 * @example
 * const fetchUrl = fetchUrlTool({ extract: "text", allowHosts: ["docs.stripe.com"] });
 * const { data } = await fetchUrl.invoke({ url: "https://docs.stripe.com/api" });
 * console.log(data?.content, data?.truncated);
 */
export function fetchUrlTool(
  options?: FetchUrlOptions,
): ToolContract<FetchUrlInput, FetchUrlResult> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const extract = options?.extract ?? DEFAULT_EXTRACT;
  const allowHosts = options?.allowHosts;
  const allowPrivateNetwork = options?.allowPrivateNetwork ?? false;
  const extractor = options?.extractor ?? DEFAULT_EXTRACTOR;
  const retryOnChallenge = options?.retryOnChallenge ?? true;

  // Warm the readability peers non-blockingly when the configured mode
  // needs them, so the curated install string is ready (and logged at
  // first use) without delaying construction.
  if (extract !== "html" && extractor !== "simple") {
    void loadReadability();
  }

  return tool<FetchUrlInput, FetchUrlResult>({
    name: options?.name ?? DEFAULT_NAME,
    description:
      "Fetch a web page or document by URL and return its main content as " +
      "text (readability-extracted), raw HTML, or Markdown. Use to read a " +
      "specific page you already have the URL for.",
    input: inputSchema,
    readOnly: true,
    async execute(input) {
      const url = parseUrl(input.url);
      assertHostAllowed(url, allowHosts);

      const send = async (headers?: Record<string, string>): Promise<Response> => {
        try {
          // The shared hardened outbound path: private-IP deny by default,
          // per-hop redirect re-validation, timeout — never a raw fetch.
          return await guardedFetch(
            url.toString(),
            {
              allowedSchemes: ["http", "https"],
              hostAllowlist: allowHosts,
              denyPrivateIPsAfterDNS: !allowPrivateNetwork,
              timeoutMs,
            },
            headers ? { headers } : undefined,
          );
        } catch (cause) {
          if (cause instanceof OutboundPolicyError) {
            throw new WebToolError(`fetch_url blocked: ${cause.message}`, {
              type: "denied-host",
              cause,
            });
          }

          const message = cause instanceof Error ? cause.message : String(cause);

          throw new WebToolError(`fetch_url request failed: ${message}`, {
            type: "request-failed",
            cause,
          });
        }
      };

      let response = await send();

      if (retryOnChallenge && isChallenge(response)) {
        // One retry with browser-like headers; the same guarded path and policy apply.
        await response.body?.cancel().catch(() => undefined);
        response = await send(CHALLENGE_RETRY_HEADERS);
      }

      const { body, truncated } = await readBody(response, maxBytes);
      const rendered = await render(body, response.url || url.toString(), extract, extractor);

      return {
        url: response.url || url.toString(),
        status: response.status,
        content: rendered.content,
        truncated,
        ...(rendered.extractor ? { extractor: rendered.extractor } : {}),
      };
    },
  });
}
