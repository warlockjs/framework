import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ModelToolCallRequest } from "../contracts/model-tool-call-request.type";
import { SchemaValidationError } from "../errors";
import { extractJsonSchema } from "../utils/json-schema";
import { isProviderTool } from "./provider-tool";
import { tool, type ToolContract } from "./tool";

/** Metadata searchable without loading a tool's schema or implementation. */
export type LazyCatalogueTool = {
  name: string;
  description: string;
  tags?: readonly string[];
  /** Successful loads are shared for this catalogue; failed loads may be retried. */
  load(): ToolContract | Promise<ToolContract>;
};

/** Eager tools use `meta.tags: string[]` for optional search terms. */
export type CatalogueTool = ToolContract | LazyCatalogueTool;

export type ToolCatalogueOptions = {
  core?: readonly ToolContract[];
  searchable: readonly CatalogueTool[];
  /** Maximum results per search. A positive integer; defaults to 8. */
  limit?: number;
  searchName?: string;
  callName?: string;
};

export type CatalogueSearchInput = { query: string };
export type CatalogueCallInput = { name: string; input: unknown };
export type CatalogueSearchResult = {
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
};

export type ToolCatalogue = {
  /** A fresh array of the same stable tool identities, suitable for agent tools or ai.measure. */
  readonly tools: ToolContract[];
  readonly search: ToolContract<CatalogueSearchInput, CatalogueSearchResult>;
  /** Agent-dispatched only: standalone invoke/execute fails closed. */
  readonly call: ToolContract<CatalogueCallInput, never>;
};

type CatalogueRoute = {
  resolve(input: unknown): Promise<{ tool: ToolContract; input: unknown }>;
  names: readonly string[];
};

// Authority stays on registered tool identities, never on model-supplied fields.
const routes = new WeakMap<object, CatalogueRoute>();

/** Internal dispatch seam: resolution does not execute the target. */
export async function resolveCatalogueCall(
  registered: ToolContract,
  request: ModelToolCallRequest,
  signal?: AbortSignal,
): Promise<{ tool: ToolContract; request: ModelToolCallRequest } | undefined> {
  const route = routes.get(registered);
  if (!route) return undefined;
  signal?.throwIfAborted();
  const target = await route.resolve(request.input);
  signal?.throwIfAborted();
  return {
    tool: target.tool,
    request: { ...request, name: target.tool.name, input: target.input },
  };
}

/** Include hidden inventory in durable drift detection without loading schemas. */
export function catalogueToolNames(registered: object): readonly string[] {
  return routes.get(registered)?.names ?? [];
}

function schema<T>(
  jsonSchema: Record<string, unknown>,
  validate: (value: unknown) => StandardSchemaV1.Result<T>,
): StandardSchemaV1<T> & { jsonSchema: Record<string, unknown> } {
  return {
    "~standard": { version: 1, vendor: "warlock-ai", validate },
    jsonSchema,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const searchInput = schema<CatalogueSearchInput>(
  {
    type: "object",
    properties: { query: { type: "string", maxLength: 500 } },
    required: ["query"],
    additionalProperties: false,
  },
  (value) =>
    isRecord(value) && typeof value.query === "string" && value.query.length <= 500
      ? { value: { query: value.query } }
      : {
          issues: [
            { message: "Search input must contain a query string of at most 500 characters." },
          ],
        },
);

const callInput = schema<CatalogueCallInput>(
  {
    type: "object",
    properties: { name: { type: "string", minLength: 1 }, input: {} },
    required: ["name", "input"],
    additionalProperties: false,
  },
  (value) =>
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    Object.hasOwn(value, "input")
      ? { value: { name: value.name, input: value.input } }
      : { issues: [{ message: "Call input must contain a tool name and its input." }] },
);

function tags(entry: CatalogueTool): readonly string[] {
  const value = "load" in entry ? entry.tags : entry.meta?.tags;
  return Array.isArray(value)
    ? value.filter((tag: unknown): tag is string => typeof tag === "string")
    : [];
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Stable core + bounded schema discovery; hidden calls use the agent's normal dispatcher. */
export function catalogue(options: ToolCatalogueOptions): ToolCatalogue {
  const limit = options.limit ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Catalogue limit must be a positive safe integer.");
  }
  const searchName = options.searchName ?? "tool_search";
  const callName = options.callName ?? "tool_call";
  if (!searchName || !callName || searchName === callName) {
    throw new Error("Catalogue meta-tools must have distinct, non-empty names.");
  }
  const names = new Set([searchName, callName]);
  const core = [...(options.core ?? [])];
  const searchable: CatalogueTool[] = [];
  for (const entry of [...core, ...options.searchable]) {
    if (!entry.name || names.has(entry.name)) {
      throw new Error(`Duplicate or empty catalogue tool name: ${entry.name}`);
    }
    names.add(entry.name);
  }
  // Provider tools keep their original definitions and execution semantics.
  for (const entry of options.searchable) {
    if (isProviderTool(entry)) core.push(entry);
    else searchable.push(entry);
  }
  const index = searchable.map((entry) => ({
    entry,
    name: entry.name.toLowerCase(),
    description: entry.description.toLowerCase(),
    tags: tags(entry).map((tag) => tag.toLowerCase()),
  }));
  const loaded = new Map<string, Promise<ToolContract>>();
  const resolve = (entry: CatalogueTool): Promise<ToolContract> => {
    if (!("load" in entry)) return Promise.resolve(entry);
    const previous = loaded.get(entry.name);
    if (previous) return previous;
    const pending = Promise.resolve().then(async () => {
      const resolved = await entry.load();
      if (resolved.name !== entry.name || isProviderTool(resolved)) {
        throw new Error(`Catalogue loader must return the ordinary tool named "${entry.name}".`);
      }
      return resolved;
    });
    loaded.set(entry.name, pending);
    void pending.catch(() => {
      if (loaded.get(entry.name) === pending) loaded.delete(entry.name);
    });
    return pending;
  };
  const search = tool<CatalogueSearchInput, CatalogueSearchResult>({
    name: searchName,
    description: `Find tools by name, description or tags. Returns at most ${limit} real input schemas. Use ${callName} to invoke a result.`,
    input: searchInput,
    execute: async ({ query }, ctx) => {
      ctx?.signal?.throwIfAborted();
      const normalized = query.trim().toLowerCase();
      const terms = [...new Set(normalized.split(/\s+/u).filter((term) => term && term !== "*"))];
      if (!normalized) return { tools: [] };
      const matches = index
        .map((item) => {
          const scores = terms.map((term) =>
            item.name === term
              ? 100
              : item.name.includes(term)
                ? 20
                : item.tags.some((tag) => tag.includes(term))
                  ? 10
                  : item.description.includes(term)
                    ? 1
                    : 0,
          );
          return {
            ...item,
            score: scores.reduce<number>((sum, score) => sum + score, 0),
            matches: scores.every((score) => score > 0),
          };
        })
        .filter((item) => item.matches)
        .sort(
          (left, right) =>
            right.score - left.score || compareNames(left.entry.name, right.entry.name),
        )
        .slice(0, limit);
      const found: CatalogueSearchResult["tools"] = [];
      for (const { entry } of matches) {
        ctx?.signal?.throwIfAborted();
        const target = await resolve(entry);
        const inputSchema = target.input
          ? extractJsonSchema(target.input, { target: "draft-2020-12" })
          : { type: "object", properties: {}, additionalProperties: false };
        if (!inputSchema) {
          throw new Error(`Tool "${target.name}" does not expose a JSON input schema.`);
        }
        found.push({ name: target.name, description: target.description, inputSchema });
      }
      ctx?.signal?.throwIfAborted();
      return { tools: found };
    },
  });
  const call = tool<CatalogueCallInput, never>({
    name: callName,
    description: `Invoke a tool found by ${searchName}, using its exact name and input schema. The target's normal policy and approval checks apply.`,
    input: callInput,
    execute: async () => {
      throw new Error(
        "Catalogue calls require agent dispatch so target policy and approval checks can run.",
      );
    },
  });
  routes.set(call, {
    names: searchable.map((entry) => entry.name),
    async resolve(raw) {
      const checked = await callInput["~standard"].validate(raw);
      if (checked.issues) {
        throw new SchemaValidationError("Invalid catalogue call input.", {
          issues: checked.issues,
        });
      }
      const entry = searchable.find((item) => item.name === checked.value.name);
      if (!entry) throw new Error(`Tool not available in catalogue: ${checked.value.name}`);
      return { tool: await resolve(entry), input: checked.value.input };
    },
  });
  const advertised = Object.freeze([...core, search, call]);
  return {
    get tools() {
      return [...advertised];
    },
    search,
    call,
  };
}
