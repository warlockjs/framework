/**
 * The value grammar of the written files and the readers that turn front
 * matter fields into located values, reporting GR1003 (missing), GR1004
 * (wrong form) and GR1005 (not in the template) as they go.
 */
import type { Located } from "../contracts/location";
import type { FrontMatterField } from "../front-matter";
import { toPosixPath } from "../paths";
import { lineAt, type WrittenDocument } from "./markdown";
import type { FindingSink } from "./sink";

/** An id: lower-case words joined by single dashes (`new-arrivals`). */
export const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A feature version: `2.1`. */
export const VERSION = /^\d+\.\d+$/;
/** A task id: `T-14`. */
export const TASK_ID = /^T-\d+$/;
/** A flow reference: `<feature>/<flow>`. */
export const FLOW_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * The separator between the name and the text of a list line: two or more
 * spaces, or a tab with any spaces around it.
 */
export const SEP = String.raw`(?:[ \t]*\t[ \t]*| {2,})`;

/** Whether `value` is a real calendar date written `yyyy-mm-dd`. */
export function isDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * A project-relative folder as written in front matter, with `\` turned
 * into `/`, a leading `./` and trailing `/` removed. `null` when it is
 * absolute or leaves the project.
 */
export function projectFolder(value: string): string | null {
  const posix = toPosixPath(value.trim())
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");

  if (posix === "" || posix.startsWith("/") || /^[A-Za-z]:/.test(posix)) return null;
  if (posix.split("/").includes("..")) return null;

  return posix;
}

/** Reads the front matter of one document against its template. */
export class FrontMatterReader {
  private readonly fields: Map<string, FrontMatterField>;

  public constructor(
    private readonly document: WrittenDocument,
    private readonly sink: FindingSink,
  ) {
    this.fields = document.fields ?? new Map();
  }

  /** Whether the file had a front matter block at all. */
  public get present(): boolean {
    return this.document.fields !== null;
  }

  private at(line: number): Located<string>["at"] {
    return lineAt(this.document.file, line);
  }

  /** Where a missing key is reported: the opening `---`. */
  private get top(): Located<string>["at"] {
    return this.at(1);
  }

  /** GR1005 for each key that is not one of `keys`. */
  public onlyKeys(keys: readonly string[], what: string): void {
    for (const field of this.fields.values()) {
      if (!keys.includes(field.key)) {
        this.sink.report(
          "GR1005",
          keys.length === 0
            ? `${what} has no front matter; the key "${field.key}" is not read.`
            : `The front matter key "${field.key}" is not part of the ${what} template (${keys.join(", ")}).`,
          this.at(field.line),
        );
      }
    }
  }

  /** Whether the key is written. */
  public has(key: string): boolean {
    return this.fields.has(key);
  }

  /**
   * A scalar value, checked with `check` (which returns the form expected
   * when the value is wrong). Missing → GR1003 when `required` (only when
   * the file has front matter: GR1001 already covers a file with none).
   */
  public scalar(
    key: string,
    options: { required: boolean; check?: (value: string) => string | null },
  ): Located<string> | null {
    const field = this.fields.get(key);

    if (!field) {
      if (options.required && this.present) {
        this.sink.report("GR1003", `The front matter key "${key}" is missing.`, this.top);
      }

      return null;
    }

    const at = this.at(field.line);

    if (Array.isArray(field.value)) {
      this.sink.report(
        "GR1004",
        field.value.length === 0
          ? `The front matter key "${key}" has no value.`
          : `The front matter key "${key}" must be one value, not a list.`,
        at,
      );

      return { value: field.value.join(", "), at };
    }

    const expected = options.check?.(field.value) ?? null;

    if (expected !== null) {
      this.sink.report(
        "GR1004",
        `The front matter key "${key}" is ${JSON.stringify(field.value)}; ${expected}.`,
        at,
      );
    }

    return { value: field.value, at };
  }

  /** A required scalar; a missing one becomes `""` at the top of the file. */
  public required(key: string, check?: (value: string) => string | null): Located<string> {
    return (
      this.scalar(key, check ? { required: true, check } : { required: true }) ?? {
        value: "",
        at: this.top,
      }
    );
  }

  /** A scalar that must be one of `values`; `fallback` is used when it is missing or wrong. */
  public oneOf<T extends string>(key: string, values: readonly T[], fallback: T): Located<T> {
    const located = this.scalar(key, {
      required: true,
      check: (value) => (values.includes(value as T) ? null : `use one of: ${values.join(", ")}`),
    });

    if (located === null) return { value: fallback, at: this.top };

    return {
      value: values.includes(located.value as T) ? (located.value as T) : fallback,
      at: located.at,
    };
  }

  /** An optional scalar that must be one of `values`; `null` when missing or wrong. */
  public optionalOneOf<T extends string>(key: string, values: readonly T[]): Located<T> | null {
    const located = this.scalar(key, {
      required: false,
      check: (value) => (values.includes(value as T) ? null : `use one of: ${values.join(", ")}`),
    });

    if (located === null || !values.includes(located.value as T)) return null;

    return { value: located.value as T, at: located.at };
  }

  /**
   * A list value (`[a, b]` or `- item` lines; a single scalar is a list of
   * one). Each item is checked with `check`; a wrong item is reported and
   * left out unless `keepWrong` is set.
   */
  public list(
    key: string,
    options: {
      required: boolean;
      check?: (value: string) => string | null;
      map?: (value: string) => string;
      keepWrong?: boolean;
    },
  ): Located<string>[] {
    const field = this.fields.get(key);

    if (!field) {
      if (options.required && this.present) {
        this.sink.report("GR1003", `The front matter key "${key}" is missing.`, this.top);
      }

      return [];
    }

    const items = Array.isArray(field.value)
      ? field.value
      : field.value === ""
        ? []
        : [field.value];
    const result: Located<string>[] = [];

    items.forEach((item, index) => {
      const at = this.at(field.itemLines[index] ?? field.line);
      const expected = options.check?.(item) ?? null;

      if (expected !== null) {
        this.sink.report(
          "GR1004",
          `The "${key}" item ${JSON.stringify(item)} is wrong: ${expected}.`,
          at,
        );

        if (!options.keepWrong) return;
      }

      result.push({ value: options.map ? options.map(item) : item, at });
    });

    return result;
  }
}

/** Checks used with `FrontMatterReader`; each returns the expected form, or `null` when the value is right. */
export const checks = {
  id: (value: string): string | null =>
    ID.test(value) ? null : "write it in lower-case words joined by dashes",
  version: (value: string): string | null =>
    VERSION.test(value) ? null : "write a version as <whole>.<decimal>, like 2.1",
  date: (value: string): string | null => (isDate(value) ? null : "write a date as yyyy-mm-dd"),
  text: (value: string): string | null => (value.trim() === "" ? "write a value" : null),
  route: (value: string): string | null =>
    value.startsWith("/") ? null : "a route path starts with /",
  flowRef: (value: string): string | null =>
    FLOW_REF.test(value) ? null : "write it as <feature>/<flow>",
  folder: (value: string): string | null =>
    projectFolder(value) === null ? "write a folder relative to the project root" : null,
  name: (value: string): string | null =>
    value.trim() === "" || /\s/.test(value.trim()) ? "write it without spaces" : null,
};
