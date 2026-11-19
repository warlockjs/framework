/** Usage of a span in `GET api/ai/runs/:id`. `cost` is the span's priced cost (USD per channel) when its model had pricing. */
export type AiUsage = {
  input: number;
  output: number;
  total?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  inputIncludesCache?: boolean;
  cost?: unknown;
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
