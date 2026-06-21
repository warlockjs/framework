import type { ExporterContract, Trace, TraceSpan } from "../../contracts";
import type { AttributeValue } from "../utils";
import { GEN_AI_ATTRIBUTES, toGenAiAttributes, WARLOCK_ATTRIBUTES } from "../utils";
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
 * The root {@link TraceSpan} becomes a Langfuse trace AND its top
 * observation (so the root execution's own tokens are metered, not just
 * its children's); every node is an observation — a `generation` when it
 * metered its OWN tokens (LLM-backed agents, supervisors), otherwise a
 * plain `span` (tools, callbacks, and composite nodes whose tokens came
 * only from children). Timing, status, and version map 1:1; each
 * generation reports its own token usage (rolled-up minus children) so
 * the trace total isn't double-counted; non-usage GenAI attributes ride
 * along as metadata, and captured content (under `captureContent`)
 * surfaces as native `input` / `output`.
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
    metadata: langfuseMetadata(root),
  });

  // Emit the ROOT as an observation too — not just its children — so the
  // root execution's OWN tokens are metered. Langfuse derives the trace
  // total by summing observation usage; leaving the root (often the single
  // top-level agent) as trace-only would drop its own spend. Children nest
  // under the root observation, mirroring the execution tree, and own-usage
  // metering telescopes the per-node sums back to the true trace total.
  emitObservation(langfuseTrace, root);
}

/**
 * Map one {@link TraceSpan} onto a Langfuse observation under `parent`,
 * then recurse its children. Spans that metered their OWN tokens become
 * `generation`s; everything else (tools, callbacks, composite nodes)
 * becomes a plain `span`.
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
    metadata: langfuseMetadata(span),
  };

  // Captured content (only present under `captureContent`) maps onto
  // Langfuse's native observation input/output.
  if (span.input !== undefined) {
    body.input = span.input;
  }

  if (span.output !== undefined) {
    body.output = span.output;
  }

  let observation: LangfuseObservationLike;

  // Classify + meter on OWN tokens (this node's rolled-up usage minus its
  // children's), not the subtree rollup. A composite node whose tokens
  // came only from descendants has zero own-usage and becomes a plain
  // span — so its children's tokens aren't counted twice in the trace
  // total Langfuse sums across observations.
  const own = ownUsage(span);

  if (own.total > 0) {
    body.usage = {
      input: own.input,
      output: own.output,
      total: own.total,
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
 * Own token usage for a span — its rolled-up {@link TraceSpan.usage}
 * minus the rolled-up usage of its direct children. `TraceSpan.usage` is
 * the subtree total (this node plus every descendant), so subtracting the
 * children leaves the tokens THIS node alone metered, clamped at zero
 * defensively.
 *
 * Langfuse sums observation usage into the trace total, so reporting
 * own-usage on each generation (rather than the subtree rollup) is what
 * keeps the trace total correct instead of multiply-counting nested
 * spans. A composite node with no own tokens (e.g. a workflow whose
 * tokens all came from agent children) yields `total: 0` and is emitted
 * as a plain span, not a generation.
 */
function ownUsage(span: TraceSpan): { input: number; output: number; total: number } {
  let childInput = 0;
  let childOutput = 0;
  let childTotal = 0;

  for (const child of span.children) {
    childInput += child.usage.input;
    childOutput += child.usage.output;
    childTotal += child.usage.total;
  }

  return {
    input: Math.max(0, span.usage.input - childInput),
    output: Math.max(0, span.usage.output - childOutput),
    total: Math.max(0, span.usage.total - childTotal),
  };
}

/**
 * Token-usage + cost keys that the per-observation `usage` block already
 * carries authoritatively (as OWN usage). Omitting them from `metadata`
 * avoids a confusing contradiction — metadata would otherwise show the
 * rolled-up subtree totals next to an own-usage `usage` block. Cost is
 * omitted for the same reason; Langfuse prices the own tokens itself.
 */
const LANGFUSE_METADATA_OMIT = new Set<string>([
  GEN_AI_ATTRIBUTES.usageInputTokens,
  GEN_AI_ATTRIBUTES.usageOutputTokens,
  WARLOCK_ATTRIBUTES.totalTokens,
  WARLOCK_ATTRIBUTES.cachedTokens,
  WARLOCK_ATTRIBUTES.reasoningTokens,
  WARLOCK_ATTRIBUTES.costUsd,
]);

/**
 * Observation metadata — the GenAI attribute set minus the usage/cost
 * keys that live authoritatively on the `usage` block (see
 * {@link LANGFUSE_METADATA_OMIT}). Keeps model identity, report type,
 * version, session id, and any collector-set attributes.
 */
function langfuseMetadata(span: TraceSpan): Record<string, AttributeValue> {
  const all = toGenAiAttributes(span);
  const metadata: Record<string, AttributeValue> = {};

  for (const [key, value] of Object.entries(all)) {
    if (!LANGFUSE_METADATA_OMIT.has(key)) {
      metadata[key] = value;
    }
  }

  return metadata;
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
