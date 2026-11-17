/** A run row of `GET api/ai` (the Panoptic feed). */
export type AiUsage = {
  input: number;
  output: number;
  total?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  inputIncludesCache?: boolean;
};

export type AiRun = {
  traceId: string;
  requestId?: string | undefined;
  sessionId?: string;
  name: string;
  status: string;
  startedAt: string;
  duration: number;
  usage: AiUsage;
  cost?: number | undefined;
  models: string[];
  toolCalls: number;
  retries: number;
  cacheHits?: number | undefined;
  incomplete: boolean;
  truncatedTrips: number;
  compactions: number;
  skippedCompactions: number;
  providerCompactions: number;
};

export type AiAnswer = {
  available: boolean;
  message?: string;
  runs: AiRun[];
  aggregate?: { traces: number; usage: AiUsage };
};

export type AiSpanNode = {
  name: string;
  type: string;
  status: string;
  startedAt: string;
  endedAt: string;
  duration: number;
  usage?: AiUsage;
  attributes?: Record<string, unknown>;
  error?: { type?: string; message?: string };
  children: AiSpanNode[];
};

/** `GET api/ai/runs/:id`. */
export type AiTrace = { startedAt: string; root: AiSpanNode };
