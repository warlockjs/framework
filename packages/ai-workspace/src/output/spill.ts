import path from "node:path";
import type {
  WorkspaceBackend,
  WorkspaceOutputKeep,
  WorkspacePolicy,
  WorkspaceTruncation,
} from "../contracts";
import { resolveSpillDir } from "./spill-dir";

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SPILL_NAME = /^spill-(\d+)-[a-z0-9]+-[a-z0-9_-]+\.txt$/;

/** What spilling an output produced. */
export interface SpilledText {
  /** The text to return (marker included). */
  value: string;
  /** Set when anything was left out. */
  truncation?: WorkspaceTruncation;
}

/** What spilling a list of entries produced. */
export interface SpilledList<T> {
  items: T[];
  truncation?: WorkspaceTruncation;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** The first `maxBytes` bytes of `value`, cut on a character boundary. */
function headOf(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");

  if (bytes.byteLength <= maxBytes) {
    return value;
  }

  let cut = Math.max(0, maxBytes);

  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) {
    cut--;
  }

  return bytes.subarray(0, cut).toString("utf8");
}

/** The last `maxBytes` bytes of `value`, cut on a character boundary. */
function tailOf(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");

  if (bytes.byteLength <= maxBytes) {
    return value;
  }

  let from = bytes.byteLength - Math.max(0, maxBytes);

  while (from < bytes.byteLength && ((bytes[from] ?? 0) & 0xc0) === 0x80) {
    from++;
  }

  return bytes.subarray(from).toString("utf8");
}

/** Lines of `value`; a trailing line break does not add an empty line. */
export function splitLines(value: string): string[] {
  if (value === "") {
    return [];
  }

  const lines = value.split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

/** Pick lines from the front within `lines` / `bytes`; one oversized line is clipped. */
function takeHead(lines: string[], maxLines: number, maxBytes: number): string[] {
  const out: string[] = [];
  let used = 0;

  for (const line of lines) {
    if (out.length >= maxLines) {
      break;
    }

    const cost = byteLength(line) + 1;

    if (used + cost > maxBytes) {
      if (out.length === 0 && maxBytes > 0) {
        out.push(headOf(line, maxBytes));
      }

      break;
    }

    out.push(line);
    used += cost;
  }

  return out;
}

/** Pick lines from the back, same limits; the result is in file order. */
function takeTail(lines: string[], maxLines: number, maxBytes: number): string[] {
  const out: string[] = [];
  let used = 0;

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index] ?? "";

    if (out.length >= maxLines) {
      break;
    }

    const cost = byteLength(line) + 1;

    if (used + cost > maxBytes) {
      if (out.length === 0 && maxBytes > 0) {
        out.push(tailOf(line, maxBytes));
      }

      break;
    }

    out.unshift(line);
    used += cost;
  }

  return out;
}

/** Choose the lines to keep for `keep`; `headCount` lines come from the front. */
function select(
  lines: string[],
  keep: WorkspaceOutputKeep,
  maxLines: number,
  maxBytes: number,
): { head: string[]; tail: string[] } {
  if (keep === "head") {
    return { head: takeHead(lines, maxLines, maxBytes), tail: [] };
  }

  if (keep === "tail") {
    return { head: [], tail: takeTail(lines, maxLines, maxBytes) };
  }

  const headLines = Math.ceil(maxLines / 2);
  const headBytes = Math.ceil(maxBytes / 2);
  const head = takeHead(lines, headLines, headBytes);
  const rest = lines.slice(head.length);
  const tail = takeTail(rest, maxLines - head.length, maxBytes - headBytes);

  return { head, tail };
}

/**
 * Keeps oversized command, search and read output from flooding the model:
 * with `output.spillDir` set it saves the full output to a file and returns
 * the part the policy keeps plus a pointer to it. One instance per ops layer;
 * it remembers the files it wrote so `dispose()` can remove them.
 */
export class OutputSpiller {
  private readonly created: string[] = [];
  private readonly dir: string | undefined;

  public constructor(
    private readonly backend: WorkspaceBackend,
    private readonly policy: WorkspacePolicy,
  ) {
    this.dir = resolveSpillDir(policy);

    if (this.dir !== undefined && this.retentionMs > 0) {
      void this.sweep();
    }
  }

  /** True when `output.spillDir` is set. */
  public get enabled(): boolean {
    return this.dir !== undefined;
  }

  /** The spill directory, when spilling is on. */
  public get spillDir(): string | undefined {
    return this.dir;
  }

  private get retentionMs(): number {
    return this.policy.output?.retentionMs ?? DEFAULT_RETENTION_MS;
  }

  private limits(cap: number | undefined): { maxLines: number; maxBytes: number } {
    const configured = this.policy.output?.maxBytes ?? DEFAULT_MAX_BYTES;

    return {
      maxLines: Math.max(1, Math.floor(this.policy.output?.maxLines ?? DEFAULT_MAX_LINES)),
      maxBytes: Math.max(1, Math.floor(cap === undefined ? configured : Math.min(configured, cap))),
    };
  }

  /** Remove spill files older than the retention (only files named like ours). */
  public async sweep(): Promise<void> {
    if (this.dir === undefined) {
      return;
    }

    try {
      const now = Date.now();

      for (const file of await this.backend.list(this.dir)) {
        const match = SPILL_NAME.exec(path.basename(file));

        if (match !== null && now - Number(match[1]) > this.retentionMs) {
          await this.backend.remove(file).catch(() => undefined);
        }
      }
    } catch {
      // No spill directory yet, or it is not listable: nothing to clean.
    }
  }

  /** Write `content` to a new spill file and return its absolute path. */
  private async write(label: string, content: string): Promise<string | undefined> {
    if (this.dir === undefined) {
      return undefined;
    }

    try {
      if (this.retentionMs > 0) {
        await this.sweep();
      }

      const safe = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "output";
      const rand = Math.random().toString(36).slice(2, 8) || "x";
      const file = path.join(this.dir, `spill-${Date.now()}-${rand}-${safe}.txt`);

      await this.backend.mkdir(this.dir);
      await this.backend.writeFile(file, content);
      this.created.push(file);

      return file;
    } catch {
      return undefined;
    }
  }

  /**
   * Fit `value` to the policy. Returns it untouched when it fits. Over the
   * limits with spilling on, the whole text is saved and the kept lines come
   * back with a `[showing lines … of …; full output saved to …]` marker.
   * `cap` is a tighter byte limit from elsewhere (`shell.maxOutputBytes`).
   */
  public async text(
    label: string,
    value: string,
    defaultKeep: WorkspaceOutputKeep,
    cap?: number,
  ): Promise<SpilledText> {
    if (this.dir === undefined) {
      return { value };
    }

    const { maxLines, maxBytes } = this.limits(cap);
    const lines = splitLines(value);
    const totalBytes = byteLength(value);

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { value };
    }

    const keep = this.policy.output?.keep ?? defaultKeep;
    const { head, tail } = select(lines, keep, maxLines, maxBytes);
    const file = await this.write(label, value);
    const shown = head.length + tail.length;
    const total = lines.length;
    const where = file === undefined ? "the rest was dropped" : `full output saved to ${file}`;
    const range =
      tail.length === 0
        ? `lines 1-${head.length}`
        : head.length === 0
          ? `lines ${total - tail.length + 1}-${total}`
          : `lines 1-${head.length} and ${total - tail.length + 1}-${total}`;
    const marker = `[showing ${range} of ${total}; ${where}]`;
    const parts = [...(head.length > 0 ? [head.join("\n")] : []), marker];

    if (tail.length > 0) {
      parts.push(tail.join("\n"));

      // The marker sits between head and tail; end the text with the file too.
      if (file !== undefined) {
        parts.push(`[full output saved to ${file}]`);
      }
    }

    return {
      value: parts.join("\n"),
      truncation: {
        shown: { lines: shown },
        total: { lines: total, bytes: totalBytes },
        ...(file !== undefined ? { path: file } : {}),
      },
    };
  }

  /**
   * Fit a list of entries (one line each when rendered) to the policy; the
   * rendered full list is what gets saved.
   */
  public async list<T>(
    label: string,
    items: T[],
    render: (item: T) => string,
    defaultKeep: WorkspaceOutputKeep,
  ): Promise<SpilledList<T>> {
    if (this.dir === undefined) {
      return { items };
    }

    const { maxLines, maxBytes } = this.limits(undefined);
    const lines = items.map(render);
    const totalBytes = lines.reduce((sum, line) => sum + byteLength(line) + 1, 0);

    if (items.length <= maxLines && totalBytes <= maxBytes) {
      return { items };
    }

    const keep = this.policy.output?.keep ?? defaultKeep;
    // Count how many whole entries fit from each end, then slice the items.
    const { head, tail } = select(lines, keep, maxLines, maxBytes);
    const headCount = head.length;
    const tailCount = tail.length;
    const file = await this.write(label, lines.join("\n") + "\n");

    return {
      items: [...items.slice(0, headCount), ...items.slice(items.length - tailCount)],
      truncation: {
        shown: { lines: headCount + tailCount },
        total: { lines: items.length, bytes: totalBytes },
        ...(file !== undefined ? { path: file } : {}),
      },
    };
  }

  /** Save the complete text of an output that was already cut elsewhere. */
  public async save(label: string, content: string): Promise<string | undefined> {
    return this.write(label, content);
  }

  /** Remove expired files, and this run's own when `retentionMs` is `0`. */
  public async dispose(): Promise<void> {
    if (this.dir === undefined) {
      return;
    }

    if (this.retentionMs === 0) {
      for (const file of this.created.splice(0)) {
        await this.backend.remove(file).catch(() => undefined);
      }

      return;
    }

    await this.sweep();
  }
}
