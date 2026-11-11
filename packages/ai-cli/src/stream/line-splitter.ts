import { StringDecoder } from "node:string_decoder";

/** Longest line kept in memory; a longer one is dropped (reported via `onOverflow`). */
export const MAX_LINE_BYTES = 32 * 1024 * 1024;

/**
 * Split a byte stream into lines. Multi-byte UTF-8 characters split across
 * chunks are decoded correctly, `\r\n` and `\n` both end a line, and a final
 * line without a newline is flushed by `end()`.
 *
 * @example
 * const splitter = createLineSplitter((line) => console.log(line));
 * splitter.write(Buffer.from('{"a":1}\n{"b"'));
 * splitter.write(Buffer.from(":2}\n"));
 * splitter.end();
 */
export function createLineSplitter(
  onLine: (line: string) => void,
  onOverflow: () => void = () => undefined,
): { write(chunk: Buffer): void; end(): void } {
  const decoder = new StringDecoder("utf8");
  // The unfinished line, kept as parts and joined only when its newline
  // arrives, so each chunk is scanned once however long the line grows.
  let parts: string[] = [];
  let pendingLength = 0;
  let overflowed = false;

  const takePending = (tail: string): string => {
    const line = parts.length === 0 ? tail : parts.join("") + tail;

    parts = [];
    pendingLength = 0;

    return line;
  };

  const consume = (text: string): void => {
    let start = 0;
    let newline = text.indexOf("\n");

    while (newline !== -1) {
      const line = takePending(text.slice(start, newline)).replace(/\r$/, "");

      start = newline + 1;

      if (overflowed) {
        overflowed = false;
      } else {
        onLine(line);
      }

      newline = text.indexOf("\n", start);
    }

    if (start < text.length) {
      parts.push(start === 0 ? text : text.slice(start));
      pendingLength += text.length - start;
    }

    if (pendingLength > MAX_LINE_BYTES) {
      parts = [];
      pendingLength = 0;

      if (!overflowed) {
        overflowed = true;
        onOverflow();
      }
    }
  };

  return {
    write(chunk: Buffer): void {
      consume(decoder.write(chunk));
    },
    end(): void {
      consume(decoder.end());

      const rest = takePending("");

      if (rest.length > 0 && !overflowed) {
        onLine(rest.replace(/\r$/, ""));
      }
    },
  };
}
