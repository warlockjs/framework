/**
 * Domain errors for `@warlock.js/notifications`. All extend `Error` directly
 * (no framework HttpError) so the package stays runtime-agnostic — the host
 * app maps them to its own error shape via `instanceof` if needed.
 *
 * Each captures a clean V8 stack (drops the Error-constructor frame) to match
 * the cascade convention.
 */

function captureStack(target: object, ctor: new (...args: any[]) => unknown): void {
  // V8 only; guarded for non-V8 runtimes.
  (Error as unknown as { captureStackTrace?: (t: object, c: unknown) => void }).captureStackTrace?.(
    target,
    ctor,
  );
}

export class NotificationsNotConfiguredError extends Error {
  public constructor() {
    super(
      "Notifications not configured — add `src/config/notifications.ts` with a " +
        "default-exported config; the notifications connector registers it at boot.",
    );
    this.name = "NotificationsNotConfiguredError";
    captureStack(this, NotificationsNotConfiguredError);
  }
}

export class ChannelNotFoundError extends Error {
  public constructor(channelName: string) {
    super(
      `Channel "${channelName}" is not configured. Add it to the ` +
        "`channels` map in `src/config/notifications.ts`.",
    );
    this.name = "ChannelNotFoundError";
    captureStack(this, ChannelNotFoundError);
  }
}

export class NoQueueDispatcherError extends Error {
  public constructor(channelName: string) {
    super(
      `Cannot queue to channel "${channelName}" — no queue dispatcher configured. ` +
        "Add a `queue` to `src/config/notifications.ts`, or call `.send()` instead of `.queue()`.",
    );
    this.name = "NoQueueDispatcherError";
    captureStack(this, NoQueueDispatcherError);
  }
}

export class MissingRendererError extends Error {
  public constructor(notificationType: string, channelName: string) {
    super(
      `Notification "${notificationType}" routes to channel "${channelName}" via ` +
        `\`via\` but defines no \`${channelName}\` renderer.`,
    );
    this.name = "MissingRendererError";
    captureStack(this, MissingRendererError);
  }
}

/**
 * Thrown when a channel's `route()` resolver runs but returns `undefined` for
 * a recipient (e.g. a mail recipient with no email). Distinct from "the
 * channel declares no resolver" — that case falls back to `{ id }`.
 */
export class UnresolvableRouteError extends Error {
  public constructor(channelName: string, recipientId?: unknown) {
    super(
      `Channel "${channelName}" could not resolve a route for recipient ` +
        `${recipientId ?? "(unknown)"}. The channel's \`route()\` returned undefined — ` +
        "the recipient is missing the address column this channel needs.",
    );
    this.name = "UnresolvableRouteError";
    captureStack(this, UnresolvableRouteError);
  }
}
