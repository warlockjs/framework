/**
 * The CSS variables the dashboard defines for package panels, in both themes.
 *
 * A package panel's stylesheet may use only these variables, plus variables it
 * defines itself (in the same file). Anything else is undefined in the
 * dashboard and renders as the browser default, which is how a panel ends up
 * with unreadable text. The dashboard's own colours are checked for contrast
 * (4.5:1 for the text tokens on `--background` and `--card`) in both themes.
 */
export const DEVTOOLS_PANEL_TOKENS: readonly string[] = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--radius",
  "--brand",
  "--brand-foreground",
  "--success",
  "--warning",
  "--info",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
];
