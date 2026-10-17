import { clock } from "../../utils/clock";
import { FakeAssertionError, describeRecorded } from "./fake-assertion-error";

/**
 * One job `dispatch()`ed while the fake was installed.
 *
 * Structural on purpose: core has no dependency on `@warlock.js/queue`. The
 * fake talks to it through the global dispatch-interceptor slot that package
 * reads (`setDispatchInterceptor`).
 */
export type PushedJob = {
  id: string;
  name: string;
  queue: string;
  payload: unknown;
  /** The dispatch options (`delay`, `priority`, `jobId`, ...). */
  options: Record<string, unknown>;
  pushedAt: Date;
};

/** A job name, or anything with a `name` — the object `defineJob()` returns. */
export type JobReference = string | { readonly name: string };

/** Which pushed jobs an assertion is about: a predicate, or a payload subset. */
export type PushedJobMatcher = ((job: PushedJob) => boolean) | Record<string, unknown>;

const INTERCEPTOR_KEY = Symbol.for("warlock.queue.dispatchInterceptor");

type Interceptor = {
  dispatch(job: {
    name: string;
    queue: string;
    payload: unknown;
    options: Record<string, unknown>;
  }): { id: string; name: string; queue: string };
  find(job: { name: string; id: string }): unknown;
};

type InterceptorHolder = { [INTERCEPTOR_KEY]?: Interceptor };

const pushed: PushedJob[] = [];
let sequence = 0;
let previous: Interceptor | undefined;
let installed = false;

function nameOf(job: JobReference): string {
  return typeof job === "string" ? job : job.name;
}

function isSubset(expected: unknown, actual: unknown): boolean {
  if (expected === actual) return true;
  if (typeof expected !== "object" || expected === null) return false;
  if (typeof actual !== "object" || actual === null) return false;

  return Object.entries(expected).every(([key, value]) =>
    isSubset(value, (actual as Record<string, unknown>)[key]),
  );
}

function matches(job: PushedJob, matcher: PushedJobMatcher | undefined): boolean {
  if (matcher === undefined) return true;
  if (typeof matcher === "function") return matcher(job);

  return isSubset(matcher, job.payload);
}

function describeJob(job: PushedJob): string {
  return `${job.name} on "${job.queue}" with ${JSON.stringify(job.payload)}`;
}

const interceptor: Interceptor = {
  dispatch({ name, queue, payload, options }) {
    // An explicit jobId makes a real dispatch idempotent; keep that contract.
    const explicitId = typeof options.jobId === "string" ? options.jobId : undefined;
    const existing = explicitId ? pushed.find((job) => job.id === explicitId) : undefined;

    if (existing) return { id: existing.id, name: existing.name, queue: existing.queue };

    sequence += 1;

    const job: PushedJob = {
      id: explicitId ?? `fake-${sequence}`,
      name,
      queue,
      payload,
      options: { ...options },
      pushedAt: clock.now(),
    };

    pushed.push(job);

    return { id: job.id, name, queue };
  },

  find({ name, id }) {
    const job = pushed.find((entry) => entry.id === id && entry.name === name);

    if (!job) return undefined;

    return {
      id: job.id,
      name: job.name,
      queue: job.queue,
      state: "waiting",
      payload: job.payload,
      progress: 0,
      attemptsMade: 0,
      createdAt: job.pushedAt,
    };
  },
};

/**
 * Records every `@warlock.js/queue` dispatch instead of pushing it to Redis.
 *
 * Installed by default in the test environment. Jobs are recorded, not run:
 * call the job's handler directly to test what it does.
 *
 * @example
 * await placeOrder(order);
 *
 * queueFake.assertPushed(sendInvoice, { orderId: order.id });
 * queueFake.assertPushedCount(1);
 */
export const queueFake = {
  /** Start recording (idempotent). Clears anything recorded before. */
  install(): void {
    const holder = globalThis as InterceptorHolder;

    if (!installed) {
      previous = holder[INTERCEPTOR_KEY];
      installed = true;
    }

    holder[INTERCEPTOR_KEY] = interceptor;
    queueFake.clear();
  },

  /** Stop recording; dispatches reach the broker again. */
  restore(): void {
    if (!installed) return;

    (globalThis as InterceptorHolder)[INTERCEPTOR_KEY] = previous;
    previous = undefined;
    installed = false;
    queueFake.clear();
  },

  isInstalled(): boolean {
    return installed;
  },

  /** Forget recorded jobs. */
  clear(): void {
    pushed.length = 0;
    sequence = 0;
  },

  /** Recorded jobs, oldest first; optionally only one job type. */
  pushed(job?: JobReference, matcher?: PushedJobMatcher): PushedJob[] {
    return pushed.filter(
      (entry) => (job === undefined || entry.name === nameOf(job)) && matches(entry, matcher),
    );
  },

  /** Assert `job` was pushed (with a payload matching `matcher`); returns the first match. */
  assertPushed(job: JobReference, matcher?: PushedJobMatcher): PushedJob {
    const found = queueFake.pushed(job, matcher)[0];

    if (!found) {
      throw new FakeAssertionError(
        `Expected ${nameOf(job)} to be pushed${matcher === undefined ? "" : " with a matching payload"}. ${describeRecorded(pushed, describeJob, "pushed")}`,
      );
    }

    return found;
  },

  /** Assert `job` was not pushed (with a matching payload). */
  assertNotPushed(job: JobReference, matcher?: PushedJobMatcher): void {
    const found = queueFake.pushed(job, matcher);

    if (found.length > 0) {
      throw new FakeAssertionError(
        `Expected ${nameOf(job)} not to be pushed. ${describeRecorded(found, describeJob, "pushed")}`,
      );
    }
  },

  /** Assert exactly `count` jobs were pushed — of type `job` when given. */
  assertPushedCount(count: number, job?: JobReference): void {
    const found = queueFake.pushed(job);

    if (found.length !== count) {
      throw new FakeAssertionError(
        `Expected ${count} ${job === undefined ? "job(s)" : nameOf(job)} pushed, found ${found.length}. ${describeRecorded(pushed, describeJob, "pushed")}`,
      );
    }
  },

  /** Assert nothing was pushed. */
  assertNothingPushed(): void {
    queueFake.assertPushedCount(0);
  },
};
