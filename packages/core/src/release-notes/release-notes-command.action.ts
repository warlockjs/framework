import { compareVersions, normalizeVersion } from "../upgrade/version";
import {
  installedCoreVersion,
  listReleaseVersions,
  readReleaseNote,
  releasesDirectory,
  releaseUrl,
  type ReleaseNote,
} from "./release-notes";
import {
  fetchRemoteReleaseNotes,
  type FetchRemoteReleaseNotesOptions,
} from "./release-notes-remote";

type Output = { log(message: string): void; error(message: string): void };

type Overrides = {
  /** The folder holding `<version>-summary.md` files (default: the installed core's). */
  directory?: string;
  /** The installed core version (default: read from the package). */
  installed?: string;
  /** How the online check is made (default: the documentation site, 5 second timeout). */
  remote?: FetchRemoteReleaseNotesOptions;
};

/** A release as the command reports it. */
type Entry = ReleaseNote & {
  /** Whether the installed `@warlock.js/core` includes this release. */
  installed: boolean;
  /** `bundled` comes from the installed package, `remote` from the documentation site. */
  source: "bundled" | "remote";
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

/** The closing lines for releases the project has not installed yet. */
function newerFooter(newer: Entry[]): string {
  return `Newer releases (not installed): ${newer.map((note) => note.version).join(", ")}\nUpgrade with: npx warlock update`;
}

/**
 * The `warlock release-notes` action. Reads the summaries shipped inside the
 * installed `@warlock.js/core` package and, unless `--offline` is passed,
 * checks the documentation site for releases newer than the installed one. The
 * online check fails soft: when it cannot complete, the bundled result is
 * printed with one line saying why. Returns the exit code it set (0, or 1 for a
 * missing version or unusable arguments).
 */
export async function runReleaseNotesCommand(
  options: Record<string, string | boolean | number>,
  overrides: Overrides = {},
  output: Output = console,
): Promise<number> {
  const json = Boolean(options.json);
  const offline = Boolean(options.offline);
  const directory = overrides.directory ?? releasesDirectory();
  const fail = (message: string): number => {
    if (json) output.log(JSON.stringify({ error: message }, null, 2));
    else output.error(message);
    process.exitCode = 1;
    return 1;
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

    if (to !== undefined && from === undefined && !options.list && version === undefined) {
      return fail("--to needs --from, e.g. warlock release-notes --from 5.36 --to 5.38");
    }

    let latest: string | undefined;
    let onlineError: string | undefined;
    const remoteNotes: ReleaseNote[] = [];

    if (!offline) {
      const result = await fetchRemoteReleaseNotes(overrides.remote);

      if (result.ok) {
        latest = result.data.latest;
        remoteNotes.push(...result.data.releases);
      } else {
        onlineError = result.reason;
      }
    }

    const isInstalled = (note: string) =>
      installed !== undefined && compareVersions(note, installed) <= 0;
    const bundledVersions = listReleaseVersions(directory);
    const bundled = new Set(bundledVersions);
    const entry = (note: ReleaseNote, source: Entry["source"]): Entry => ({
      ...note,
      installed: isInstalled(note.version),
      source,
    });
    // Bundled text wins for every version the package ships; the site fills in the rest.
    const available = (): Entry[] =>
      [
        ...bundledVersions.map((v) => entry(readReleaseNote(v, directory)!, "bundled")),
        ...remoteNotes
          .filter((note) => !bundled.has(note.version))
          .map((note) => entry(note, "remote")),
      ].sort((a, b) => compareVersions(a.version, b.version));

    const show = (notes: Entry[], markdown: string): number => {
      if (json) {
        output.log(
          JSON.stringify(
            {
              installedVersion: installed ?? null,
              latestVersion: latest ?? null,
              ...(onlineError ? { onlineError } : {}),
              versions: notes,
            },
            null,
            2,
          ),
        );
      } else {
        output.log(markdown);
        if (onlineError) {
          output.error(
            `Online check failed (${onlineError}); showing the notes shipped with the installed package. Pass --offline to skip the check.`,
          );
        }
      }

      return 0;
    };

    if (options.list) {
      const notes = available();
      const mark = (note: Entry) => {
        if (offline || onlineError) return "";
        if (note.version === installed) return "  (installed)";

        return note.installed ? "" : "  (newer, not installed)";
      };

      return show(
        notes,
        notes.map((note) => `${note.version}  ${note.date ?? "undated"}${mark(note)}`).join("\n"),
      );
    }

    if (version !== undefined) {
      const wanted = normalizeVersion(version);
      const note = available().find((candidate) => candidate.version === wanted);

      return note ? show([note], note.markdown.trimEnd()) : missing(wanted);
    }

    if (from !== undefined) {
      const lower = normalizeVersion(from);
      const upper = to === undefined ? (latest ?? installed) : normalizeVersion(to);
      const notes = available().filter(
        (note) =>
          compareVersions(note.version, lower) > 0 &&
          (upper === undefined || compareVersions(note.version, upper) <= 0),
      );

      if (notes.length === 0) {
        return show(
          [],
          `No release summaries after ${lower}${to ? ` up to ${to}` : ""} ship with the installed @warlock.js/core.`,
        );
      }

      const newer = notes.filter((note) => !note.installed);
      const body = formatRange(notes, lower);

      return show(notes, newer.length > 0 ? `${body}\n\n---\n\n${newerFooter(newer)}` : body);
    }

    if (!installed) {
      return fail(
        "Could not read the installed @warlock.js/core version. Pass --version <version>.",
      );
    }

    const current = available().find((note) => note.version === normalizeVersion(installed));

    if (!current) return missing(normalizeVersion(installed));

    const newer = available().filter((note) => !note.installed);

    if (newer.length === 0) return show([current], current.markdown.trimEnd());

    const breaking = newer.flatMap((note) =>
      note.breaking.map((line) => `- ${note.version}: ${line}`),
    );
    const section = [
      `# Newer releases (not installed): ${newer.map((note) => note.version).join(", ")}`,
      [
        "## Breaking changes",
        "",
        ...(breaking.length > 0 ? breaking : ["None of these releases lists a breaking change."]),
      ].join("\n"),
      ...newer.map((note) => note.markdown.trimEnd()),
      "Upgrade with: npx warlock update",
    ].join("\n\n---\n\n");

    return show([current, ...newer], `${current.markdown.trimEnd()}\n\n---\n\n${section}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
