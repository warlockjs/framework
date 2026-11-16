/**
 * Task files: the GR7xxx rules. Parsing is `parseGrimoire`'s; the index is the
 * workspace's. Read-only.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createFinding } from "../codes";
import type { GrimoireFinding } from "../contracts/findings";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { WrittenGrimoire, WrittenTask } from "../contracts/written";
import { toPosixPath } from "../paths";

type Subject = { feature: string | null; task: string; file: string };

function subjectOf(task: WrittenTask, feature: string | null): Subject {
  return { feature, task: task.id.value, file: task.file };
}

/** The feature and flow id a task's `flow` value names, or `null` when it cannot be read. */
function resolveFlow(task: WrittenTask): { feature: string; flow: string } | null {
  const value = task.flow?.value;

  if (value === undefined) return null;

  if (value.includes("/")) {
    const [feature = "", flow = ""] = value.split("/");

    return { feature, flow };
  }

  return task.feature ? { feature: task.feature.value, flow: value } : null;
}

function hasVersion(written: WrittenGrimoire, feature: string, version: string): boolean {
  const changelog = written.features.find((item) => item.id === feature)?.changelog;

  return (changelog?.entries ?? []).some((entry) => entry.version.value === version);
}

function briefPath(task: WrittenTask): string | null {
  const field = task.fields.find((item) => item.key.toLowerCase() === "brief");
  const value = field?.value.trim().replace(/^`|`$/g, "");

  if (!value || /^[a-z]+:\/\//i.test(value)) return null;

  return value;
}

/** The GR7xxx rules. Read-only. */
export function checkTasks(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const { written, root } = snapshot;
  const findings: GrimoireFinding[] = [];
  const featureIds = new Set(written.features.map((feature) => feature.id));

  for (const task of written.tasks) {
    const id = task.id.value;

    // GR7001
    if (task.feature && !featureIds.has(task.feature.value)) {
      findings.push(
        createFinding({
          code: "GR7001",
          message: `task ${id} names feature "${task.feature.value}", which has no folder in grimoire/features`,
          at: task.feature.at,
          ...subjectOf(task, task.feature.value),
        }),
      );
    }

    // GR7002
    const flow = resolveFlow(task);

    if (task.flow && flow === null) {
      findings.push(
        createFinding({
          code: "GR7002",
          message: `task ${id} names flow "${task.flow.value}" without a feature; write \`<feature>/<flow>\` or set \`feature\``,
          at: task.flow.at,
          ...subjectOf(task, null),
        }),
      );
    } else if (task.flow && flow !== null) {
      const feature = written.features.find((item) => item.id === flow.feature);
      const featureReported = task.feature?.value === flow.feature && !featureIds.has(flow.feature);

      if (!featureReported && !feature?.flows.some((item) => item.id.value === flow.flow)) {
        findings.push(
          createFinding({
            code: "GR7002",
            message: `task ${id} names flow "${flow.feature}/${flow.flow}", which has no file`,
            at: task.flow.at,
            ...subjectOf(task, flow.feature),
            flow: `${flow.feature}/${flow.flow}`,
          }),
        );
      }
    }

    // GR7003
    const status = task.status.value;

    if (task.folder === "done" && (status !== "done" || task.shipped === null)) {
      findings.push(
        createFinding({
          code: "GR7003",
          message: `task ${id} is in tasks/done but ${status !== "done" ? `has status "${status}"` : "has no `shipped`"}`,
          at: status !== "done" ? task.status.at : task.id.at,
          ...subjectOf(task, task.feature?.value ?? null),
        }),
      );
    } else if (task.folder === "open" && status === "done") {
      findings.push(
        createFinding({
          code: "GR7003",
          message: `task ${id} has status "done" but is in tasks/open; move it to tasks/done/<yyyy-mm>/`,
          at: task.status.at,
          ...subjectOf(task, task.feature?.value ?? null),
        }),
      );
    }

    // GR7004
    if (task.shipped) {
      const { feature, version } = task.shipped.value;

      if (!hasVersion(written, feature, version)) {
        findings.push(
          createFinding({
            code: "GR7004",
            message: `task ${id} shipped "${feature} ${version}", but the ${feature} changelog has no entry for version ${version}`,
            at: task.shipped.at,
            ...subjectOf(task, feature),
          }),
        );
      }
    }

    // GR7005
    const brief = briefPath(task);

    if (brief !== null) {
      const folder = path.resolve(root, "grimoire");
      const target = path.resolve(folder, ...toPosixPath(brief).split("/"));
      const relative = path.relative(folder, target);
      // A brief outside `grimoire/` (`../x`, an absolute path) is never looked up.
      const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);

      if (!inside || !existsSync(target)) {
        const line = task.fields.find((item) => item.key.toLowerCase() === "brief");

        findings.push(
          createFinding({
            code: "GR7005",
            message: inside
              ? `task ${id} points at brief "${brief}", which does not exist under grimoire/`
              : `task ${id} points at brief "${brief}", which is not a path inside grimoire/`,
            at: line?.at ?? null,
            ...subjectOf(task, task.feature?.value ?? null),
          }),
        );
      }
    }
  }

  return findings;
}
