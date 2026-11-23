/**
 * The guard's rules: a pure function over a {@link GuardInput}. No git and
 * no file is read here, so every rule is tested with plain data.
 */
import { createFinding } from "../codes";
import type { GrimoireFinding } from "../contracts/findings";
import type { GuardInput, TaskScope } from "../contracts/guard";
import { CODE_RULES } from "../contracts/settings";
import { scanProofsInText } from "../proves";
import { findFocusedTests } from "../rules/focused";
import { runCodeRules } from "../rules";
import { countAssertions } from "./assertions";
import { describeRouteDiff, diffRoutes } from "./api";
import { matchesAny } from "./glob";
import { scopeFeatures, scopeFlows } from "./scope";

const TEST_FILE = /(?:\.(?:test|spec|e2e)\.[cm]?[jt]sx?$|(?:^|\/)(?:tests?|e2e|__tests__)\/)/;
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Whether a path is a test file by name or folder. */
export function isTestPath(file: string): boolean {
  return TEST_FILE.test(file);
}

function at(file: string, line: number | null): { file: string; line: number; column: null } {
  return { file, line: line ?? 1, column: null };
}

/** The paths of a change: each file, and the old path of a rename. */
function pathsOf(input: GuardInput): string[] {
  return input.changed.flatMap((change) => (change.from === null ? [change.file] : [change.file, change.from]));
}

/** Whether `removes` names this feature, flow, criterion or case (a wider entry covers what is inside it). */
function isRemoved(
  scope: TaskScope,
  feature: string,
  flow?: string,
  criterion?: string,
  caseQuestion?: string,
): boolean {
  return scope.removes.some((entry) => {
    if (entry.feature !== feature) return false;

    if (entry.flow === null) return true;

    if (flow === undefined || entry.flow !== flow) return false;

    if (entry.criterion === null && entry.case === null) return true;

    return (
      (criterion !== undefined && entry.criterion === criterion.toUpperCase()) ||
      (caseQuestion !== undefined && entry.case === caseQuestion.toLowerCase())
    );
  });
}

/** The files a task allows (everything else that changes is GR7006). */
function allowedFiles(input: GuardInput, scope: TaskScope): Set<string> {
  const allowed = new Set<string>([scope.file]);
  const features = scopeFeatures(scope);
  const flows = scopeFlows(scope);

  for (const feature of features) {
    for (const file of input.ownership.features[feature]?.own ?? []) allowed.add(file);
  }

  for (const [file, owner] of Object.entries(input.ownership.files)) {
    if (owner.owner !== null && features.includes(owner.owner)) allowed.add(file);
  }

  for (const ref of flows) {
    for (const file of input.flowFiles[ref] ?? []) allowed.add(file);
  }

  // Tests that prove the task's criteria: those of its flows, or of its features when it names no flow.
  for (const proof of input.proofs) {
    if (flows.length > 0 ? flows.includes(proof.ref) : features.includes(proof.feature)) {
      allowed.add(proof.at.file);
    }
  }

  // A deleted or rewritten test proved the task's criteria at the base.
  for (const [file, text] of Object.entries(input.texts)) {
    if (text.base === null || !text.base.includes("@proves")) continue;

    for (const proof of scanProofsInText(text.base, file).proofs) {
      if (flows.length > 0 ? flows.includes(proof.ref) : features.includes(proof.feature)) allowed.add(file);
    }
  }

  return allowed;
}

function inScope(file: string, scope: TaskScope, allowed: ReadonlySet<string>): boolean {
  return (
    allowed.has(file) ||
    file.startsWith("grimoire/tasks/") ||
    file.startsWith("grimoire/releases/") ||
    scopeFeatures(scope).some((feature) => file.startsWith(`grimoire/features/${feature}/`)) ||
    matchesAny(file, scope.files)
  );
}

function scopeFindings(input: GuardInput, scope: TaskScope): GrimoireFinding[] {
  const allowed = allowedFiles(input, scope);
  const findings: GrimoireFinding[] = [];

  for (const change of input.changed) {
    // A change is in scope when both sides of a rename are.
    const outside = [change.file, ...(change.from === null ? [] : [change.from])].filter(
      (file) => !inScope(file, scope, allowed),
    );

    if (outside.length === 0) continue;

    findings.push(
      createFinding({
        code: "GR7006",
        message: `${change.status} ${JSON.stringify(outside[0])} is outside ${scope.id}${scope.feature === null ? "" : ` (${scope.flow ?? scope.feature})`}`,
        at: at(change.file, null),
        task: scope.id,
      }),
    );
  }

  return findings;
}

function removalFindings(input: GuardInput, scope: TaskScope): GrimoireFinding[] {
  const base = input.baseWritten;
  const findings: GrimoireFinding[] = [];

  if (base === null) return findings;

  const report = (message: string, file: string, line: number, feature: string, flow: string | null): void => {
    findings.push(
      createFinding({ code: "GR7007", message, at: at(file, line), task: scope.id, feature, flow }),
    );
  };

  for (const feature of base.features) {
    const current = input.written.features.find((item) => item.id === feature.id);

    if (current === undefined) {
      if (!isRemoved(scope, feature.id)) {
        report(
          `the change removes the feature ${JSON.stringify(feature.id)} (${feature.flows.length} flows)`,
          feature.readme?.file ?? `grimoire/features/${feature.id}/README.md`,
          1,
          feature.id,
          null,
        );
      }

      continue;
    }

    for (const flow of feature.flows) {
      const next = current.flows.find((item) => item.id.value === flow.id.value);

      if (next === undefined) {
        if (!isRemoved(scope, feature.id, flow.id.value)) {
          report(`the change removes the flow ${JSON.stringify(flow.ref)}`, flow.file, 1, feature.id, flow.ref);
        }

        continue;
      }

      for (const criterion of flow.criteria) {
        if (next.criteria.some((item) => item.id === criterion.id)) continue;

        if (!isRemoved(scope, feature.id, flow.id.value, criterion.id)) {
          report(
            `the change removes ${criterion.id} of ${flow.ref}: ${JSON.stringify(criterion.text)}`,
            next.file,
            1,
            feature.id,
            flow.ref,
          );
        }
      }

      for (const item of flow.cases) {
        if (next.cases.some((other) => other.question === item.question)) continue;

        if (!isRemoved(scope, feature.id, flow.id.value, undefined, item.question)) {
          report(
            `the change removes the case ${JSON.stringify(item.question)} of ${flow.ref}`,
            next.file,
            1,
            feature.id,
            flow.ref,
          );
        }
      }
    }
  }

  return findings;
}

function proofFindings(input: GuardInput, scope: TaskScope): GrimoireFinding[] {
  const touched = new Set(pathsOf(input));
  const current = new Set<string>();
  const findings: GrimoireFinding[] = [];

  for (const proof of input.proofs) {
    if (!touched.has(proof.at.file)) current.add(`${proof.ref} ${proof.criterion}`);
  }

  for (const [file, text] of Object.entries(input.texts)) {
    if (text.current === null) continue;

    for (const proof of scanProofsInText(text.current, file).proofs) {
      current.add(`${proof.ref} ${proof.criterion}`);
    }
  }

  const reported = new Set<string>();

  for (const [file, text] of Object.entries(input.texts)) {
    if (text.base === null || !text.base.includes("@proves")) continue;

    for (const proof of scanProofsInText(text.base, file).proofs) {
      const key = `${proof.ref} ${proof.criterion}`;

      if (current.has(key) || reported.has(key)) continue;

      if (isRemoved(scope, proof.feature, proof.flow, proof.criterion)) continue;

      reported.add(key);
      findings.push(
        createFinding({
          code: "GR7008",
          message: `no test proves ${proof.criterion} of ${proof.ref} any more${proof.test?.name ? ` (was ${JSON.stringify(proof.test.name)})` : ""}`,
          at: at(file, proof.at.line),
          task: scope.id,
          feature: proof.feature,
          flow: proof.ref,
        }),
      );
    }
  }

  return findings;
}

function lockedFindings(input: GuardInput, scope: TaskScope): GrimoireFinding[] {
  if (scope.locked.length === 0) return [];

  return input.changed.flatMap((change) => {
    const locked = [change.file, ...(change.from === null ? [] : [change.from])].find((file) =>
      matchesAny(file, scope.locked),
    );

    return locked === undefined
      ? []
      : [
          createFinding({
            code: "GR7009",
            message: `${JSON.stringify(locked)} is a locked test of ${scope.id} and was ${change.status}`,
            at: at(change.file, null),
            task: scope.id,
          }),
        ];
  });
}

function assertionFindings(input: GuardInput, scope: TaskScope | null): GrimoireFinding[] {
  const tests = new Set(input.testFiles);
  const findings: GrimoireFinding[] = [];

  for (const [file, text] of Object.entries(input.texts)) {
    if (text.base === null || text.current === null || !(tests.has(file) || isTestPath(file))) continue;

    const before = countAssertions(text.base);
    const after = countAssertions(text.current);

    if (after < before) {
      findings.push(
        createFinding({
          code: "GR7010",
          message: `the test file has ${after} assertions, it had ${before}`,
          at: at(file, null),
          task: scope?.id ?? null,
        }),
      );
    }
  }

  return findings;
}

function dependencyChanges(before: string | null, after: string | null): string[] {
  if (after === null) return [];

  let next: Record<string, unknown>;
  let previous: Record<string, unknown> = {};

  try {
    next = JSON.parse(after) as Record<string, unknown>;

    if (before !== null) previous = JSON.parse(before) as Record<string, unknown>;
  } catch {
    return [];
  }

  const changes: string[] = [];

  for (const section of DEPENDENCY_SECTIONS) {
    const now = next[section];
    const was = previous[section];

    if (typeof now !== "object" || now === null) continue;

    for (const [name, version] of Object.entries(now as Record<string, unknown>)) {
      const old = typeof was === "object" && was !== null ? (was as Record<string, unknown>)[name] : undefined;

      if (old !== version) changes.push(`${name}@${String(version)}`);
    }
  }

  return changes;
}

function protectedFindings(input: GuardInput, scope: TaskScope): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];

  for (const area of input.settings.protected) {
    const name = area.name.toLowerCase();

    if (scope.touches.includes(name)) continue;

    if (name === "public-api") {
      const { approved, routes } = input.api;

      if (approved === null || routes === null) continue;

      const diff = diffRoutes(approved.routes, routes);

      if (diff.added.length + diff.removed.length > 0) {
        findings.push(
          createFinding({
            code: "GR7011",
            message: `the public API changed (${describeRouteDiff(diff)}) and ${scope.id} does not name public-api in Touches`,
            at: at("grimoire/approved/api.json", null),
            task: scope.id,
          }),
        );
      }

      continue;
    }

    for (const change of input.changed) {
      const file = [change.file, change.from ?? ""].find((candidate) => candidate !== "" && matchesAny(candidate, area.globs));

      if (file === undefined) continue;

      if (name === "dependencies") {
        const text = input.texts[change.file];
        const added = dependencyChanges(text?.base ?? null, text?.current ?? null);

        if (added.length === 0) continue;

        findings.push(
          createFinding({
            code: "GR7011",
            message: `${JSON.stringify(file)} adds or changes ${added.slice(0, 5).join(", ")}${added.length > 5 ? ` and ${added.length - 5} more` : ""}, and ${scope.id} does not name dependencies in Touches`,
            at: at(change.file, null),
            task: scope.id,
          }),
        );
        continue;
      }

      findings.push(
        createFinding({
          code: "GR7011",
          message: `${JSON.stringify(file)} is in the protected area ${JSON.stringify(area.name)} and ${scope.id} does not name it in Touches`,
          at: at(change.file, null),
          task: scope.id,
        }),
      );
    }
  }

  return findings;
}

function addedLineFindings(input: GuardInput, scope: TaskScope | null): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];
  const rules = input.settings.rules ?? CODE_RULES;
  const tests = new Set(input.testFiles);

  for (const change of input.changed) {
    const text = input.texts[change.file]?.current;

    if (change.status === "deleted" || text === undefined || text === null) continue;

    const added = new Set(change.addedLines);

    if (rules.length > 0) {
      for (const hit of runCodeRules(change.file, text, rules)) {
        if (!added.has(hit.line)) continue;

        findings.push(
          createFinding({
            code: hit.code,
            message: hit.message,
            at: { file: change.file, line: hit.line, column: hit.column },
            task: scope?.id ?? null,
          }),
        );
      }
    }

    if (tests.has(change.file) || isTestPath(change.file)) {
      for (const hit of findFocusedTests(text)) {
        if (!added.has(hit.line)) continue;

        findings.push(
          createFinding({
            code: hit.type === "only" ? "GR4011" : "GR4012",
            // `.skip` is a warning in a check; a change that adds one is an error.
            severity: "error",
            message: `${hit.call} was added`,
            at: { file: change.file, line: hit.line, column: null },
            task: scope?.id ?? null,
          }),
        );
      }
    }
  }

  return findings;
}

function commitFindings(input: GuardInput): GrimoireFinding[] {
  if (input.commits === null) return [];

  const known = new Set(input.taskIds.map((id) => Number(id.replace(/\D/g, ""))));
  const findings: GrimoireFinding[] = [];

  for (const commit of input.commits) {
    if (/^Merge (?:pull request|branch|remote-tracking branch)\b/.test(commit.subject)) continue;

    const ids = [...new Set([...`${commit.subject}\n${commit.body}`.matchAll(/\bT-(\d+)\b/g)].map((match) => Number(match[1])))];
    const label = `commit ${commit.sha.slice(0, 7)} ${JSON.stringify(commit.subject)}`;

    if (ids.length === 0) {
      findings.push(createFinding({ code: "GR7012", message: `${label} names no task` }));
    } else if (!ids.some((id) => known.has(id))) {
      findings.push(
        createFinding({
          code: "GR7012",
          message: `${label} names ${ids.map((id) => `T-${id}`).join(", ")}, which has no task file`,
        }),
      );
    }
  }

  return findings;
}

/** Every finding of the guard for a change. Pure. */
export function runGuardChecks(input: GuardInput): GrimoireFinding[] {
  const { scope } = input;
  const findings: GrimoireFinding[] = [];

  if (scope === null) {
    findings.push(
      createFinding({
        code: "GR9008",
        message:
          "no task was found: none was passed, the commits name none, and not exactly one task is in progress",
      }),
    );
  } else {
    findings.push(
      ...scopeFindings(input, scope),
      ...removalFindings(input, scope),
      ...proofFindings(input, scope),
      ...lockedFindings(input, scope),
      ...protectedFindings(input, scope),
    );
  }

  findings.push(...assertionFindings(input, scope), ...addedLineFindings(input, scope), ...commitFindings(input));

  return findings;
}
