/** Recorded local faces, including regular, italic, bold and bold italic metrics. */
export type SystemFont = "Arial" | "Helvetica" | "Times New Roman" | "Segoe UI" | "Roboto";

export type WebFontFace = {
  /** App-root-relative file, including `src/` or `public/`. */
  path: string;
  weight?: number | `${number} ${number}`;
  style?: "normal" | "italic" | "oblique";
  preload?: boolean;
  /** Enables development diagnostics for a critical face. */
  aboveFold?: boolean;
  unicodeRange?: string;
  /** Optional equivalent TTF/OTF for containers whose metrics cannot be decoded. */
  metricsPath?: string;
};

export type WebFont = {
  family: string;
  files: readonly WebFontFace[];
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
  fallback?: SystemFont | readonly SystemFont[];
  /** Custom property, e.g. `--font-display`. */
  variable: `--${string}`;
};

export type FontPreload = { href: string; type: string };
export type FontDocument = { stylesheetUrl: string; preloads: readonly FontPreload[] };
