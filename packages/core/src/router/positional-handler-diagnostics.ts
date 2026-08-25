/**
 * Early detection of route handlers still written against the **v4 positional
 * signature** — `(request, response)` — after v5 moved to a single context
 * object, `({ request, response })`.
 *
 * ## Why this exists
 *
 * A v4 handler is not rejected anywhere. It registers fine, and the router
 * calls it with one argument, so `response` is simply `undefined`. The app only
 * breaks on the first request that reaches it, with:
 *
 *     TypeError: Cannot read properties of undefined (reading 'success')
 *
 * That message names nothing the reader can act on — not the route, not the
 * handler, not the change to make. This module turns that late, opaque failure
 * into one explicit list printed at boot, and into a `warlock doctor` check.
 *
 * The break itself is intentional; nothing here restores the positional form.
 * Detection and diagnostics only.
 *
 * ## Why it warns and never throws
 *
 * The signal is a heuristic (see {@link looksLikePositionalHandler}), so a
 * false positive is possible in principle. Turning one into a boot failure
 * would take a working application down over a guess, which is strictly worse
 * than the problem being diagnosed. Everything on this path is therefore a
 * warning: nothing here throws, and nothing here changes how a handler is
 * called. A miss simply degrades to the old runtime `TypeError`.
 */

import { log } from "@warlock.js/logger";
import type { Route } from "./types";

/**
 * One route whose handler looks like it was written for v4.
 */
export type PositionalHandlerSuspect = {
  /** HTTP method the route was registered under. */
  method: Route["method"];

  /** Full route path, prefixes already applied. */
  path: string;

  /** Handler function name, or `"(anonymous)"` when it has none. */
  handlerName: string;

  /** Route file the route came from, when the router knows it. */
  sourceFile: string;
};

/**
 * Collected across the whole registration pass so the warning can be emitted
 * ONCE, as a single list, rather than one line per route (or — as before — one
 * mystery 500 per request).
 */
const suspects: PositionalHandlerSuspect[] = [];

/**
 * Split the parameter list of a function's source into top-level parameters.
 *
 * Depth-aware and quote-aware, because a default value may itself contain
 * commas, parentheses, braces or strings — `(request, response = f(a, b))` is
 * two parameters, not three. Anything unbalanced returns `undefined`: refusing
 * to guess is what keeps a parse quirk from becoming a false warning.
 *
 * @param openIndex index of the `(` that opens the parameter list.
 */
function splitTopLevelParameters(source: string, openIndex: number): string[] | undefined {
  const parameters: string[] = [];

  let depth = 0;
  let current = "";
  let quote = "";

  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];

    if (quote) {
      if (char === "\\") {
        current += char + (source[index + 1] ?? "");
        index++;
        continue;
      }

      if (char === quote) {
        quote = "";
      }

      current += char;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth++;

      // The paren that opens the list is punctuation, not part of a parameter.
      if (depth === 1) continue;

      current += char;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      depth--;

      if (depth === 0) {
        if (current.trim()) {
          parameters.push(current.trim());
        }

        return parameters;
      }

      current += char;
      continue;
    }

    if (char === "," && depth === 1) {
      parameters.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  // Never found the closing paren — treat the source as unreadable.
  return undefined;
}

/**
 * Read a function's declared parameters from its own source.
 *
 * Returns `undefined` whenever the source cannot be trusted, which callers must
 * treat as "no information" rather than "no parameters":
 *
 * - `Function.prototype.bind` replaces the body with `[native code]`, so every
 *   `[Controller, "method"]` tuple handler lands here (the router binds them);
 * - native functions likewise;
 * - a class, whose first `(` belongs to a constructor or a method, not to a
 *   parameter list;
 * - anything that fails to parse.
 */
function readParameterList(handler: Function): string[] | undefined {
  let source: string;

  try {
    source = Function.prototype.toString.call(handler);
  } catch {
    return undefined;
  }

  if (source.includes("[native code]")) return undefined;

  if (/^\s*class[\s{]/.test(source)) return undefined;

  // A single parameter needs no parentheses: `ctx => …`, `async ctx => …`.
  const bareArrow = source.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/);

  if (bareArrow) return [bareArrow[1]];

  const openIndex = source.indexOf("(");

  if (openIndex === -1) return undefined;

  return splitTopLevelParameters(source, openIndex);
}

/**
 * Whether a parameter is written as a destructuring pattern — `{ request }` or
 * `[a, b]` — as opposed to a plain name.
 */
function isDestructured(parameter: string) {
  const start = parameter.trimStart();

  return start.startsWith("{") || start.startsWith("[");
}

/**
 * Does this handler look like it was written for the v4 positional signature?
 *
 * ## The signal, and what it misses
 *
 * `Function.length` alone is not enough, because it stops counting at the first
 * defaulted parameter:
 *
 * | handler                            | `.length` | actually |
 * | ---------------------------------- | --------- | -------- |
 * | `({ request, response }) => …`     | 1         | v5       |
 * | `(ctx) => …`                       | 1         | v5       |
 * | `(request, response) => …`         | 2         | v4       |
 * | `(request, response = x) => …`     | 1         | v4       |
 *
 * So the primary signal is the function's own source: a handler is suspect when
 * it declares **two or more** parameters and the first is **not** destructured.
 * Reading the source catches the defaulted row that arity cannot, and rules out
 * the `({ … }, extra)` shape that arity would wrongly flag.
 *
 * When the source is unreadable — a bound or native function — this falls back
 * to `handler.length >= 2`, which `bind` preserves. That is a weaker signal but
 * never a wrong one for the common cases; it only loses the defaulted row.
 *
 * ## What is still missed, by design
 *
 * A one-parameter v4 handler (`(request) => …`) is indistinguishable from a v5
 * `(ctx) => …` and is deliberately not flagged — guessing there would produce
 * false positives on correct code. False positives against the canonical
 * `({ … })` form are essentially nil, and every miss simply leaves today's
 * behaviour in place.
 */
export function looksLikePositionalHandler(handler: unknown): boolean {
  if (typeof handler !== "function") return false;

  const parameters = readParameterList(handler);

  if (parameters) {
    return parameters.length >= 2 && !isDestructured(parameters[0]);
  }

  return handler.length >= 2;
}

/**
 * The name to print for a handler.
 *
 * `Function.bind` prefixes the name with `"bound "`, and the router binds every
 * `[Controller, "method"]` tuple handler. The bare method name is what the user
 * actually wrote, so that is what gets printed.
 */
function handlerDisplayName(handler: Function): string {
  return handler.name?.replace(/^bound /, "").trim() || "(anonymous)";
}

/**
 * Inspect one route's handler as it registers, recording it when it looks like
 * the v4 positional form. Called from `Router.add`, so the cost is paid once per
 * route at registration and never per request.
 *
 * Deliberately total: any unexpected failure in the heuristic is swallowed, so a
 * diagnostic can never be the reason a route fails to register.
 */
export function inspectHandlerSignature(
  handler: unknown,
  route: { method: Route["method"]; path: string; sourceFile: string },
) {
  try {
    if (!looksLikePositionalHandler(handler)) return;

    suspects.push({
      method: route.method,
      path: route.path,
      handlerName: handlerDisplayName(handler as Function),
      sourceFile: route.sourceFile,
    });
  } catch {
    // A diagnostic must never break registration.
  }
}

/**
 * Every suspect recorded so far, in registration order.
 */
export function listPositionalHandlerSuspects(): readonly PositionalHandlerSuspect[] {
  return suspects;
}

/**
 * Drop the suspects belonging to a route file. Kept in step with
 * `Router.removeRoutesBySourceFile` so an HMR reload that fixes a handler does
 * not keep reporting the version it replaced.
 */
export function forgetPositionalHandlerSuspects(sourceFile: string) {
  for (let index = suspects.length - 1; index >= 0; index--) {
    if (suspects[index].sourceFile === sourceFile) {
      suspects.splice(index, 1);
    }
  }
}

/**
 * Drop every recorded suspect. Intended for tests, which share the router
 * singleton.
 */
export function clearPositionalHandlerSuspects() {
  suspects.length = 0;
}

/**
 * The one-line diagnostic for a single route. Written for someone who has never
 * read Warlock's internals: it names the handler, the route, what is wrong, and
 * the exact edit that fixes it.
 */
export function describePositionalHandlerSuspect(suspect: PositionalHandlerSuspect): string {
  return (
    `Handler "${suspect.handlerName}" (${suspect.method} ${suspect.path}) looks like ` +
    `the v4 positional signature (request, response). ` +
    `v5 passes a single context object — change it to ({ request, response }).`
  );
}

/**
 * The full boot-time warning: every suspect, once, in one entry.
 *
 * One boot, one list — not one warning per route, and emphatically not one 500
 * per request. Returns the reported suspects so callers can assert on them.
 */
export function reportPositionalHandlerSuspects(logger: Pick<typeof log, "warn"> = log) {
  const reported = [...suspects];

  if (reported.length === 0) return reported;

  const headline =
    reported.length === 1
      ? "1 route handler looks like the v4 positional signature."
      : `${reported.length} route handlers look like the v4 positional signature.`;

  logger.warn({
    module: "router",
    action: "handlerSignature",
    message:
      `${headline} Warlock v5 calls every route handler with a single context object, ` +
      `so a second parameter is always undefined and the request fails as soon as it is used:\n` +
      reported.map((suspect) => `  - ${describePositionalHandlerSuspect(suspect)}`).join("\n"),
    context: { handlers: reported },
  });

  return reported;
}
