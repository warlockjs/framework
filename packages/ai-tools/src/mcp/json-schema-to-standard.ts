import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * The inverse of `@warlock.js/ai`'s `extractJsonSchema` (which goes
 * Standard Schema → JSON Schema). Here we wrap a raw JSON Schema as a
 * {@link StandardSchemaV1} whose `~standard.validate` runs a lazily-imported
 * Ajv validator — so an MCP server's `inputSchema` (JSON Schema) becomes a
 * `ToolConfig.input` the `tool()` factory can validate against.
 *
 * Ajv is an OPTIONAL peer, lazy-imported on first validate following the
 * langfuse/readability pattern: a missing peer surfaces a curated install
 * string (via the returned issues), never a raw module-resolution stack.
 */

/** The structural vendor template, mirroring `passthroughSchema()`. */
const VENDOR = "warlock-ai";

// ============================================================
// Lazily-loaded ajv (OPTIONAL peer)
// ============================================================

/**
 * Minimal structural view of an Ajv-compiled validator. Ajv is an optional
 * peer that may not be installed, so we model only the surface we touch
 * rather than depending on ajv's own published types. A validator is a
 * callable that returns a boolean and exposes the `errors` it collected.
 */
interface AjvValidateFunctionLike {
  (data: unknown): boolean;
  errors?: AjvErrorObject[] | null;
}

/** Minimal structural view of an `Ajv` instance — only `compile`. */
interface AjvInstanceLike {
  compile(schema: Record<string, unknown>): AjvValidateFunctionLike;
}

/** The `Ajv` constructor, as exposed by both the CJS and ESM builds. */
type AjvConstructorLike = new (options?: Record<string, unknown>) => AjvInstanceLike;

/**
 * Minimal structural view of the dynamically imported `ajv` module. Ajv
 * ships its constructor as a `default` export under ESM interop; the older
 * CJS shape exposes the constructor as the module namespace itself, so
 * `default` is optional here and the loader falls back to the namespace.
 */
interface AjvModuleLike {
  default?: AjvConstructorLike;
}

let AjvSdk: AjvModuleLike | undefined;
let ajvInstance: AjvInstanceLike | undefined;
let isAjvAvailable: boolean | undefined;
let loadingPromise: Promise<void> | undefined;

const AJV_INSTALL_INSTRUCTIONS = `
The MCP client's JSON-Schema validation requires the ajv package.
Install it with:

  npm install ajv

Or with your preferred package manager:

  pnpm add ajv
  yarn add ajv
`.trim();

/**
 * Settle the lazy import of `ajv` once, concurrency-safe. A bare `catch`
 * flips the availability flag to `false`; the curated install string then
 * surfaces at validate time as a Standard Schema issue, never a raw
 * module-resolution error. The constructed `Ajv` instance is cached and
 * reused for every schema compile.
 */
async function loadAjv(): Promise<void> {
  if (isAjvAvailable !== undefined) {
    return;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      AjvSdk = (await import("ajv")) as AjvModuleLike;
      // Ajv ships as a default export under both CJS and ESM interop; the
      // older CJS shape exposes the constructor as the namespace itself.
      const AjvCtor: AjvConstructorLike =
        AjvSdk.default ?? (AjvSdk as unknown as AjvConstructorLike);
      ajvInstance = new AjvCtor({ allErrors: true, strict: false });
      isAjvAvailable = true;
    } catch {
      isAjvAvailable = false;
    }
  })();

  return loadingPromise;
}

/**
 * Compile a JSON Schema with the shared Ajv instance, caching the compiled
 * validator on a closure so repeated validations don't recompile. A schema
 * Ajv itself rejects at compile time (an invalid meta-schema) degrades to
 * an accept-all validator so a malformed remote schema can't wedge the
 * tool — the server, not us, owns its schema's correctness.
 */
function makeCompiler(schema: Record<string, unknown>): () => AjvValidateFunctionLike | undefined {
  let compiled: AjvValidateFunctionLike | undefined;
  let attempted = false;

  return () => {
    if (attempted) {
      return compiled;
    }

    attempted = true;

    if (!ajvInstance) {
      return undefined;
    }

    try {
      compiled = ajvInstance.compile(schema);
    } catch {
      compiled = undefined;
    }

    return compiled;
  };
}

/**
 * Wrap a raw JSON Schema as a {@link StandardSchemaV1} whose
 * `~standard.validate` runs Ajv. The shape mirrors `passthroughSchema()`
 * (`{ "~standard": { version: 1, vendor, validate } }`) so it drops into
 * `tool({ input })` exactly like a native seal schema.
 *
 * Validation behavior:
 * - **Valid input** → `{ value }` (the input is passed through unchanged;
 *   Ajv validates, it does not transform).
 * - **Invalid input** → `{ issues }` carrying Ajv's `instancePath` +
 *   message per failure, so `tool()` produces a `SchemaValidationError`.
 * - **Missing `ajv` peer** → a single issue carrying the curated install
 *   string, surfaced the same way (a developer-facing message in logs).
 * - **No / empty schema** → an accept-all passthrough (an MCP tool may
 *   advertise no `inputSchema`).
 *
 * @param schema - The JSON Schema (an MCP tool's `inputSchema`), or
 *   `undefined` for a no-argument tool.
 * @returns A `StandardSchemaV1<TInput>` ready for `tool({ input })`.
 *
 * @example
 * const input = jsonSchemaToStandard<{ q: string }>({
 *   type: "object",
 *   properties: { q: { type: "string" } },
 *   required: ["q"],
 * });
 */
export function jsonSchemaToStandard<TInput = unknown>(
  schema: Record<string, unknown> | undefined,
): StandardSchemaV1<TInput> {
  // A tool with no schema (or an empty object schema) validates everything
  // — return an accept-all passthrough and never touch Ajv.
  if (!schema || Object.keys(schema).length === 0) {
    return {
      "~standard": {
        version: 1,
        vendor: VENDOR,
        validate: (value: unknown) => ({ value: value as TInput }),
      },
    };
  }

  const compile = makeCompiler(schema);

  return {
    "~standard": {
      version: 1,
      vendor: VENDOR,
      async validate(value: unknown): Promise<StandardSchemaV1.Result<TInput>> {
        await loadAjv();

        if (!isAjvAvailable) {
          return {
            issues: [{ message: AJV_INSTALL_INSTRUCTIONS }],
          };
        }

        const validator = compile();

        // A schema Ajv could not compile degrades to accept-all rather
        // than failing every call — the remote server owns its schema.
        if (!validator) {
          return { value: value as TInput };
        }

        const ok = validator(value);

        if (ok) {
          return { value: value as TInput };
        }

        const issues: StandardSchemaV1.Issue[] = (validator.errors ?? []).map((error) => ({
          message: formatAjvError(error),
          path: pathFromInstancePath(error.instancePath),
        }));

        return {
          issues: issues.length > 0 ? issues : [{ message: "input failed JSON Schema validation" }],
        };
      },
    },
  };
}

/** A single Ajv error object — narrowed to the fields we read. */
interface AjvErrorObject {
  instancePath?: string;
  message?: string;
  keyword?: string;
}

/**
 * Render one Ajv error into a human-readable issue message. Prefixes the
 * failing instance path (when present) so the model can see WHICH field
 * was wrong, e.g. `/query: must be string`.
 */
function formatAjvError(error: AjvErrorObject): string {
  const where = error.instancePath ? `${error.instancePath}: ` : "";
  const message = error.message ?? `failed "${error.keyword ?? "validation"}"`;

  return `${where}${message}`;
}

/**
 * Convert an Ajv `instancePath` (a JSON-Pointer like `/items/0/name`) into
 * the Standard Schema `path` segment array (`["items", "0", "name"]`).
 * Empty paths (a root-level failure) become an empty array.
 */
function pathFromInstancePath(instancePath: string | undefined): string[] {
  if (!instancePath) {
    return [];
  }

  return instancePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Reset the cached lazy-import state. Test-only seam so a spec can mock
 * `ajv` as present/absent across cases without module-cache bleed.
 *
 * @internal
 */
export function resetAjvCacheForTests(): void {
  AjvSdk = undefined;
  ajvInstance = undefined;
  isAjvAvailable = undefined;
  loadingPromise = undefined;
}
