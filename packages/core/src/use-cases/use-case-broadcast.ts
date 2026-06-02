import { log } from "@warlock.js/logger";
import type {
  UseCaseBroadcastEvent,
  UseCaseBroadcastOption,
  UseCaseConfigurations,
  UseCaseResult,
} from "./types";

/**
 * Broadcast a successful use-case result through the globally-configured channels.
 *
 * Fires only when the use case opted in (`broadcast`) and the global transport is
 * enabled with at least one channel. Fan-out is isolated via `Promise.allSettled` —
 * a failing channel is logged and never affects the use case or sibling channels.
 *
 * @example
 * await broadcastUseCaseResult({ name, id, output, result, broadcast, config });
 */
export async function broadcastUseCaseResult<Output>(params: {
  name: string;
  id: string;
  output: Output;
  result: UseCaseResult<Output>;
  broadcast?: UseCaseBroadcastOption<Output>;
  config?: UseCaseConfigurations["broadcast"];
}): Promise<void> {
  const { name, id, output, result, broadcast, config } = params;

  if (!broadcast) {
    return;
  }

  if (config?.enabled === false) {
    return;
  }

  const channels = config?.channels;

  if (!channels || channels.length === 0) {
    return;
  }

  const projector = typeof broadcast === "object" ? broadcast.output : undefined;
  const event = typeof broadcast === "object" && broadcast.event ? broadcast.event : name;
  const payload = projector ? projector(output, result) : output;

  const broadcastEvent: UseCaseBroadcastEvent = {
    useCase: name,
    event,
    id,
    at: new Date(),
    payload,
  };

  const outcomes = await Promise.allSettled(
    channels.map((channel) => channel.broadcast(broadcastEvent)),
  );

  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      log.error("use-cases", name, "broadcast channel failed", { error: outcome.reason });
    }
  }
}
