import type { CdpConnection } from "./cdp";
import type { BrowserPage } from "./page";

/**
 * The CDP connection behind each page. Kept out of the package index and off
 * the `BrowserPage` surface: test helpers that need raw CDP commands (virtual
 * WebAuthn authenticators) look it up here.
 */
export const pageConnections = new WeakMap<BrowserPage, CdpConnection>();
