import { createElement, type ReactElement } from "react";
import type { HydrationTranslationAssets } from "../translations/types";

/**
 * A `<link rel="preload">` for a page's shared translation table, so the browser
 * starts that fetch with the document instead of after hydration begins. The
 * fetch the client makes matches it: same origin, default credentials.
 */
export function translationPreloadLinks(
  assets: HydrationTranslationAssets | undefined,
): ReactElement[] {
  if (assets === undefined) return [];

  return [
    createElement("link", {
      key: `translations-${assets.hash}`,
      rel: "preload",
      as: "fetch",
      href: assets.url,
      crossOrigin: "anonymous",
    }),
  ];
}
