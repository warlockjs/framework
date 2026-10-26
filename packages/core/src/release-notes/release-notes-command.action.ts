import { normalizeVersion } from "../upgrade/version";
import {
  installedCoreVersion,
  listReleaseVersions,
  readReleaseNote,
  readReleaseRange,
  releasesDirectory,
  releaseUrl,
  type ReleaseNote,
} from "./release-notes";

type Output = { log(message: string): void; error(message: string): void };

type Overrides = {
  /** The folder holding `<version>-summary.md` files (default: the installed core's). */
  directory?: string;
  /** The installed core version (default: read from the package). */
  installed?: string;
};

function text(value: string | boolean | number | undefined): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/** A combined breaking-changes list followed by every summary, oldest first. */
function formatRange(notes: ReleaseNote[], from: string): string {
  const breaking = notes.flatMap((note) =>
    note.breaking.map((entry) => `- ${note.version}: ${entry}`),
  );
  const head = [
    `# Breaking changes after ${from}`,
    "",
    ...(breaking.length > 0 ? breaking : ["None of these releases lists a breaking change."]),
  ];

  return [head.join("\n"), ...notes.map((note) => note.markdown.trimEnd())].join("\n\n---\n\n");
}

/**
 * The `warlock release-notes` action. Reads the summaries shipped inside the
 * installed `@warlock.js/core` package: no network and no booted app. Returns
 * the exit code it set (0, or 1 for a missing version or unusable arguments).
 */
export function runReleaseNotesCommand(
  options: Record<string, string | boolean | number>,
  overrides: Overrides = {},
  output: Output = console,
): number {
  const json = Boolean(options.json);
  const directory = overrides.directory ?? releasesDirectory();
  const fail = (message: string): number => {
    if (json) output.log(JSON.stringify({ error: message }, null, 2));
    else output.error(message);
    process.exitCode = 1;
    return 1;
  };
  const show = (notes: ReleaseNote[], markdown: string): number => {
    output.log(json ? JSON.stringify({ versions: notes }, null, 2) : markdown);
    return 0;
  };
  const missing = (version: string): number =>
    fail(
      `No release summary for ${version} ships with the installed @warlock.js/core. Read it at ${releaseUrl(version)}`,
    );

  try {
    const installed = overrides.installed ?? installedCoreVersion(directory);
    const from = text(options.from);
    const to = text(options.to);
    const version = text(options.version);

    if (options.list) {
      const notes = listReleaseVersions(directory).map((entry) =>
        readReleaseNote(entry, directory)!,
      );

      return show(
        notes,
        notes.map((note) => `${note.version}  ${note.date ?? "undated"}`).join("\n"),
      );
    }

    if (version !== undefined) {
      const note = readReleaseNote(version, directory);

      return note ? show([note], note.markdown.trimEnd()) : missing(normalizeVersion(version));
    }

    if (from !== undefined) {
      const notes = readReleaseRange(from, to ?? installed, directory);
      const lower = normalizeVersion(from);

      if (notes.length === 0) {
        return show(
          [],
          `No release summaries after ${lower}${to ? ` up to ${to}` : ""} ship with the installed @warlock.js/core.`,
        );
      }

      return show(notes, formatRange(notes, lower));
    }

    if (to !== undefined)
      return fail("--to needs --from, e.g. warlock release-notes --from 5.36 --to 5.38");

    if (!installed) {
      return fail(
        "Could not read the installed @warlock.js/core version. Pass --version <version>.",
      );
    }

    const note = readReleaseNote(installed, directory);

    return note ? show([note], note.markdown.trimEnd()) : missing(normalizeVersion(installed));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
