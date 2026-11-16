/**
 * Where a value was read, so a finding can point at it.
 *
 * Every path in Grimoire data is project-relative and uses `/`, on every
 * platform. Convert with `toPosixPath()` before comparing.
 */
export type SourceLocation = {
  /** Project-relative POSIX path (`grimoire/features/catalog/flows/wishlist.md`). */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column, or `null` when the whole line is meant. */
  column: number | null;
};

/** A value with the place it was read from. */
export type Located<T> = {
  value: T;
  at: SourceLocation;
};
