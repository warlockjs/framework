import type { DispatchOptions, DispatchedJob, JobSnapshot } from "./types";

/**
 * A stand-in for the broker, used by test fakes.
 *
 * When one is installed, `job.dispatch()` hands the job to it instead of
 * adding it to BullMQ, and `job.find()` asks it instead of Redis. Nothing
 * connects to Redis while it is installed.
 *
 * `@warlock.js/core/tests` installs one as `queueFake` in the test
 * environment; this package exposes the seam so core needs no dependency on
 * it. The slot lives on `globalThis` so every copy of this package in a
 * process (a Vitest worker can load two) sees the same one.
 */
export type DispatchInterceptor = {
  dispatch(job: {
    name: string;
    queue: string;
    payload: unknown;
    options: DispatchOptions;
  }): DispatchedJob | Promise<DispatchedJob>;
  find?(job: {
    name: string;
    queue: string;
    id: string;
  }): JobSnapshot | undefined | Promise<JobSnapshot | undefined>;
};

const INTERCEPTOR_KEY = Symbol.for("warlock.queue.dispatchInterceptor");

type InterceptorHolder = { [INTERCEPTOR_KEY]?: DispatchInterceptor };

/** Install an interceptor, or remove it with `undefined`. */
export function setDispatchInterceptor(interceptor: DispatchInterceptor | undefined): void {
  (globalThis as InterceptorHolder)[INTERCEPTOR_KEY] = interceptor;
}

/** The installed interceptor, if any. */
export function getDispatchInterceptor(): DispatchInterceptor | undefined {
  return (globalThis as InterceptorHolder)[INTERCEPTOR_KEY];
}
