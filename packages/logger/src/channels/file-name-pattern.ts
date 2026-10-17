/**
 * A file name (without extension): a pattern string, or a function of the
 * current date.
 *
 * Pattern tokens, rendered in local time and zero-padded:
 * `{YYYY}` year, `{MM}` month, `{DD}` day, `{HH}` hour (00-23), `{mm}` minute,
 * and `{name}` the channel's `name` option. Any other text is literal.
 *
 * @example "app-{YYYY}-{MM}-{DD}" // → "app-2026-10-17"
 * @example (date) => `audit-${date.getFullYear()}` // → "audit-2026"
 */
export type FileNameOption = string | ((date: Date) => string);

const TOKEN = /\{(YYYY|MM|DD|HH|mm|name)\}/g;

const pad = (value: number) => String(value).padStart(2, "0");

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Render a file name option for the given date.
 */
export function renderFileName(option: FileNameOption, date: Date, name: string): string {
  if (typeof option === "function") return option(date);

  return option.replace(TOKEN, (_match, token: string) => {
    switch (token) {
      case "YYYY":
        return String(date.getFullYear());
      case "MM":
        return pad(date.getMonth() + 1);
      case "DD":
        return pad(date.getDate());
      case "HH":
        return pad(date.getHours());
      case "mm":
        return pad(date.getMinutes());
      default:
        return name;
    }
  });
}

/**
 * Regular-expression source matching every name a pattern string can render:
 * literal text is escaped, date tokens become digit runs and `{name}` the
 * escaped channel name. The source is not anchored.
 */
export function fileNamePatternSource(pattern: string, name: string): string {
  let source = "";
  let lastIndex = 0;

  for (const match of pattern.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    const token = match[1];

    source += escapeRegExp(pattern.slice(lastIndex, index));
    source += token === "YYYY" ? "\\d{4}" : token === "name" ? escapeRegExp(name) : "\\d{2}";
    lastIndex = index + match[0].length;
  }

  return source + escapeRegExp(pattern.slice(lastIndex));
}
