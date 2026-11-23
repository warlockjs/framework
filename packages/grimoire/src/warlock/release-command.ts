/**
 * `warlock grimoire release [version] --stamp [--date yyyy-mm-dd]`: move the
 * `## Unreleased` entries of every feature changelog under
 * `## <version> (<date>)`, write the release file when it is missing, then
 * collect the list. The version defaults to the app's `package.json` version and
 * the date to the release file's date, else today.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GrimoireError } from "../codes";
import { applyStamp, writeRelease } from "../releases";
import { parseGrimoire } from "../written";
import { isDate } from "../written/fields";
import { reportError, type CommandContext } from "./actions";

async function packageVersion(root: string): Promise<string> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const version = (parsed as { version?: unknown }).version;

    return typeof version === "string" ? version.trim() : "";
  } catch {
    return "";
  }
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Stamp and collect a release; the version defaults to the app's `package.json` version. */
export async function runStampRelease(
  context: CommandContext,
  release: string | undefined,
  options: Record<string, unknown> = {},
): Promise<number> {
  const { root, io } = context;

  try {
    const name = (release?.trim() ?? "") || (await packageVersion(root));

    if (name === "" || /[\\/\s]/.test(name) || name.startsWith(".")) {
      throw new GrimoireError(
        "GR9006",
        `Pass the release name, like warlock grimoire release 1.4.0 --stamp, or give package.json a version (got ${JSON.stringify(name)}).`,
      );
    }

    const given = typeof options.date === "string" ? options.date.trim() : undefined;

    if (options.date !== undefined && (given === undefined || !isDate(given))) {
      throw new GrimoireError(
        "GR9006",
        `--date must be yyyy-mm-dd (got ${JSON.stringify(options.date)}).`,
      );
    }

    const { written } = await parseGrimoire(root);
    const existing = written.releases.find((item) => item.release.value === name);
    const kept = existing?.date.value ?? "";

    if (given !== undefined && kept !== "" && kept !== given) {
      throw new GrimoireError(
        "GR9006",
        `${existing?.file ?? name} is dated ${kept}, not ${given}. Pass --date ${kept} or leave --date out.`,
      );
    }

    const date = given ?? (isDate(kept) ? kept : today());
    const plan = await applyStamp(root, written, name, date);
    // Read again: the changelogs and the release file changed.
    const outcome = await writeRelease(root, (await parseGrimoire(root)).written, name);
    const stamped = plan.changelogs.map((item) => item.feature);
    const created = plan.release?.file ?? null;

    if (options.json === true) {
      io.out(JSON.stringify({ stamped, created, collect: outcome }, null, 2));

      return 0;
    }

    io.out(
      stamped.length > 0
        ? `stamped ${stamped.join(", ")} → ${name} (${date})`
        : `nothing to stamp: no feature changelog has entries under ## Unreleased`,
    );

    if (created !== null) io.out(`wrote ${created}`);

    const entries = outcome.collection.entries;

    io.out(
      `${outcome.file}: ${entries.length} ${entries.length === 1 ? "entry" : "entries"} collected${
        outcome.changed ? "" : ", file unchanged"
      }`,
    );

    return 0;
  } catch (error) {
    return reportError(io, error);
  }
}
