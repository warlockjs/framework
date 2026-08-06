import readline from "node:readline";

/**
 * A single-keypress shortcut offered by the dev server while it runs.
 */
export type DevServerShortcut = {
  /** The key that triggers it, e.g. `"u"`. Matched case-insensitively. */
  key: string;
  /** Short human label, used when we print the available shortcuts. */
  description: string;
  /** What to run when the key is pressed. Rejections are swallowed. */
  handler: () => void | Promise<void>;
};

/**
 * Single-keypress shortcuts for the dev server (`press u to update`, …).
 *
 * Reading one key at a time requires putting stdin into raw mode, which
 * means this process — not the terminal driver — becomes responsible for
 * `Ctrl+C`. The manager therefore re-raises `SIGINT` itself so the existing
 * graceful-shutdown handlers keep working exactly as before.
 *
 * Everything is opt-in and self-guarding: with no TTY (piped output, CI,
 * a supervisor) `register()` reports `false` and stdin is never touched, so
 * callers can fall back to printing a plain "run `npx warlock update`" hint.
 */
export class DevServerShortcuts {
  private readonly shortcuts = new Map<string, DevServerShortcut>();

  /** Whether we currently hold stdin in raw mode. */
  private listening = false;

  /** Set while a handler runs, so a second keypress can't re-enter it. */
  private busy = false;

  private keypressListener?: (character: string, key: KeypressEvent) => void;

  /**
   * @param input       The stream to read keys from. Defaults to the process's
   *                    own stdin; tests pass a fake TTY instead.
   * @param onInterrupt What `Ctrl+C` does once raw mode has taken it away from
   *                    the terminal driver. Defaults to re-raising `SIGINT`.
   */
  public constructor(
    private readonly input: NodeJS.ReadStream = process.stdin,
    private readonly onInterrupt: () => void = raiseInterrupt,
  ) {}

  /**
   * Whether the current terminal can deliver individual keypresses. False in
   * CI, when stdin is a pipe, and in any non-interactive shell.
   */
  public isSupported(): boolean {
    return Boolean(this.input.isTTY && typeof this.input.setRawMode === "function");
  }

  /**
   * Offer a shortcut. Returns whether it was actually registered — `false`
   * means the terminal can't support keypresses and the caller should print
   * a copy-and-paste command instead.
   */
  public register(shortcut: DevServerShortcut): boolean {
    if (!this.isSupported()) {
      return false;
    }

    this.shortcuts.set(shortcut.key.toLowerCase(), shortcut);
    this.listen();

    return true;
  }

  /** Every armed shortcut, in the order it was registered. */
  public list(): DevServerShortcut[] {
    return [...this.shortcuts.values()];
  }

  /** Drop a shortcut, releasing the terminal once none are left. */
  public unregister(key: string): void {
    this.shortcuts.delete(key.toLowerCase());

    if (this.shortcuts.size === 0) {
      this.release();
    }
  }

  /**
   * Hand the terminal back: leave raw mode and stop listening. Call this
   * before spawning a child process that needs stdin (the package manager
   * install), and on shutdown. Registered shortcuts are kept, so `register()`
   * (or `resume()`) can take the terminal again afterwards.
   */
  public release(): void {
    if (!this.listening) {
      return;
    }

    this.listening = false;

    if (this.keypressListener) {
      this.input.off("keypress", this.keypressListener);
      this.keypressListener = undefined;
    }

    if (this.input.isTTY) {
      this.input.setRawMode(false);
    }

    this.input.pause();
  }

  /** Re-take the terminal after a {@link release}, if shortcuts remain. */
  public resume(): void {
    if (this.shortcuts.size > 0) {
      this.listen();
    }
  }

  /** Start (or keep) listening for keypresses. */
  private listen(): void {
    if (this.listening || !this.isSupported()) {
      return;
    }

    this.listening = true;

    readline.emitKeypressEvents(this.input);
    this.input.setRawMode(true);
    this.input.resume();

    this.keypressListener = (_character, key) => {
      void this.handleKeypress(key);
    };

    this.input.on("keypress", this.keypressListener);
  }

  /**
   * Route a keypress to its shortcut. In raw mode the terminal no longer
   * turns `Ctrl+C` into a signal for us, so we translate it back into a
   * `SIGINT` and let the dev server's shutdown handlers take it from there.
   */
  private async handleKeypress(key: KeypressEvent | undefined): Promise<void> {
    if (!key) {
      return;
    }

    if (key.ctrl && (key.name === "c" || key.name === "d")) {
      this.release();
      this.onInterrupt();
      return;
    }

    if (this.busy) {
      return;
    }

    const shortcut = key.name ? this.shortcuts.get(key.name.toLowerCase()) : undefined;

    if (!shortcut) {
      return;
    }

    this.busy = true;

    try {
      await shortcut.handler();
    } catch {
      // A shortcut is a convenience — never let it take the dev server down.
    } finally {
      this.busy = false;
    }
  }
}

/** Re-raise the interrupt the terminal would have sent outside raw mode. */
function raiseInterrupt(): void {
  process.kill(process.pid, "SIGINT");
}

/** The keypress shape emitted by `readline.emitKeypressEvents`. */
type KeypressEvent = {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

/** Process-wide shortcuts for the running dev server. */
export const devServerShortcuts = new DevServerShortcuts();
