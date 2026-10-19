import type { ResolvedJobOptions } from "./job-options";
import type { DispatchedJob, FailedJob, JobSnapshot } from "./types";

/** Driver-neutral request: data includes any captured queue context. */
export type DriverDispatch = {
  name: string;
  queue: string;
  data: unknown;
  options: ResolvedJobOptions;
};

/** All built-in backends implement this lifecycle and storage contract. */
export interface QueueDriver {
  dispatch(request: DriverDispatch): Promise<DispatchedJob>;
  find(queue: string, id: string): Promise<JobSnapshot | undefined>;
  failed(queue: string, start: number, end: number): Promise<FailedJob[]>;
  retry(queue: string, id: string): Promise<void>;
  start(queue: string): Promise<void>;
  running(): string[];
  /** Stop taking jobs immediately, then drain or release within timeout. */
  close(timeout: number): Promise<void>;
}
