import { PublicPageError } from "./public-page-error";

/**
 * Raised when a page's document shell is not ready within `web.shellTimeout`:
 * a shell that suspends outside every `<Suspense>` (a pending `use()`, a lazy
 * component that never loads) waits for it, and a connected visitor would
 * otherwise wait for as long as the promise never settles. The render is
 * aborted with this error and escalates to the error page with status 504,
 * the same path a thrown render error takes.
 *
 * A {@link PublicPageError}: the message is all a visitor sees and it never
 * names the component that hung.
 */
export class PageShellTimeoutError extends PublicPageError {
  /** Always 504 — the page's own render is at fault, not the visitor's request. */
  public readonly statusCode = 504;

  public constructor(public readonly timeoutMs: number) {
    super("This page took too long to load. Please try again.");
    this.name = "PageShellTimeoutError";
  }
}
