import type { SitemapGenerationManifest } from "@warlock.js/sitemap";
import type { SitemapArtifactStore } from "./sitemap-artifact-store";

/** The HTTP boundary reads published state and never triggers regeneration. */
export type SitemapServingState = {
  readonly store: SitemapArtifactStore;
  readonly cacheControl: string;
  readonly getManifest: () => Promise<SitemapGenerationManifest | undefined>;
  /**
   * A retained (non-current) generation's manifest, answered from an
   * in-memory list of retained generations instead of a storage listing per
   * request. Absent on hand-built states, which read the store directly.
   */
  readonly getManifestByGeneration?: (
    generationId: string,
  ) => Promise<SitemapGenerationManifest | undefined>;
};
