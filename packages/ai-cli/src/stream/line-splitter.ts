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
  let pending = "";
  let overflowed = false;

  const consume = (text: string): void => {
    pending += text;

    let newline = pending.indexOf("\n");

    while (newline !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, "");

      pending = pending.slice(newline + 1);

      if (overflowed) {
        overflowed = false;
      } else {
        onLine(line);
      }

      newline = pending.indexOf("\n");
    }

    if (pending.length > MAX_LINE_BYTES) {
      pending = "";

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

      if (pending.length > 0 && !overflowed) {
        onLine(pending.replace(/\r$/, ""));
      }

      pending = "";
    },
  };
}
