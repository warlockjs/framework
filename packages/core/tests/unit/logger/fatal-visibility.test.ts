import { log, LogChannel, type LoggingData } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureFatalIsVisible } from "../../../src/logger/fatal-visibility";

/**
 * The window this exists for: a production `src/config/log.ts` that declares
 * only a file channel — or an app with no `log` config at all, where
 * `LoggerConnector.start()` returns before `log.configure` and `log.channels`
 * stays empty. Every `log.fatal` in that state is a silent no-op, which is how
 * a boot failure became a process that exited 1 having written nothing.
 */
class FileLikeChannel extends LogChannel {
  public name = "file-like";
  public terminal = false;
  public readonly received: LoggingData[] = [];

  public log(data: LoggingData) {
    this.received.push(data);
  }
}

class ConsoleLikeChannel extends LogChannel {
  public name = "console-like";
  public terminal = true;
  public readonly received: LoggingData[] = [];

  public log(data: LoggingData) {
    this.received.push(data);
  }
}

describe("ensureFatalIsVisible", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalChannels: typeof log.channels;

  beforeEach(() => {
    originalChannels = log.channels;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    log.channels = originalChannels;
    vi.restoreAllMocks();
  });

  it("writes to stderr when no channel is configured at all", () => {
    log.channels = [];

    const error = new Error("EADDRINUSE: Port 3869 is already in use on 0.0.0.0");

    ensureFatalIsVisible(error);

    expect(errorSpy).toHaveBeenCalledWith(error);
  });

  it("writes to stderr when the only channels are non-terminal", () => {
    log.channels = [new FileLikeChannel()];

    const error = new Error("EADDRINUSE: Port 3869 is already in use on 0.0.0.0");

    ensureFatalIsVisible(error);

    expect(errorSpy).toHaveBeenCalledWith(error);
  });

  it("stays quiet when a terminal channel already printed it", () => {
    log.channels = [new ConsoleLikeChannel()];

    ensureFatalIsVisible(new Error("boom"));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("still writes to stderr for a channel that never declared the flag", () => {
    // `LogChannel.terminal` defaults to `false`, so a custom channel that
    // says nothing is non-terminal by the base class's own declaration —
    // the fallback has to fire for it, or a hand-rolled channel silently
    // reintroduces the invisible boot failure.
    class UndeclaredChannel extends LogChannel {
      public name = "undeclared";

      public log() {}
    }

    log.channels = [new UndeclaredChannel()];

    const error = new Error("boom");

    ensureFatalIsVisible(error);

    expect(errorSpy).toHaveBeenCalledWith(error);
  });
});
