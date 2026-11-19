import events from "@mongez/events";
import { EventRecorder, type RecordedListener } from "./event-recorder";
import type { InspectOptions } from "./inspect-app";

/**
 * The recorder lives on `globalThis`, so the dev server and a tool that reads it agree on one recorder even
 * when they load two copies of this module (a bundle entry each).
 */
const RECORDER_KEY = Symbol.for("warlock.liveEventRecorder");

/** What a reader needs of the recorder; checked by shape, since another module copy's class is a different one. */
type LiveRecorder = Pick<EventRecorder, "list">;

function currentRecorder(): LiveRecorder | undefined {
  const value: unknown = Reflect.get(globalThis, RECORDER_KEY);

  return typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "list") === "function"
    ? (value as LiveRecorder)
    : undefined;
}

/**
 * Start noting which app module registers each event listener, for the life of the
 * process. `warlock dev` calls it before the app modules load, so a panel running in
 * the same process can read the event facts without booting the app again. Safe to
 * call more than once.
 */
export function startLiveEventRecording(): void {
  if (currentRecorder() !== undefined) return;

  Reflect.set(globalThis, RECORDER_KEY, new EventRecorder().start([events]));
}

/**
 * The `inspectApp` inputs a running app already holds: the listeners noted since
 * `startLiveEventRecording()` (without repeats from reloaded modules). Nothing is
 * booted or imported; the routes come from the live router, which `inspectApp` reads
 * by itself.
 */
export function liveInspectOptions(): InspectOptions {
  const seen = new Set<string>();
  const listeners: RecordedListener[] = [];

  for (const record of currentRecorder()?.list() ?? []) {
    const key = `${record.event}\0${record.name}\0${record.sourceFile}`;

    if (seen.has(key)) continue;

    seen.add(key);
    listeners.push(record);
  }

  return { events: listeners };
}
