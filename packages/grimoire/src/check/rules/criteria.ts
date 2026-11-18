/**
 * GR2013 and GR4001–GR4002: criteria, the cases that name them and the
 * `@proves` lines that name them.
 */
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import { isRetired, writtenLookup } from "./lookup";

/** GR4001: a criterion of a flow (not retired) that no `@proves` line names. */
export function checkCriteriaTests(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const proven = new Set(snapshot.proofs.map((proof) => `${proof.ref} ${proof.criterion}`));
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    for (const flow of feature.flows) {
      if (isRetired(feature, flow)) continue;

      for (const criterion of flow.criteria) {
        if (proven.has(`${flow.ref} ${criterion.id}`)) continue;

        findings.push(
          createFinding({
            code: "GR4001",
            message: `${flow.ref} ${criterion.id} has no test`,
            at: criterion.at,
            feature: feature.id,
            flow: flow.ref,
          }),
        );
      }
    }
  }

  return findings;
}

/** GR4002: a `@proves` line naming a flow or criterion that does not exist. */
export function checkProofTargets(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const { flows } = writtenLookup(snapshot);
  const findings: GrimoireFinding[] = [];

  for (const proof of snapshot.proofs) {
    const flow = flows.get(proof.ref);
    const missing = !flow
      ? `no flow ${proof.ref}`
      : flow.criteria.some((criterion) => criterion.id === proof.criterion)
        ? null
        : `no ${proof.criterion} in ${proof.ref}`;

    if (missing === null) continue;

    findings.push(
      createFinding({
        code: "GR4002",
        message: `"@proves ${proof.ref} ${proof.criterion}" names ${missing}`,
        at: proof.at,
        feature: proof.feature,
        flow: proof.ref,
      }),
    );
  }

  return findings;
}

/** GR2013: a case that ends in `(AC-n)` naming a criterion its flow does not have. */
export function checkCaseCriteria(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    for (const flow of feature.flows) {
      const known = new Set(flow.criteria.map((criterion) => criterion.id));

      for (const entry of flow.cases) {
        for (const id of entry.criteria) {
          if (known.has(id)) continue;

          findings.push(
            createFinding({
              code: "GR2013",
              message: `the case "${entry.question}" in ${flow.ref} names ${id}, which the flow does not have`,
              at: entry.at,
              feature: feature.id,
              flow: flow.ref,
            }),
          );
        }
      }
    }
  }

  return findings;
}
