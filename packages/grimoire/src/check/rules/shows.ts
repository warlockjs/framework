/**
 * GR4013-GR4016: `@shows` lines that are malformed or name nothing, criteria
 * with no capture in a language, scenes that failed.
 */
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import { DEFAULT_GRIMOIRE_SETTINGS } from "../../contracts/settings";

export function checkShows(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const shots = snapshot.shots;

  if (shots === undefined) return [];

  const findings: GrimoireFinding[] = [...shots.showsFindings];
  const settings = snapshot.settings ?? DEFAULT_GRIMOIRE_SETTINGS;
  const languages = settings.languages.length > 0 ? settings.languages : [""];
  const optedOut = new Set(shots.optedOut);
  const captures = new Map(
    (shots.captures?.captures ?? []).map((capture) => [
      `${capture.ref} ${capture.criterion} ${capture.language}`,
      capture,
    ]),
  );
  const approved = new Set(
    (shots.baseline?.shots ?? []).map((shot) => `${shot.ref} ${shot.criterion} ${shot.language}`),
  );
  const seen = new Set<string>();

  for (const line of shots.shows) {
    // A line with no matching call is GR4013 already.
    if (line.call === null) continue;

    const key = `${line.ref} ${line.criterion}`;

    if (seen.has(key)) continue;

    seen.add(key);

    for (const language of languages) {
      const capture = captures.get(`${key} ${language}`);
      const label = language === "" ? "" : ` in ${language}`;
      const subject = { feature: line.feature, flow: line.ref, at: line.at };

      if (capture === undefined) {
        if (shots.mode === "off" || optedOut.has(line.ref)) continue;

        // In `changed` mode only touched flows are captured: an approved image still stands for the others.
        if (shots.mode !== "all" && approved.has(`${key} ${language}`)) continue;

        findings.push(
          createFinding({
            code: "GR4015",
            message: `${line.ref} ${line.criterion} is shown by a scene but has no capture${label}`,
            ...subject,
          }),
        );
      } else if (capture.outcome === "fail") {
        findings.push(
          createFinding({
            code: "GR4016",
            message: `${line.ref} ${line.criterion} failed${label}: ${capture.error ?? "the scene threw"}`,
            ...subject,
          }),
        );
      }
    }
  }

  return findings;
}
