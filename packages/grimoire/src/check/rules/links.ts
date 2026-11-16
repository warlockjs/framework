/**
 * GR2001–GR2012: a name in a written file that points at nothing.
 */
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import type { StepType, WrittenStep } from "../../contracts/written";
import { isRetired, writtenLookup } from "./lookup";

/** Code and wording of a step that matched nothing, by step kind. */
const STEP_CODES: Partial<Record<StepType, { code: string; missing: string }>> = {
  route: { code: "GR2001", missing: "matches no route" },
  page: { code: "GR2002", missing: "matches no page or screen of the feature's apps" },
  mail: { code: "GR2003", missing: "matches no mail" },
  notification: { code: "GR2004", missing: "matches no notification" },
  job: { code: "GR2005", missing: "matches no job" },
  event: { code: "GR2006", missing: "matches no event" },
  affects: { code: "GR2007", missing: "names no feature or flow" },
};

/** Step kinds whose names come from the facts read with the routes (a booted app). */
const BOOT_TYPES: ReadonlySet<StepType> = new Set([
  "route",
  "mail",
  "notification",
  "job",
  "event",
]);

/**
 * GR2001–GR2007: steps whose name matched nothing in the book. The matching
 * is the flow book map's (`FlowBookmapStep.found`), so `scry` and the check
 * agree. Retired flows are skipped. Without route facts (`routes: missing`)
 * the route and named-thing steps are not checked.
 */
export function checkSteps(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];
  const skipBootTypes = snapshot.routes === "missing";

  for (const feature of snapshot.written.features) {
    for (const flow of feature.flows) {
      if (isRetired(feature, flow)) continue;

      const bookmap = snapshot.collected.flows[flow.ref];

      if (!bookmap) continue;

      flow.steps.forEach((step: WrittenStep, position) => {
        const rule = STEP_CODES[step.type];

        if (!rule || (skipBootTypes && BOOT_TYPES.has(step.type))) return;

        const mapped =
          bookmap.steps.find((item) => item.index === step.index && item.type === step.type) ??
          bookmap.steps[position];

        if (mapped?.found !== false) return;

        findings.push(
          createFinding({
            code: rule.code,
            message: `${step.type} step "${step.target}" ${rule.missing}`,
            at: step.at,
            feature: feature.id,
            flow: flow.ref,
          }),
        );
      });
    }
  }

  return findings;
}

/**
 * GR2008: a feature, flow, criterion or task names an app with no folder.
 * GR2009: a flow (Differs by app, a criterion's `[app]`) names an app that
 * has a folder but is not in its feature's `apps`.
 */
export function checkAppNames(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const { apps } = writtenLookup(snapshot);
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    const readme = feature.readme;

    for (const app of readme?.apps ?? []) {
      if (apps.has(app.value)) continue;

      findings.push(
        createFinding({
          code: "GR2008",
          message: `feature ${feature.id} lists app "${app.value}", which has no folder in grimoire/apps`,
          at: app.at,
          feature: feature.id,
          app: app.value,
        }),
      );
    }

    const listed = new Set((readme?.apps ?? []).map((app) => app.value));

    for (const flow of feature.flows) {
      const named = [
        ...flow.differs.map((line) => ({ app: line.name, at: line.at, where: "Differs by app" })),
        ...flow.criteria
          .filter((criterion) => criterion.app !== null)
          .map((criterion) => ({
            app: criterion.app ?? "",
            at: criterion.at,
            where: criterion.id,
          })),
      ];

      for (const { app, at, where } of named) {
        if (!apps.has(app)) {
          findings.push(
            createFinding({
              code: "GR2008",
              message: `${flow.ref} ${where} names app "${app}", which has no folder in grimoire/apps`,
              at,
              feature: feature.id,
              flow: flow.ref,
              app,
            }),
          );
        } else if (readme && !listed.has(app)) {
          findings.push(
            createFinding({
              code: "GR2009",
              message: `${flow.ref} ${where} names app "${app}", which feature ${feature.id} does not list in apps`,
              at,
              feature: feature.id,
              flow: flow.ref,
              app,
            }),
          );
        }
      }
    }
  }

  for (const task of snapshot.written.tasks) {
    for (const app of task.apps) {
      if (apps.has(app.value)) continue;

      findings.push(
        createFinding({
          code: "GR2008",
          message: `task ${task.id.value} names app "${app.value}", which has no folder in grimoire/apps`,
          at: app.at,
          app: app.value,
          task: task.id.value,
        }),
      );
    }
  }

  return findings;
}

/**
 * GR2010: a changelog entry names a flow its feature does not have.
 * GR2011: it names a criterion that flow does not have.
 */
export function checkChangelogLinks(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const { flows } = writtenLookup(snapshot);
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    for (const entry of feature.changelog?.entries ?? []) {
      if (entry.flow === null) continue;

      const ref = `${feature.id}/${entry.flow}`;
      const flow = flows.get(ref);

      if (!flow) {
        findings.push(
          createFinding({
            code: "GR2010",
            message: `changelog entry ${entry.version.value} ${entry.word} names flow "${entry.flow}", which ${feature.id} does not have`,
            at: entry.at,
            feature: feature.id,
          }),
        );
        continue;
      }

      const criteria = new Set(flow.criteria.map((criterion) => criterion.id));

      for (const criterion of entry.criteria) {
        if (criteria.has(criterion)) continue;

        findings.push(
          createFinding({
            code: "GR2011",
            message: `changelog entry ${entry.version.value} ${entry.word} names ${criterion}, which ${ref} does not have`,
            at: entry.at,
            feature: feature.id,
            flow: ref,
          }),
        );
      }
    }
  }

  return findings;
}

/** GR2012: a README "Affects and affected by" line names a feature or flow that does not exist. */
export function checkRelations(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const { features, flows } = writtenLookup(snapshot);
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    for (const relation of feature.readme?.relations ?? []) {
      for (const ref of relation.refs) {
        const exists = ref.includes("/") ? flows.has(ref) : features.has(ref);

        if (exists) continue;

        findings.push(
          createFinding({
            code: "GR2012",
            message: `README of ${feature.id} names "${ref}", which is no ${ref.includes("/") ? "flow" : "feature"}`,
            at: relation.at,
            feature: feature.id,
          }),
        );
      }
    }
  }

  return findings;
}
