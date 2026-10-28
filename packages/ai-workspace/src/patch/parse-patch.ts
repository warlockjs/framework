import { WorkspaceEditError } from "../errors";

/** One line of a hunk: context (`" "`), removal (`"-"`) or addition (`"+"`). */
export interface PatchLine {
  /** What the line does. */
  op: " " | "-" | "+";
  /** The line's text, without its line ending. */
  text: string;
}

/** One `@@ … @@` block of a file's patch. */
export interface PatchHunk {
  /** 1-based first line in the old file (the line *after* which text is inserted when `oldCount` is 0). */
  oldStart: number;
  /** Number of old-file lines the hunk covers. */
  oldCount: number;
  /** The hunk body. */
  lines: PatchLine[];
  /** The old side ends without a trailing newline. */
  oldNoNewline: boolean;
  /** The new side ends without a trailing newline. */
  newNoNewline: boolean;
}

/** What a file's patch does to the tree. */
export type FilePatchKind = "modify" | "create" | "delete" | "rename";

/** Everything a unified diff says about one file. */
export interface FilePatch {
  kind: FilePatchKind;
  /** Path before the change (`null` for a create). */
  oldPath: string | null;
  /** Path after the change (`null` for a delete). */
  newPath: string | null;
  hunks: PatchHunk[];
}

/** Longest patch text accepted, in characters. */
export const MAX_PATCH_CHARS = 2 * 1024 * 1024;

/** Most files one patch may touch. */
export const MAX_PATCH_FILES = 200;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function invalid(message: string, path = ""): WorkspaceEditError {
  return new WorkspaceEditError(message, { type: "patch-invalid", path });
}

/** Unquote a git-quoted path (`"a/with\ttab"`) and strip a trailing timestamp. */
function cleanPath(raw: string): string {
  let value = raw.trim();

  if (value.startsWith('"')) {
    const end = value.lastIndexOf('"');
    const body = end > 0 ? value.slice(1, end) : value.slice(1);

    return body.replace(/\\(["\\tn])/g, (_match, char: string) =>
      char === "t" ? "\t" : char === "n" ? "\n" : char,
    );
  }

  // `--- a/file.ts\t2026-01-01 00:00:00` — the timestamp follows a tab.
  const tab = value.indexOf("\t");

  if (tab !== -1) {
    value = value.slice(0, tab);
  }

  return value.trimEnd();
}

/** `a/x` → `x`; `/dev/null` → `null`. */
function stripPrefix(raw: string, git: boolean): string | null {
  const value = cleanPath(raw);

  if (value === "/dev/null") {
    return null;
  }

  return git && /^[ab]\//.test(value) ? value.slice(2) : value;
}

/**
 * Parse a unified diff (plain or `git diff` style) into per-file patches:
 * modifications, creates (`--- /dev/null`), deletes (`+++ /dev/null`) and
 * renames (`rename from` / `rename to`). A binary patch, a copy, or text that
 * is not a diff throws a `WorkspaceEditError` (`patch-invalid` /
 * `binary-file`) naming the problem.
 *
 * A CRLF-wrapped patch is accepted: one trailing `\r` is dropped from every
 * line.
 */
export function parsePatch(text: string): FilePatch[] {
  if (text.length > MAX_PATCH_CHARS) {
    throw invalid(`The patch is larger than ${MAX_PATCH_CHARS} characters; split it up.`);
  }

  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const files: FilePatch[] = [];

  let current:
    | {
        git: boolean;
        oldPath: string | null | undefined;
        newPath: string | null | undefined;
        renameFrom?: string;
        renameTo?: string;
        isNew: boolean;
        isDeleted: boolean;
        hunks: PatchHunk[];
      }
    | undefined;

  const finish = (): void => {
    if (current === undefined) {
      return;
    }

    const state = current;

    current = undefined;

    let dashOld = state.oldPath;
    let dashNew = state.newPath;

    // A plain diff keeps its `a/` / `b/` prefixes (as `git diff --no-index`
    // and `diff -u a/x b/x` write them); drop them when both sides carry one.
    if (!state.git) {
      const oldOk = dashOld === undefined || dashOld === null || dashOld.startsWith("a/");
      const newOk = dashNew === undefined || dashNew === null || dashNew.startsWith("b/");

      if (oldOk && newOk) {
        dashOld = typeof dashOld === "string" ? dashOld.slice(2) : dashOld;
        dashNew = typeof dashNew === "string" ? dashNew.slice(2) : dashNew;
      }
    }

    let oldPath = state.renameFrom ?? dashOld;
    let newPath = state.renameTo ?? dashNew;

    if (state.isNew) {
      oldPath = null;
    }

    if (state.isDeleted) {
      newPath = null;
    }

    if (oldPath === undefined && newPath === undefined) {
      throw invalid("A file section of the patch names no file.");
    }

    if (oldPath === undefined) {
      oldPath = newPath ?? null;
    }

    if (newPath === undefined) {
      newPath = oldPath;
    }

    const kind: FilePatchKind =
      oldPath === null
        ? "create"
        : newPath === null
          ? "delete"
          : oldPath !== newPath
            ? "rename"
            : "modify";

    // A section with neither hunks nor a structural change (e.g. a mode-only
    // change) has nothing to apply; skip it rather than touch the file.
    if (state.hunks.length === 0 && kind === "modify") {
      return;
    }

    files.push({ kind, oldPath, newPath, hunks: state.hunks });
  };

  const open = (git: boolean) => {
    finish();
    current = {
      git,
      oldPath: undefined,
      newPath: undefined,
      isNew: false,
      isDeleted: false,
      hunks: [],
    };

    return current;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string;

    if (line.startsWith("diff --git ")) {
      const section = open(true);
      const rest = line.slice("diff --git ".length);
      // Best effort for header-only sections (pure renames, mode changes):
      // `a/x b/y`. Refined by `---`/`+++`/`rename` lines when present.
      const split = rest.indexOf(" b/");

      if (rest.startsWith("a/") && split !== -1) {
        section.oldPath = rest.slice(2, split);
        section.newPath = rest.slice(split + 3);
      }

      continue;
    }

    const startsPlainFile =
      line.startsWith("--- ") &&
      lines[index + 1]?.startsWith("+++ ") === true &&
      (current === undefined || (!current.git && current.hunks.length > 0));

    if (startsPlainFile) {
      open(false);
    } else if (current === undefined) {
      // Text before the first file header (a commit message, prose).
      if (line.startsWith("*** Begin Patch")) {
        throw invalid(
          'This is the "*** Begin Patch" format, not a unified diff. Send a unified diff (`--- a/file` / `+++ b/file` / `@@` hunks).',
        );
      }

      continue;
    }

    const section = current as NonNullable<typeof current>;

    if (line.startsWith("GIT binary patch") || /^Binary files .* differ$/.test(line)) {
      const shown = section.newPath ?? section.oldPath ?? "a file";

      throw new WorkspaceEditError(
        `The patch changes a binary file (${shown}); binary files cannot be patched.`,
        { type: "binary-file", path: shown ?? "" },
      );
    }

    if (line.startsWith("copy from ") || line.startsWith("copy to ")) {
      throw invalid("Copies are not supported in a patch; create the new file instead.");
    }

    if (line.startsWith("rename from ")) {
      section.renameFrom = cleanPath(line.slice("rename from ".length));
      continue;
    }

    if (line.startsWith("rename to ")) {
      section.renameTo = cleanPath(line.slice("rename to ".length));
      continue;
    }

    if (line.startsWith("new file mode")) {
      section.isNew = true;
      continue;
    }

    if (line.startsWith("deleted file mode")) {
      section.isDeleted = true;
      continue;
    }

    if (line.startsWith("--- ") && section.hunks.length === 0) {
      section.oldPath = stripPrefix(line.slice(4), section.git);

      if (section.oldPath === null) {
        section.isNew = true;
      }

      continue;
    }

    if (line.startsWith("+++ ") && section.hunks.length === 0) {
      section.newPath = stripPrefix(line.slice(4), section.git);

      if (section.newPath === null) {
        section.isDeleted = true;
      }

      continue;
    }

    const header = HUNK_HEADER.exec(line);

    if (header !== null) {
      const oldStart = Number(header[1]);
      const oldCount = header[2] === undefined ? 1 : Number(header[2]);
      let newCount = header[4] === undefined ? 1 : Number(header[4]);
      let remainingOld = oldCount;
      const hunk: PatchHunk = {
        oldStart,
        oldCount,
        lines: [],
        oldNoNewline: false,
        newNoNewline: false,
      };

      while (remainingOld > 0 || newCount > 0 || lines[index + 1]?.startsWith("\\")) {
        const body = lines[index + 1];

        if (body === undefined) {
          break;
        }

        if (body.startsWith("\\")) {
          const last = hunk.lines[hunk.lines.length - 1];

          if (last?.op !== "+") {
            hunk.oldNoNewline = true;
          }

          if (last?.op !== "-") {
            hunk.newNoNewline = true;
          }

          index++;
          continue;
        }

        if (remainingOld <= 0 && newCount <= 0) {
          break;
        }

        const op = body.charAt(0);

        if (op === "+" && newCount > 0) {
          hunk.lines.push({ op: "+", text: body.slice(1) });
          newCount--;
        } else if (op === "-" && remainingOld > 0) {
          hunk.lines.push({ op: "-", text: body.slice(1) });
          remainingOld--;
        } else if ((op === " " || body === "") && remainingOld > 0 && newCount > 0) {
          // An empty line is a context line whose single space was stripped.
          hunk.lines.push({ op: " ", text: body.slice(1) });
          remainingOld--;
          newCount--;
        } else {
          break;
        }

        index++;
      }

      if (remainingOld > 0 || newCount > 0) {
        throw invalid(
          `Hunk ${section.hunks.length + 1} of ${section.newPath ?? section.oldPath ?? "the patch"} is truncated or its line counts in the @@ header are wrong.`,
          section.newPath ?? section.oldPath ?? "",
        );
      }

      section.hunks.push(hunk);
      continue;
    }

    // Anything else between sections (`index …`, `old mode`, `similarity index`, blanks) is ignored.
  }

  finish();

  if (files.length === 0) {
    throw invalid(
      "The patch contains no file changes. Send a unified diff with ---/+++ headers and @@ hunks.",
    );
  }

  if (files.length > MAX_PATCH_FILES) {
    throw invalid(`The patch touches more than ${MAX_PATCH_FILES} files; split it up.`);
  }

  return files;
}
