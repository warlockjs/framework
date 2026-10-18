import recorded from "./system-metrics";
import type { FontMetrics } from "./read-metrics";
import type { SystemFont, WebFontFace } from "./types";

const percent = (value: number) => `${Number((value * 100).toFixed(4))}%`;

// Verified against @capsizecss/metrics and createFontStack at revision
// 1fcf40ae804b918b9b2289cc046f12cedf9f34ae (2026-10-18).
// https://github.com/seek-oss/capsize/blob/1fcf40ae804b918b9b2289cc046f12cedf9f34ae/packages/core/src/createFontStack.ts
// Source data and MIT attribution: system-metrics.ts, CAPSIZE-LICENSE.txt.
export function fallbackMetrics(family: SystemFont, face: WebFontFace) {
  const variants: Record<string, FontMetrics & { fullName: string; postscriptName: string }> =
    recorded[family];
  if (!variants) throw new Error(`Unsupported system fallback font: ${family}`);
  const bold = Number(String(face.weight ?? 400).split(" ")[0]) >= 600;
  const italic = face.style === "italic" || face.style === "oblique";
  const variant = bold ? (italic ? "700italic" : "700") : italic ? "italic" : "regular";
  const metrics = variants[variant];
  if (!metrics) throw new Error(`No recorded ${variant} metrics for ${family}`);
  return metrics;
}

export function fallbackOverrides(target: FontMetrics, fallback: FontMetrics) {
  const sizeAdjust =
    target.xWidthAvg / target.unitsPerEm / (fallback.xWidthAvg / fallback.unitsPerEm);
  if (!Number.isFinite(sizeAdjust) || sizeAdjust <= 0)
    throw new Error("Invalid font advance metrics");
  const adjustedEm = target.unitsPerEm * sizeAdjust;
  return {
    sizeAdjust: percent(sizeAdjust),
    ascentOverride: percent(target.ascent / adjustedEm),
    descentOverride: percent(Math.abs(target.descent) / adjustedEm),
    lineGapOverride: percent(target.lineGap / adjustedEm),
  };
}
