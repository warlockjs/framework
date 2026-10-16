import { stripVTControlCharacters } from "node:util";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function visibleWidth(text: string): number {
  let width = 0;
  for (const { segment } of segmenter.segment(stripVTControlCharacters(text))) {
    if (/^[\p{Mark}\p{Control}\p{Format}]+$/u.test(segment)) continue;
    const point = segment.codePointAt(0)!;
    const wide =
      /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(segment) ||
      (point >= 0x1100 &&
        (point <= 0x115f ||
          point === 0x2329 ||
          point === 0x232a ||
          (point >= 0x2e80 && point <= 0xa4cf) ||
          (point >= 0xac00 && point <= 0xd7a3) ||
          (point >= 0xf900 && point <= 0xfaff) ||
          (point >= 0xfe10 && point <= 0xfe6f) ||
          (point >= 0xff01 && point <= 0xff60) ||
          (point >= 0xffe0 && point <= 0xffe6) ||
          (point >= 0x20000 && point <= 0x3fffd)));
    width += wide ? 2 : 1;
  }
  return width;
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of stripVTControlCharacters(text).split(/\s+/u)) {
    if (line && visibleWidth(`${line} ${word}`) > width) {
      lines.push(line);
      line = "";
    }
    for (const { segment } of segmenter.segment(`${line ? " " : ""}${word}`)) {
      if (visibleWidth(line + segment) > width) {
        lines.push(line);
        line = "";
      }
      line += segment;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

export type StyledSegment = { text: string; style: (text: string) => string };

export function wrapStyledText(
  segments: StyledSegment[],
  width: number,
): string[] {
  const text = segments.map(segment => segment.text).join("");
  let offset = 0;
  return wrapText(text, width).map(line => {
    while (/\s/u.test(text[offset] ?? "") && offset < text.length) offset++;
    const start = offset;
    offset += line.length;
    let segmentStart = 0;
    return segments
      .map(segment => {
        const segmentEnd = segmentStart + segment.text.length;
        const from = Math.max(start, segmentStart);
        const to = Math.min(offset, segmentEnd);
        const result =
          to > from
            ? segment.style(
                segment.text.slice(from - segmentStart, to - segmentStart),
              )
            : "";
        segmentStart = segmentEnd;
        return result;
      })
      .join("");
  });
}
