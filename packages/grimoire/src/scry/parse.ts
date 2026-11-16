/**
 * Turns `warlock scry` arguments (and MCP tool inputs) into one `ScryQuery`.
 */
import { GrimoireError } from "../codes";
import type { ScryQuery } from "../contracts/scry";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROUTE = /^\s*([A-Za-z]+)\s+(\/\S*)\s*$/;
const QUERY_OPTIONS = ["impact", "route", "feature", "flow", "search"] as const;
const FORMS =
  'warlock scry <file> | --impact <file> | --route "<METHOD path>" | --feature <id> | --flow <feature>/<flow> | --search "<text>"';

function malformed(message: string): GrimoireError {
  return new GrimoireError("GR9006", message);
}

/** A string option value, or an error naming the option when it was given without one. */
function textOf(name: string, value: string | boolean | number): string {
  if (typeof value === "boolean") throw malformed(`--${name} needs a value. Use: ${FORMS}.`);

  const text = String(value).trim();

  if (text === "") throw malformed(`--${name} needs a value. Use: ${FORMS}.`);

  return text;
}

/** `GET /api/products` → `{ method: "GET", path: "/api/products" }`. */
export function parseRouteText(text: string): { method: string; path: string } {
  const match = ROUTE.exec(text);

  if (!match || match[1] === undefined || match[2] === undefined) {
    throw malformed(
      `route ${JSON.stringify(text)} is not "<METHOD> <path>"; pass it like "GET /api/products".`,
    );
  }

  return { method: match[1].toUpperCase(), path: match[2] };
}

/** `catalog/new-arrivals` → `{ feature, flow }`. */
export function parseFlowText(text: string): { feature: string; flow: string } {
  const [feature, flow, ...rest] = text.trim().split("/");

  if (
    feature === undefined ||
    flow === undefined ||
    rest.length > 0 ||
    !ID.test(feature) ||
    !ID.test(flow)
  ) {
    throw malformed(
      `flow ${JSON.stringify(text)} is not "<feature>/<flow>"; pass it like "catalog/new-arrivals".`,
    );
  }

  return { feature, flow };
}

/** A feature id, checked. */
export function parseFeatureText(text: string): string {
  const feature = text.trim();

  if (!ID.test(feature)) {
    throw malformed(
      `feature ${JSON.stringify(text)} is not a feature id; use the folder name under grimoire/features/.`,
    );
  }

  return feature;
}

/** A positive whole number of hits, or an error. */
export function parseLimit(value: string | boolean | number): number {
  const limit = typeof value === "number" ? value : Number(String(value).trim());

  if (typeof value === "boolean" || !Number.isInteger(limit) || limit < 1) {
    throw malformed(`--limit must be a whole number above 0, got ${JSON.stringify(value)}.`);
  }

  return limit;
}

/**
 * The query of `warlock scry` arguments: a positional file, or one of the
 * options `impact`, `route`, `feature`, `flow`, `search` (with `limit`).
 * Throws `GrimoireError` `GR9006` for none, several, or a malformed value.
 */
export function parseScryQuery(
  args: readonly string[],
  options: Readonly<Record<string, string | boolean | number>>,
): ScryQuery {
  const given = QUERY_OPTIONS.filter(
    (name) => options[name] !== undefined && options[name] !== false,
  );
  const files = args.filter((arg) => arg.trim() !== "");

  if (given.length + (files.length > 0 ? 1 : 0) === 0)
    throw malformed(`Nothing to look up. Use: ${FORMS}.`);

  if (files.length > 1 || given.length + (files.length > 0 ? 1 : 0) > 1) {
    const asked = [...(files.length > 0 ? ["<file>"] : []), ...given.map((name) => `--${name}`)];

    throw malformed(`Ask one question at a time; got ${asked.join(", ")}. Use: ${FORMS}.`);
  }

  if (files[0] !== undefined) return { type: "file", file: files[0].trim() };

  const name = given[0];
  const value = name === undefined ? undefined : options[name];

  if (name === undefined || value === undefined)
    throw malformed(`Nothing to look up. Use: ${FORMS}.`);

  const text = textOf(name, value);

  switch (name) {
    case "impact":
      return { type: "impact", file: text };
    case "route":
      return { type: "route", ...parseRouteText(text) };
    case "feature":
      return { type: "feature", feature: parseFeatureText(text) };
    case "flow":
      return { type: "flow", ...parseFlowText(text) };
    case "search": {
      const limit = options.limit;

      return limit === undefined
        ? { type: "search", text }
        : { type: "search", text, limit: parseLimit(limit) };
    }
  }
}
