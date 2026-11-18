import type { MountedDevtoolsPanel } from "../../panels";
import { safeEqual } from "../auth/helpers";
import type { DevtoolsShareRecord, DevtoolsStore } from "../store/types";
import { DEVTOOLS_SHARE_COOKIE_MAX_SECONDS } from "./constants";

/** How long a read of a share record is reused. A revoke reaches every instance within this time. */
export const SHARE_CACHE_MS = 5000;

/** Records kept in the cache of one process (oldest evicted). */
const SHARE_CACHE_SIZE = 500;

/** A link's use is written at most this often per link and process. */
const TOUCH_INTERVAL_MS = 60_000;

/** What a valid share cookie grants: the link and the panel it opens. */
export type DevtoolsShareGrant = {
  share: DevtoolsShareRecord;
  panel: MountedDevtoolsPanel;
};

/** Why a share cookie or token was refused (written to the audit log; never the value). */
export type DevtoolsShareRefusal = "unknown" | "expired" | "revoked" | "panel" | "cookie";

export type DevtoolsShareSessions = {
  /** The cookie value for `share`: `<id>.<exp>.<hmac>`, and its life in seconds. */
  issue(share: DevtoolsShareRecord): { value: string; maxAgeSeconds: number };
  /** The grant a `Cookie` value carries, or the reason it was refused. */
  verify(value: string | undefined): Promise<
    { grant: DevtoolsShareGrant } | { refused: DevtoolsShareRefusal; shareId: string | null }
  >;
  /** The record a token hash names, checked for life and panel; or the reason it is refused. */
  open(tokenHash: string): Promise<
    { grant: DevtoolsShareGrant } | { refused: DevtoolsShareRefusal; shareId: string | null }
  >;
  /** Counts one use of `share` (at most once a minute per link). */
  touch(shareId: string): void;
  /** Forgets cached records (after this process revoked or created a link). */
  invalidate(): void;
};

/**
 * The share grant: a cookie carrying `<shareId>.<exp>.<HMAC-SHA256(key,
 * "share:<id>:<exp>")>`. The signature proves this server issued it; the
 * link's record, read through a 5-second cache, proves it is still alive, so
 * a revoke takes effect everywhere within that time without a session table.
 */
export function createShareSessions(input: {
  store: DevtoolsStore;
  panels: readonly MountedDevtoolsPanel[];
  hmac: (value: string) => string;
  now?: () => number;
  warn?: (message: string) => void;
}): DevtoolsShareSessions {
  const { store, hmac } = input;
  const now = input.now ?? (() => Date.now());
  const panels = new Map(
    input.panels.filter((panel) => panel.share !== null).map((panel) => [panel.id, panel]),
  );
  const cache = new Map<string, { record: DevtoolsShareRecord | null; at: number }>();
  const touched = new Map<string, number>();

  const sign = (id: string, exp: number): string => hmac(`share:${id}:${exp}`);

  async function record(id: string): Promise<DevtoolsShareRecord | null> {
    const cached = cache.get(id);

    if (cached && now() - cached.at < SHARE_CACHE_MS) return cached.record;

    const found = await store.shares.get(id);

    cache.delete(id);

    if (cache.size >= SHARE_CACHE_SIZE) {
      const oldest = cache.keys().next();

      if (!oldest.done) cache.delete(oldest.value);
    }

    cache.set(id, { record: found, at: now() });

    return found;
  }

  function grantFor(share: DevtoolsShareRecord):
    | { grant: DevtoolsShareGrant }
    | { refused: DevtoolsShareRefusal; shareId: string } {
    if (share.revokedAt !== null) return { refused: "revoked", shareId: share.id };

    if (share.expiresAt <= now()) return { refused: "expired", shareId: share.id };

    const panel = panels.get(share.panel);

    return panel ? { grant: { share, panel } } : { refused: "panel", shareId: share.id };
  }

  return {
    issue(share) {
      const remaining = Math.floor((share.expiresAt - now()) / 1000);
      const maxAgeSeconds = Math.max(1, Math.min(remaining, DEVTOOLS_SHARE_COOKIE_MAX_SECONDS));
      const exp = now() + maxAgeSeconds * 1000;

      return { value: `${share.id}.${exp}.${sign(share.id, exp)}`, maxAgeSeconds };
    },

    async verify(value) {
      const parts = (value ?? "").split(".");
      const [id, expText, signature] = parts;

      if (parts.length !== 3 || !id || !expText || !signature || !/^\d{1,16}$/.test(expText)) {
        return { refused: "cookie", shareId: null };
      }

      const exp = Number(expText);

      if (!safeEqual(signature, sign(id, exp)) || exp <= now()) {
        return { refused: "cookie", shareId: null };
      }

      const share = await record(id);

      return share ? grantFor(share) : { refused: "unknown", shareId: id };
    },

    async open(tokenHash) {
      const share = await store.shares.findByTokenHash(tokenHash);

      return share ? grantFor(share) : { refused: "unknown", shareId: null };
    },

    touch(shareId) {
      const at = now();
      const last = touched.get(shareId);

      if (last !== undefined && at - last < TOUCH_INTERVAL_MS) return;

      touched.delete(shareId);

      if (touched.size >= SHARE_CACHE_SIZE) {
        const oldest = touched.keys().next();

        if (!oldest.done) touched.delete(oldest.value);
      }

      touched.set(shareId, at);
      // A failed write is not worth failing the request for.
      void store.shares.touch(shareId, at).catch((error: unknown) => {
        input.warn?.(
          `devtools could not record a share link use: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    },

    invalidate() {
      cache.clear();
    },
  };
}
