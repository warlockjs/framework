import type { CliParsedEvent, CliUsage } from "../contracts";

function sum(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

/** Add two usages field by field; optional fields stay absent unless either side has them. */
export function addUsage(left: CliUsage | undefined, right: CliUsage): CliUsage {
  if (left === undefined) {
    return { ...right };
  }

  const merged: CliUsage = {
    input: left.input + right.input,
    output: left.output + right.output,
    total: left.total + right.total,
  };

  const cachedTokens = sum(left.cachedTokens, right.cachedTokens);
  const cacheWriteTokens = sum(left.cacheWriteTokens, right.cacheWriteTokens);
  const reasoningTokens = sum(left.reasoningTokens, right.reasoningTokens);
  const costUSD = sum(left.costUSD, right.costUSD);

  if (cachedTokens !== undefined) merged.cachedTokens = cachedTokens;
  if (cacheWriteTokens !== undefined) merged.cacheWriteTokens = cacheWriteTokens;
  if (reasoningTokens !== undefined) merged.reasoningTokens = reasoningTokens;
  if (costUSD !== undefined) merged.costUSD = costUSD;

  return merged;
}

/**
 * Folds parsed events into the pieces of a `CliResult`: the session ref,
 * usage, every complete message, and the final answer.
 *
 * Final-answer rule: the last `final: true` message (the vendor's own
 * result record) wins; otherwise the newest assistant text — a complete
 * message, or the deltas streamed since the last message or tool activity.
 */
export class ResultAggregator {
  public sessionRef?: string;
  public usage?: CliUsage;
  public readonly messages: string[] = [];
  public fatalError?: string;
  private finalText?: string;
  private deltaBuffer = "";
  private lastCompleteText?: string;

  public constructor(resume?: string) {
    this.sessionRef = resume;
  }

  public add(event: CliParsedEvent): void {
    switch (event.type) {
      case "session.started":
        if (event.sessionRef) {
          this.sessionRef = event.sessionRef;
        }
        break;
      case "message":
        if (event.delta) {
          this.deltaBuffer += event.text;
          break;
        }

        if (event.final) {
          this.finalText = event.text;
          break;
        }

        this.messages.push(event.text);
        this.lastCompleteText = event.text;
        this.deltaBuffer = "";
        break;
      case "tool.call":
      case "tool.result":
        this.flushDeltas();
        break;
      case "usage":
        this.usage = event.cumulative ? { ...event.usage } : addUsage(this.usage, event.usage);
        break;
      case "error":
        if (event.fatal && this.fatalError === undefined) {
          this.fatalError = event.message;
        }
        break;
    }
  }

  /** Close the stream: deltas never followed by a complete message count as one. */
  public finish(): void {
    this.flushDeltas();
  }

  public get text(): string {
    if (this.finalText !== undefined) {
      return this.finalText;
    }

    return this.deltaBuffer.length > 0 ? this.deltaBuffer : (this.lastCompleteText ?? "");
  }

  private flushDeltas(): void {
    if (this.deltaBuffer.trim().length > 0) {
      this.messages.push(this.deltaBuffer);
      this.lastCompleteText = this.deltaBuffer;
    }

    this.deltaBuffer = "";
  }
}
