/** Shared source/runtime surface for page, layout, and document modules. */
export type PageModuleKind = "page" | "layout" | "root";

export const MODULE_EXPORT_NAMES = [
  "config",
  "loader",
  "register",
  "action",
  "actions",
  "ErrorBoundary",
  "default",
] as const;

export const MODULE_CONFIG_KEYS = {
  page: [
    "route",
    "cache",
    "live",
    "middleware",
    "validation",
    "metadata",
    "fontPreload",
    "sitemap",
    "action",
    "actions",
    "apiRoutes",
  ],
  layout: ["prefix", "middleware", "metadata", "fontPreload", "sitemap", "apiRoutes"],
  root: ["middleware", "strictMode", "metadata", "fontPreload", "apiRoutes"],
} as const satisfies Record<PageModuleKind, readonly string[]>;
