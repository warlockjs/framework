import { createTheme, type MantineColorScheme } from "@mantine/core";

/**
 * The design tokens of this app. Edit this file; everything Mantine renders
 * reads it through `DesignSystemProvider`.
 *
 * `primaryColor` takes any key of Mantine's palette (`blue`, `violet`, `teal`
 * and so on) or a custom palette you add under `colors`.
 */
export const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "Cascadia Code", Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  spacing: {
    xs: "0.625rem",
    sm: "0.75rem",
    md: "1rem",
    lg: "1.25rem",
    xl: "2rem",
  },
});

/**
 * `auto` follows the visitor's system preference. The same value feeds the
 * `ColorSchemeScript` in the root and the provider, so the first paint and the
 * hydrated page agree.
 */
export const defaultColorScheme: MantineColorScheme = "auto";
