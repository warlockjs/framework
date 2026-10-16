/**
 * Sizing for clack list prompts, so a prompt never draws more lines than the
 * terminal shows.
 *
 * clack redraws a prompt by moving the cursor up as many lines as its last
 * frame had `\n`s. When the frame is taller than the terminal, or a row is
 * wider than the terminal and wraps, the cursor cannot reach the old lines:
 * every redraw then prints a fresh copy of the list below the last one.
 * Keeping each row on one line and the option list within the terminal's
 * height avoids both.
 */

type ListOption = { label: string; hint?: string };

/** Used when the output is not a terminal (piped, CI) and reports no size. */
const FALLBACK_COLUMNS = 80;
const FALLBACK_ROWS = 24;

/** Lines a multiselect draws besides its options: message, bars, scroll markers, a spare line. */
const PROMPT_CHROME_LINES = 6;

/** clack never shows fewer than five options, whatever maxItems says. */
const MIN_VISIBLE_OPTIONS = 5;

/** `│  ◻ ` before the label, ` (` and `)` around the hint. */
const ROW_PREFIX_WIDTH = 5;
const HINT_BRACKETS_WIDTH = 3;

/** Below this many characters a hint says nothing useful, so it is dropped. */
const MIN_HINT_WIDTH = 12;

/**
 * How many options a multiselect may show at once in a terminal `rows` lines
 * tall. clack scrolls the rest.
 */
export function multiselectMaxItems(optionCount: number, rows = process.stdout.rows): number {
  const height = rows && rows > 0 ? rows : FALLBACK_ROWS;
  const fit = Math.max(MIN_VISIBLE_OPTIONS, height - PROMPT_CHROME_LINES);

  return Math.min(optionCount, fit);
}

/**
 * Shorten each option's hint so its row (label and hint) fits on one line of a
 * terminal `columns` wide. A hint with too little room left is dropped.
 */
export function fitOptionsToWidth<Option extends ListOption>(
  options: readonly Option[],
  columns = process.stdout.columns,
): Option[] {
  const width = (columns && columns > 0 ? columns : FALLBACK_COLUMNS) - 1;

  return options.map((option) => {
    if (!option.hint) return option;

    const room = width - ROW_PREFIX_WIDTH - option.label.length - HINT_BRACKETS_WIDTH;

    if (option.hint.length <= room) return option;

    if (room < MIN_HINT_WIDTH) {
      const withoutHint = { ...option };

      delete withoutHint.hint;

      return withoutHint;
    }

    return { ...option, hint: `${option.hint.slice(0, room - 1).trimEnd()}…` };
  });
}
