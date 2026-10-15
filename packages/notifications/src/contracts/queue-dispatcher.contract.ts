import type { SendOptions } from "../types";

/**
 * Async dispatcher contract — what `.queue(...)` hands rendered jobs to.
 * The shipped implementation backs onto `@warlock.js/herald` (Phase 2). Apps
 * may register their own dispatcher (e.g. SQS, in-memory test double).
 *
 * The job carries an ALREADY-RENDERED payload + the resolved route — the
 * worker only needs to look up the channel by name and call `channel.send`.
 * No model re-hydration, no closure serialization.
 */
export interface QueueDispatcher {
  dispatch(job: {
    channel: string;
    route: unknown;
    payload: unknown;
    options: SendOptions;
  }): Promise<void>;
}
