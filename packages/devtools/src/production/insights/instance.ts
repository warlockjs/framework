import cluster from "node:cluster";
import os from "node:os";
import type { DevtoolsInstanceInfo } from "../contracts";

/** This process's identity (host, pid, pm2/cluster worker, start time). */
export function createInstanceInfo(now: number = Date.now()): DevtoolsInstanceInfo {
  const host = os.hostname();
  const pid = process.pid;
  const worker =
    process.env.NODE_APP_INSTANCE ||
    process.env.pm_id ||
    (cluster.worker ? String(cluster.worker.id) : null);

  return {
    id: `${host}:${pid}:${now.toString(36)}`,
    label: worker === null ? `${host} pid ${pid}` : `${host} #${worker}`,
    host,
    pid,
    worker,
    startedAt: now,
    seenAt: now,
    nodeVersion: process.version,
  };
}
