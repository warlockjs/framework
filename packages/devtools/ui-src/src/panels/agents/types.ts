/** A run row of `GET api/ai/agent-runs`. */
export type AgentRun = {
  runId: string;
  agent: string;
  status: string;
  startedAt: string;
  durationMs?: number | undefined;
  model: string;
  turns: number;
  toolCalls: number;
  refusals: number;
  usage: { input: number; output: number };
  cost?: number | undefined;
  requestId?: string | undefined;
};

export type AgentRunsAnswer = { available: boolean; message?: string; runs: AgentRun[] };

export type AgentToolCall = {
  name: string;
  status: string;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  refusal?: string;
  error?: { type?: string; message: string };
};

export type AgentTurn = {
  index: number;
  durationMs: number;
  input: string;
  finishReason?: string | null;
  systemPromptHash?: string | null;
  toolsHash: string;
  toolsOffered: { name: string; schemaHash: string; tokens: number }[];
  text?: string;
  toolCalls: AgentToolCall[];
  usage: { input: number; output: number; total?: number };
  cost?: number | undefined;
  contract: { type: string; tool?: string; name?: string; reason?: string }[];
  error?: { message: string };
};

/** `GET api/ai/agent-runs/:id`. */
export type AgentTraceDetail = {
  runId: string;
  agent: string;
  status: string;
  input: string;
  systemPrompt?: { hash: string; text?: string };
  toolSchemas: Record<string, { name: string; description: string; schema?: string }>;
  turns: AgentTurn[];
  error?: { message: string };
};
