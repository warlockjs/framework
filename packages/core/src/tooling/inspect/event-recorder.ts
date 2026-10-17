import events from "@mongez/events";
import type { InspectEvent } from "./inspect-report.types";

/** One listener an app module registered. */
export type RecordedListener = {
  event: string;
  /** The listener's function name, `"anonymous"` when it has none. */
  name: string;
  /** Project-relative file whose import registered it. */
  sourceFile: string;
};

/** The slice of an `@mongez/events` bus the recorder wraps. */
type EventBus = {
  subscribe: (event: string, callback: (...args: never[]) => unknown) => unknown;
};

function isEventBus(value: unknown): value is EventBus {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "subscribe") === "function"
  );
}

function listenerName(callback: unknown): string {
  if (typeof callback !== "function") return "anonymous";

  const name = callback.name.replace(/^bound /, "").trim();

  return name.length > 0 ? name : "anonymous";
}

/** The file the module loader is importing right now, if any. */
function currentModuleFile(): string | undefined {
  const file: unknown = Reflect.get(globalThis, "__currentModuleFile");

  if (typeof file !== "object" || file === null) return undefined;

  const relativePath = Reflect.get(file, "relativePath");

  return typeof relativePath === "string" ? relativePath : undefined;
}

/**
 * Records the listeners app modules register on `@mongez/events` while they
 * are imported.
 *
 * The bus keeps its subscriptions private and does not say who registered
 * them, so the recorder wraps `subscribe` (which `on` and `addEventListener`
 * call) for the duration of the boot pass and notes the module being imported
 * at that moment. Listeners registered outside an app module import (by the
 * framework itself) are not app facts and are not recorded.
 */
export class EventRecorder {
  private readonly records: RecordedListener[] = [];

  private readonly restores: (() => void)[] = [];

  /**
   * Start recording on the given buses (core's own `@mongez/events` instance
   * when none are given). A bus is wrapped once even if listed twice.
   */
  public start(buses: readonly unknown[] = [events]): this {
    const seen = new Set<unknown>();

    for (const bus of buses) {
      if (!isEventBus(bus) || seen.has(bus)) continue;

      seen.add(bus);

      const original = bus.subscribe;
      const hadOwn = Object.prototype.hasOwnProperty.call(bus, "subscribe");
      const records = this.records;

      bus.subscribe = function (this: unknown, event, callback) {
        const sourceFile = currentModuleFile();

        if (sourceFile !== undefined && typeof event === "string") {
          records.push({ event, name: listenerName(callback), sourceFile });
        }

        return original.call(this, event, callback);
      };

      this.restores.push(() => {
        if (hadOwn) {
          bus.subscribe = original;
        } else {
          Reflect.deleteProperty(bus, "subscribe");
        }
      });
    }

    return this;
  }

  /** Stop recording and put the original `subscribe` back. */
  public stop(): this {
    for (const restore of this.restores.splice(0).reverse()) {
      restore();
    }

    return this;
  }

  /** What was recorded so far. */
  public list(): RecordedListener[] {
    return [...this.records];
  }
}

/** Group recorded listeners by event, sorted, for the report. */
export function groupListeners(records: readonly RecordedListener[]): InspectEvent[] {
  const byEvent = new Map<string, InspectEvent["listeners"]>();

  for (const record of records) {
    const listeners = byEvent.get(record.event) ?? [];

    listeners.push({ name: record.name, sourceFile: record.sourceFile });
    byEvent.set(record.event, listeners);
  }

  return [...byEvent.entries()]
    .map(([event, listeners]) => ({ event, listeners }))
    .sort((first, second) => first.event.localeCompare(second.event));
}
