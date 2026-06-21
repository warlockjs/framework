import type { ExporterContract, Trace, TraceSpan } from "../../contracts";
import { toGenAiAttributes } from "../utils";
import type {
  LangfuseClientLike,
  LangfuseExporterOptions,
  LangfuseObservationBody,
  LangfuseObservationLevel,
  LangfuseObservationLike,
  LangfuseTraceLike,
} from "./langfuse-exporter.type";

const EXPORTER_NAME = "langfuse";

// ============================================================
// Lazily-loaded langfuse SDK (OPTIONAL peer)
// ============================================================

let LangfuseSdk: typeof import("langfuse");
let isModuleExists: boolean | null = null;
let loadingPromise: Promise<void> | undefined;

const LANGFUSE_INSTALL_INSTRUCTIONS = `
The Panoptic Langfuse exporter requires the langfuse package.
Install it with:

  npm install langfuse

Or with your preferred package manager:

  pnpm add langfuse
  yarn add langfuse
`.trim();

/**
 * Settle the lazy import of `langfuse` once, concurrency-safe. Only
 * needed when the caller did not pass a ready `client`. A bare `catch`
 * flips the flag to `false`; the curated install string surfaces at use
 * time, never a raw module-resolution stack trace.
 */
function loadLangfuse(): Promise<void> {
  if (isModuleExists !== null) {
    return Promise.resolve();
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      LangfuseSdk = await import("langfuse");
      isModuleExists = true;
    } catch {
      isModuleExists = false;
    }
  })();

  return loadingPromise;
}

/**
 * {@link ExporterContract} that maps Panoptic traces onto Langfuse
 * traces and observations. Lazily imports `langfuse` so it stays an
 * OPTIONAL peer — importing this module never forces the SDK to be
 * installed, and a missing SDK surfaces as a curated "install this"
 * error when the exporter first needs to build a client.
 *
 * The root {@link TraceSpan} becomes a Langfuse trace; each descendant
 * becomes a nested observation — a `generation` when it produced tokens
 * (LLM-backed agents, supervisors), otherwise a plain `span` (tools,
 * callbacks). Timing, status, version, and rolled-up `usage` are mapped
 * 1:1; the rest of the GenAI attributes ride along as observation
 * metadata.
 *
 * @example
 * collector.use(langfuseExporter({ publicKey: "pk-...", secretKey: "sk-..." }));
 * // or reuse an existing client:
 * collector.use(langfuseExporter({ client: myLangfuse }));
 */
export function langfuseExporter(options: LangfuseExporterOptions): ExporterContract {
  let client: LangfuseClientLike | undefined = options.client;

  if (!client) {
    loadLangfuse();
  }

  const resolveClient = async (): Promise<LangfuseClientLike> => {
    if (client) {
      return client;
    }

    await loadLangfuse();

    if (!isModuleExists) {
      throw new Error(LANGFUSE_INSTALL_INSTRUCTIONS);
    }

    client = new LangfuseSdk.Langfuse({
      publicKey: options.publicKey,
      secretKey: options.secretKey,
      baseUrl: options.baseUrl,
    }) as unknown as LangfuseClientLike;

    return client;
  };

  return {
    name: EXPORTER_NAME,
    async export(trace: Trace): Promise<void> {
      const activeClient = await resolveClient();
      emitTrace(activeClient, trace);
    },
    async flush(): Promise<void> {
      if (!client) {
        return;
      }

      await client.flushAsync();
    },
    async shutdown(): Promise<void> {
      if (!client) {
        return;
      }

      await client.shutdownAsync();
    },
  };
}

/**
 * Create the Langfuse trace from the root span, then recurse the
 * children into nested observations.
 */
function emitTrace(client: LangfuseClientLike, trace: Trace): void {
  const root = trace.root;

  const langfuseTrace = client.trace({
    id: root.traceId,
    name: root.name,
    sessionId: trace.sessionId,
    version: root.version,
    timestamp: new Date(root.startedAt),
    metadata: toGenAiAttributes(root),
  });

  for (const child of root.children) {
    emitObservation(langfuseTrace, child);
  }
}

/**
 * Map one {@link TraceSpan} onto a Langfuse observation under `parent`,
 * then recurse its children. Token-producing spans become
 * `generation`s; everything else becomes a plain `span`.
 */
function emitObservation(
  parent: LangfuseTraceLike | LangfuseObservationLike,
  span: TraceSpan,
): void {
  const body: LangfuseObservationBody = {
    id: span.spanId,
    name: span.name,
    startTime: new Date(span.startedAt),
    endTime: new Date(span.endedAt),
    level: toLevel(span),
    statusMessage: span.error?.message,
    version: span.version,
    metadata: toGenAiAttributes(span),
  };

  let observation: LangfuseObservationLike;

  if (producedTokens(span)) {
    body.usage = {
      input: span.usage.input,
      output: span.usage.output,
      total: span.usage.total,
      unit: "TOKENS",
    };
    observation = parent.generation(body);
  } else {
    observation = parent.span(body);
  }

  for (const child of span.children) {
    emitObservation(observation, child);
  }

  // Explicitly end the observation. The body already carries `endTime`,
  // so this is idempotent — but the SDK only finalizes (and flushes) an
  // observation on `end()`, so without it long-lived clients can leave
  // observations open. Safe against the local `LangfuseObservationLike`
  // shape, which declares `end(body?)`.
  observation.end({ endTime: body.endTime });
}

/**
 * A span counts as an LLM `generation` when it metered any tokens. Pure
 * tools/callbacks contribute zero own-cost and map to plain spans.
 *
 * **Known limitation.** `TraceSpan.usage` is the ROLLED-UP usage (this
 * node's own cost plus the sum of its children), not own-usage — the
 * core `BaseReport` exposes no separate own-usage field, so a composite
 * node (e.g. an agent that itself made no model call but whose tool
 * children did) is classified as a `generation` on its children's
 * tokens. We cannot classify on own-usage until the report shape carries
 * it; the rolled-up `usage` block emitted on such a generation therefore
 * double-counts tokens already attributed to descendant observations.
 */
function producedTokens(span: TraceSpan): boolean {
  return span.usage.total > 0;
}

/**
 * Map the Panoptic span status onto a Langfuse observation level —
 * failed/cancelled spans surface as `ERROR`, everything else `DEFAULT`.
 */
function toLevel(span: TraceSpan): LangfuseObservationLevel {
  if (span.status === "failed" || span.status === "cancelled") {
    return "ERROR";
  }

  return "DEFAULT";
}
