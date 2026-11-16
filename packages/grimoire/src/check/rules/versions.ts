/**
 * GR6004–GR6008: the feature version, the README date and the changelog
 * agree, and a new whole-number version has its brief.
 */
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import { compareVersions, parseVersion } from "./lookup";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GR6004: README `updated` older than the newest dated changelog section that
 * holds entries. GR6005: README `version` differs from the newest entry's
 * version.
 */
export function checkReadmeDates(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    const readme = feature.readme;
    const entries = feature.changelog?.entries ?? [];

    if (!readme || entries.length === 0) continue;

    const newestDate = entries
      .map((entry) => entry.date)
      .filter((date): date is string => date !== null && DATE.test(date))
      .sort()
      .at(-1);

    if (
      newestDate !== undefined &&
      DATE.test(readme.updated.value) &&
      readme.updated.value < newestDate
    ) {
      findings.push(
        createFinding({
          code: "GR6004",
          message: `README of ${feature.id} was updated ${readme.updated.value}, before its changelog entries of ${newestDate}`,
          at: readme.updated.at,
          feature: feature.id,
        }),
      );
    }

    const newest = entries
      .map((entry) => entry.version.value)
      .filter((version) => parseVersion(version) !== null)
      .sort(compareVersions)
      .at(-1);

    if (
      newest !== undefined &&
      parseVersion(readme.version.value) &&
      compareVersions(readme.version.value, newest) !== 0
    ) {
      findings.push(
        createFinding({
          code: "GR6005",
          message: `README of ${feature.id} says version ${readme.version.value}, the newest changelog entry is ${newest}`,
          at: readme.version.at,
          feature: feature.id,
        }),
      );
    }
  }

  return findings;
}

/** GR6006: `added`/`removed` on a decimal version, or `changed`/`fixed` on a whole-number one. */
export function checkChangeWords(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    for (const entry of feature.changelog?.entries ?? []) {
      const version = parseVersion(entry.version.value);

      if (!version) continue;

      const whole = version[1] === 0;
      const wantsWhole = entry.word === "added" || entry.word === "removed";

      if (whole === wantsWhole) continue;

      findings.push(
        createFinding({
          code: "GR6006",
          message: `changelog entry ${entry.version.value} ${entry.word} uses a ${whole ? "whole-number" : "decimal"} version; ${entry.word} takes a ${wantsWhole ? "whole-number" : "decimal"} one`,
          at: entry.at,
          feature: feature.id,
          flow: entry.flow === null ? null : `${feature.id}/${entry.flow}`,
        }),
      );
    }
  }

  return findings;
}

/**
 * GR6007: a flow's `since` is newer than its feature's `version`.
 * GR6008: a proposed flow starts a new whole-number version that has no
 * `versions/v<n>.md` brief.
 */
export function checkFlowVersions(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    const current = feature.readme ? parseVersion(feature.readme.version.value) : null;

    if (!feature.readme || !current) continue;

    const briefs = new Set(feature.versions.map((brief) => brief.major));

    for (const flow of feature.flows) {
      const since = parseVersion(flow.since.value);

      if (!since) continue;

      if (compareVersions(flow.since.value, feature.readme.version.value) > 0) {
        findings.push(
          createFinding({
            code: "GR6007",
            message: `${flow.ref} is since ${flow.since.value}, newer than ${feature.id} ${feature.readme.version.value}`,
            at: flow.since.at,
            feature: feature.id,
            flow: flow.ref,
          }),
        );
      }

      if (
        flow.status.value === "proposed" &&
        since[1] === 0 &&
        since[0] > current[0] &&
        !briefs.has(since[0])
      ) {
        findings.push(
          createFinding({
            code: "GR6008",
            message: `${flow.ref} starts ${feature.id} ${flow.since.value}, which has no brief versions/v${since[0]}.md`,
            at: flow.since.at,
            feature: feature.id,
            flow: flow.ref,
          }),
        );
      }
    }
  }

  return findings;
}
