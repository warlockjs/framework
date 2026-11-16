import type { BookFacts } from "../contracts/adapter";
import type { AppMatch } from "../contracts/snapshot";
import type { WrittenApp } from "../contracts/written";
import { toPosixPath } from "../paths";

function sameRoot(left: string, right: string): boolean {
  const normalize = (value: string): string =>
    toPosixPath(value).replace(/^\.\//, "").replace(/\/+$/, "");

  return normalize(left) === normalize(right);
}

/**
 * Match each written app to the site or mobile app the adapter reports with
 * the same root. A `site` app only matches a site and a `mobile` app only a
 * mobile app; an app that matches nothing gets `null` (reported as `GR5005`).
 */
export function matchApps(
  apps: readonly WrittenApp[],
  facts: Pick<BookFacts, "sites" | "mobile">,
): Record<string, AppMatch> {
  const result: Record<string, AppMatch> = {};

  for (const app of apps) {
    const type = app.type.value;
    const root = app.root.value;

    result[app.id.value] = {
      app: app.id.value,
      type,
      site:
        type === "site" ? (facts.sites.find((site) => sameRoot(site.root, root)) ?? null) : null,
      mobile:
        type === "mobile"
          ? (facts.mobile.find((mobile) => sameRoot(mobile.root, root)) ?? null)
          : null,
    };
  }

  return result;
}
