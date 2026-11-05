import path from "node:path";
import type { WorkspacePolicy } from "../contracts";

/**
 * The absolute directory spill files go to, or `undefined` when the policy
 * has no `output.spillDir` (spilling is off).
 */
export function resolveSpillDir(policy: WorkspacePolicy): string | undefined {
  const dir = policy.output?.spillDir;

  return dir === undefined ? undefined : path.resolve(policy.cwd, dir);
}
