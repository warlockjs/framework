export const DASHBOARD_GZIP_BUDGET_BYTES: number;

export const DASHBOARD_FILES: readonly string[];

export function writeBuildInfo(options: { packageDir: string; outDir: string }): Promise<{
  sourceHash: string;
  budgetGzipBytes: number;
  files: Record<string, { bytes: number; gzipBytes: number; sha256: string }>;
}>;
