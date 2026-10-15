import {
  AIError,
  computeCost,
  generateRunId,
  ProviderError,
  REPORT_SCHEMA_VERSION,
  resolveObservers,
  stampReportLineage,
  type BaseReport,
  type ExecuteResult,
  type FlowObserveOption,
  type ModelPricing,
  type Usage,
} from "@warlock.js/ai";
import type {
  GeneratedVideo,
  VideoModelContract,
  VideoModelPricing,
} from "../contracts/video.contract";

/** Parameters for {@link video}. `model` comes from an adapter's `video({ name })`. */
export type VideoParams = {
  model: VideoModelContract;
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  negativePrompt?: string;
  signal?: AbortSignal;
  observe?: FlowObserveOption;
  sessionId?: string;
  name?: string;
  options?: Record<string, unknown>;
};

/** Success payload of a {@link video} run. */
export type VideoData = { video: GeneratedVideo };

/** The report node a {@link video} run produces (`type: "video"`). */
export type VideoReport = BaseReport & {
  type: "video";
  model: { name: string; provider: string };
  /** Final clip duration in seconds, when reported. */
  durationSeconds?: number;
};

/** Result envelope of {@link video} — the uniform `{ data, error, usage, report }`. */
export type VideoResult = ExecuteResult<VideoData> & { type: "video"; report: VideoReport };

/**
 * Generate a video from a text prompt — the moving-image verb of the
 * output-modality track. The adapter hides the provider's submit→poll
 * job, so this returns the framework's uniform never-throws envelope:
 *
 * - **Never throws.** Provider failures surface as a typed `AIError`.
 * - **Cost-truth.** `usage.cost` is filled per-second (Sora / Veo) or
 *   per-token, folding into the same `Usage.cost` rollup as everything else.
 * - **Observable.** The completed {@link VideoReport} routes to any
 *   registered `Observer` via the shared `observe` seam.
 *
 * @example
 * const { data, error } = await ai.video({
 *   model: sora.video({ name: "sora-2", pricing: { perSecond: 0.1 } }),
 *   prompt: "a timelapse of a city skyline at dusk, cinematic",
 *   durationSeconds: 8,
 * });
 * if (!error) download(data.video);
 */
export async function video(params: VideoParams): Promise<VideoResult> {
  const { model, prompt } = params;

  const runId = generateRunId("video");
  const startedAt = new Date().toISOString();
  const startPerf = performance.now();

  const usage: Usage = { input: 0, output: 0, total: 0 };
  let data: VideoData | undefined;
  let error: AIError | undefined;
  let status: VideoReport["status"] = "completed";
  let durationSeconds: number | undefined;

  try {
    const response = await model.generate(prompt, {
      durationSeconds: params.durationSeconds,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      negativePrompt: params.negativePrompt,
      signal: params.signal,
      ...params.options,
    });

    Object.assign(usage, response.usage);
    durationSeconds = response.durationSeconds;

    if (usage.cost === undefined) {
      const cost = computeVideoCost(usage, durationSeconds, model.pricing);
      if (cost !== undefined) {
        usage.cost = cost;
      }
    }

    data = { video: response.video };
  } catch (thrown) {
    error =
      thrown instanceof AIError ? thrown : new ProviderError(toMessage(thrown), { cause: thrown });
    status = params.signal?.aborted ? "cancelled" : "failed";
  }

  const report: VideoReport = {
    runId,
    rootRunId: runId,
    name: params.name ?? "video",
    type: "video",
    status,
    error,
    startedAt,
    endedAt: new Date().toISOString(),
    duration: performance.now() - startPerf,
    usage,
    children: [],
    model: { name: model.name, provider: model.provider },
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
  };

  stampReportLineage(report, { rootRunId: runId, sessionId: params.sessionId });

  for (const observer of resolveObservers(params.observe)) {
    try {
      await observer.collect(report);
    } catch {
      // Isolate observer failures — never break the run.
    }
  }

  return { type: "video", data, error, usage, report };
}

/**
 * Price a video run: `perSecond × durationSeconds` (per-second metering,
 * attributed to `cost.output`) wins when configured, otherwise the
 * standard token math. Returns `undefined` when no usable pricing is
 * present.
 */
function computeVideoCost(
  usage: Usage,
  durationSeconds: number | undefined,
  pricing: VideoModelPricing | undefined,
): ModelPricing | undefined {
  if (!pricing) {
    return undefined;
  }

  if (pricing.perSecond !== undefined) {
    if (durationSeconds === undefined) {
      return undefined;
    }
    return { input: 0, output: durationSeconds * pricing.perSecond };
  }

  if (pricing.input !== undefined && pricing.output !== undefined) {
    return computeCost(usage, { input: pricing.input, output: pricing.output });
  }

  return undefined;
}

/** Best-effort message for a non-`AIError` thrown value. */
function toMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
