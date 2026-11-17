import { LogChannel, log, type LoggingData } from "@warlock.js/logger";
import { currentRequestId } from "../current-request-id";
import { toSafeValue } from "../safe-value";
import type { DevtoolsCollector, DevtoolsDisposer, DevtoolsLogEntry } from "../types";

/** `LoggingData.type` includes `fatal`, which devtools folds into `error`. */
function toDevtoolsLevel(type: LoggingData["type"]): DevtoolsLogEntry["level"] {
  return type === "fatal" ? "error" : type;
}

/**
 * The entry's message as text. `request.log(error)` and friends log an Error
 * (or any value) as the message; kept as is, it reached the dashboard as `{}`.
 */
function messageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return `${message.name}: ${message.message}`;

  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}

class DevtoolsLogChannel extends LogChannel {
  public override name = "devtools";
  public active = true;

  public constructor(private readonly collector: DevtoolsCollector) {
    super();
  }

  public log(data: LoggingData): void {
    if (!this.active) return;

    // Already passed through the logger's redaction floor (`Logger.log`
    // applies it before invoking any channel). It is still app data, and can
    // hold live objects (a request, its socket), so a JSON-safe snapshot is
    // kept instead of the object itself.
    const entry: DevtoolsLogEntry = {
      level: toDevtoolsLevel(data.type),
      module: data.module,
      action: data.action,
      message: messageText(data.message),
      at: Date.now(),
      context: toSafeValue(data.context),
    };

    this.collector.addLog(currentRequestId(), entry);
  }
}

/**
 * Feeds every log entry, from `@warlock.js/logger`, into the collector by
 * registering an additional channel. `Logger` has no way to remove a
 * channel, so the disposer flag-ignores further entries instead — the
 * channel stays registered for the process's lifetime.
 */
export async function attachLogSource(collector: DevtoolsCollector): Promise<DevtoolsDisposer> {
  const channel = new DevtoolsLogChannel(collector);

  log.addChannel(channel);

  return () => {
    channel.active = false;
  };
}
